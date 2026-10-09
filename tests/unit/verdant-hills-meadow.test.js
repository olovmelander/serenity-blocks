import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    VERDANT_HILLS_VIEWS, VerdantHillsSight, verdantHillsEye, verdantHillsInSight,
} from '../../src/themes/verdant-hills/verdant-hills-composition.js';
import {
    VERDANT_HILLS_FLOWERS, createVerdantHillsFlowerGeometry, createVerdantHillsGrassGeometry,
} from '../../src/themes/verdant-hills/verdant-hills-flora.js';
import { VerdantHillsLight } from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VerdantHillsMeadow, verdantHillsMeadowCover } from '../../src/themes/verdant-hills/verdant-hills-meadow.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import {
    VERDANT_HILLS_PATH, VERDANT_HILLS_PLACES, verdantHillsGroundHeight, verdantHillsPathDistance,
} from '../../src/themes/verdant-hills/verdant-hills-terrain.js';

vi.setConfig({ testTimeout: 30000 });

const KINDS = VERDANT_HILLS_FLOWERS.map((flower) => flower.id);
const VARIANTS = [0, 1];
/** A meadow small enough to look at plant by plant. */
const SMALL = Object.freeze({
    ...VERDANT_HILLS_TIERS.Minimal, grassNear: 500, grassFar: 700, flowers: 400,
});
const { oak: OAK, gate: GATE, bench: BENCH } = VERDANT_HILLS_PLACES;

function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function allFinite(array) {
    for (let index = 0; index < array.length; index++) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}

/** Every vertex of a geometry with the data the meadow's shaders read. */
function vertices(geometry) {
    const position = geometry.getAttribute('position');
    const paint = geometry.getAttribute('paint');
    const uv = geometry.getAttribute('uv');
    return Array.from({ length: position.count }, (_, index) => ({
        x: position.getX(index),
        y: position.getY(index),
        z: position.getZ(index),
        height: paint.getX(index),
        part: paint.getY(index),
        id: paint.getZ(index),
        head: paint.getW(index),
        along: uv ? uv.getY(index) : null,
        blade: uv ? uv.getX(index) : null,
    }));
}

/** Area and facing of every triangle, as its winding gives them, with the part its corners share. */
function triangles(geometry) {
    const position = geometry.getAttribute('position');
    const paint = geometry.getAttribute('paint');
    const index = geometry.getIndex();
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const result = [];
    for (let corner = 0; corner < index.count; corner += 3) {
        const corners = [index.getX(corner), index.getX(corner + 1), index.getX(corner + 2)];
        a.fromBufferAttribute(position, corners[0]);
        b.fromBufferAttribute(position, corners[1]);
        c.fromBufferAttribute(position, corners[2]);
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        const parts = new Set(corners.map((vertex) => paint.getY(vertex)));
        result.push({
            area: normal.length() / 2,
            normal: normal.normalize(),
            part: parts.size === 1 ? [...parts][0] : null,
            centre: a.clone().add(b).add(c).divideScalar(3),
        });
    }
    return result;
}

/** How far the triangles of a part face the sky, weighted by their area: 1 is flat on its back. */
function skyward(geometry, part) {
    const faces = triangles(geometry).filter((face) => face.part === part);
    const area = faces.reduce((sum, face) => sum + face.area, 0);
    return faces.reduce((sum, face) => sum + face.normal.y * face.area, 0) / area;
}

/** Where each plant of a meadow draw stands, from its instance data. */
function plants(mesh) {
    const { aRoot, aTurn } = mesh.geometry.attributes;
    return Array.from({ length: aRoot.count }, (_, index) => ({
        x: aRoot.getX(index),
        y: aRoot.getY(index),
        z: aRoot.getZ(index),
        phase: aRoot.getW(index),
        cos: aTurn.getX(index),
        sin: aTurn.getY(index),
        scale: aTurn.getZ(index),
        hue: aTurn.getW(index),
    }));
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
const grassOf = (meadow) => meadow.group.children.filter((mesh) => /Grass/.test(mesh.name));
const flowersOf = (meadow) => meadow.group.children.filter((mesh) => /Flower/.test(mesh.name));

describe('Verdant Hills flora', () => {
    describe('the kinds of flower', () => {
        it('lists the flowers of the down and how it shares them out', () => {
            expect(Object.isFrozen(VERDANT_HILLS_FLOWERS)).toBe(true);
            expect(KINDS.length).toBeGreaterThanOrEqual(3);
            expect(new Set(KINDS).size).toBe(KINDS.length);
            // The dandelion's clock is the one whose seed the wind takes.
            expect(KINDS).toContain('clock');
            let total = 0;
            for (const flower of VERDANT_HILLS_FLOWERS) {
                expect(flower.share).toBeGreaterThan(0);
                total += flower.share;
                const [frequency, threshold] = flower.patch;
                expect(frequency).toBeGreaterThan(0);
                expect(threshold).toBeGreaterThan(0);
                expect(threshold).toBeLessThan(1);
                // Knee-high at most.
                expect(flower.tall).toBeGreaterThan(0.05);
                expect(flower.tall).toBeLessThan(1);
            }
            expect(total).toBeCloseTo(1, 6);
        });
    });

    describe('grass', () => {
        it.each([
            ['a near clump', { far: false, seed: 11 }], ['a far clump', { far: true, seed: 23 }],
            ['a clump from no options at all', undefined],
        ])('builds %s as finite, indexed geometry with all the shader reads', (_label, options) => {
            const geometry = createVerdantHillsGrassGeometry(options);
            for (const [name, size] of [['position', 3], ['uv', 2], ['paint', 4], ['normal', 3]]) {
                const attribute = geometry.getAttribute(name);
                expect(attribute, name).toBeDefined();
                expect(attribute.itemSize).toBe(size);
                expect(attribute.count).toBe(geometry.getAttribute('position').count);
                expect(allFinite(attribute.array), name).toBe(true);
            }
            const index = geometry.getIndex();
            expect(index.count % 3).toBe(0);
            expect(index.count).toBeGreaterThan(0);
            expect(Math.max(...index.array)).toBeLessThan(geometry.getAttribute('position').count);
            expect(geometry.boundingSphere.radius).toBeGreaterThan(0.1);
            expect(geometry.boundingSphere.radius).toBeLessThan(1.5);
            // No blade is a sliver without area.
            for (const face of triangles(geometry)) expect(face.area).toBeGreaterThan(0);
            geometry.dispose();
        });

        it.each([
            ['near', false], ['far', true],
        ])('roots every blade of a %s clump at the ground and runs it to its tip', (_label, far) => {
            const geometry = createVerdantHillsGrassGeometry({ far, seed: 5 });
            const all = vertices(geometry);
            const blades = new Map();
            for (const vertex of all) {
                // How far the wind may carry a vertex is its height above the root.
                expect(vertex.height).toBeCloseTo(vertex.y, 9);
                expect(vertex.y).toBeGreaterThanOrEqual(0);
                expect(vertex.along).toBeGreaterThanOrEqual(0);
                expect(vertex.along).toBeLessThanOrEqual(1);
                // A blade's id is the same number in both places the shader looks for it.
                expect(vertex.id).toBe(vertex.blade);
                if (!blades.has(vertex.blade)) blades.set(vertex.blade, []);
                blades.get(vertex.blade).push(vertex);
            }
            expect(blades.size).toBeGreaterThan(3);
            for (const blade of blades.values()) {
                const root = blade.filter((vertex) => vertex.along === 0);
                const tip = blade.filter((vertex) => vertex.along === 1);
                // Two vertices across the blade at either end.
                expect(root).toHaveLength(2);
                expect(tip).toHaveLength(2);
                for (const vertex of root) expect(vertex.y).toBe(0);
                // The tip is the top, and higher up the blade is higher above the ground.
                const top = Math.max(...blade.map((vertex) => vertex.y));
                for (const vertex of tip) expect(vertex.y).toBeCloseTo(top, 9);
                const rungs = [...blade].sort((p, q) => p.along - q.along);
                for (let rung = 2; rung < rungs.length; rung++) {
                    expect(rungs[rung].y).toBeGreaterThanOrEqual(rungs[rung - 2].y);
                }
                // Grass, not bamboo: shin to knee high, in a clump a stride across.
                expect(top).toBeGreaterThan(0.15);
                expect(top).toBeLessThan(1);
                for (const vertex of blade) expect(Math.hypot(vertex.x, vertex.z)).toBeLessThan(0.7);
                // It narrows to its tip.
                const width = (pair) => Math.hypot(pair[0].x - pair[1].x, pair[0].z - pair[1].z);
                expect(width(tip)).toBeLessThan(width(root));
            }
            geometry.dispose();
        });

        it('stands exactly one seed head above a near clump and none in a far one', () => {
            for (const seed of [1, 11, 23, 400]) {
                const near = vertices(createVerdantHillsGrassGeometry({ far: false, seed }));
                const far = vertices(createVerdantHillsGrassGeometry({ far: true, seed }));
                const stalks = new Set(near.filter((vertex) => vertex.head === 1).map((vertex) => vertex.blade));
                expect(stalks.size, `seed ${seed}`).toBe(1);
                for (const vertex of near) expect([0, 1]).toContain(vertex.head);
                expect(far.every((vertex) => vertex.head === 0)).toBe(true);
                expect(far.every((vertex) => vertex.part === 0)).toBe(true);
                // The head itself is the top of its stalk, and stands over every blade.
                const head = near.filter((vertex) => vertex.part === 1);
                expect(head.length).toBeGreaterThan(0);
                expect(head.every((vertex) => vertex.head === 1)).toBe(true);
                const blades = near.filter((vertex) => vertex.head === 0);
                expect(Math.min(...head.map((vertex) => vertex.y))).toBeGreaterThan(0.3);
                expect(Math.max(...head.map((vertex) => vertex.y)))
                    .toBeGreaterThan(Math.max(...blades.map((vertex) => vertex.y)) - 0.1);
                // The stalk under the head is bare.
                const stalk = near.filter((vertex) => vertex.head === 1 && vertex.part === 0);
                expect(stalk.some((vertex) => vertex.y === 0)).toBe(true);
            }
        });

        it('keeps a far clump to a handful of broad blades', () => {
            const near = createVerdantHillsGrassGeometry({ far: false, seed: 11 });
            const far = createVerdantHillsGrassGeometry({ far: true, seed: 11 });
            expect(far.getIndex().count).toBeLessThan(near.getIndex().count / 2);
            const widest = (geometry) => {
                const roots = vertices(geometry).filter((vertex) => vertex.along === 0);
                let most = 0;
                for (let index = 0; index < roots.length; index += 2) {
                    const [left, right] = [roots[index], roots[index + 1]];
                    most = Math.max(most, Math.hypot(left.x - right.x, left.z - right.z));
                }
                return most;
            };
            // Seen from far off a hair-thin blade is no pixel at all.
            expect(widest(far)).toBeGreaterThan(widest(near) * 2);
        });

        it('grows the same clump from the same seed and another from another', () => {
            const first = createVerdantHillsGrassGeometry({ far: false, seed: 11 });
            // Whatever else is built in between.
            createVerdantHillsGrassGeometry({ far: true, seed: 3 });
            createVerdantHillsFlowerGeometry(KINDS[0]);
            const again = createVerdantHillsGrassGeometry({ far: false, seed: 11 });
            const other = createVerdantHillsGrassGeometry({ far: false, seed: 12 });
            for (const name of ['position', 'uv', 'paint']) {
                expect(Array.from(again.getAttribute(name).array)).toEqual(Array.from(first.getAttribute(name).array));
            }
            expect(Array.from(other.getAttribute('position').array))
                .not.toEqual(Array.from(first.getAttribute('position').array));
            // Near and far clumps of one seed are not each other cut down.
            const far = createVerdantHillsGrassGeometry({ far: true, seed: 11 });
            expect(far.getAttribute('position').getX(1)).not.toBe(first.getAttribute('position').getX(1));
        });
    });

    describe('flowers', () => {
        const SHAPES = KINDS.flatMap((id) => VARIANTS.map((variant) => [id, variant]));

        it.each(SHAPES)('builds %s (variant %i) as finite, indexed geometry with colour and paint', (id, variant) => {
            const geometry = createVerdantHillsFlowerGeometry(id, { variant });
            const position = geometry.getAttribute('position');
            for (const [name, size] of [['position', 3], ['color', 3], ['paint', 4], ['normal', 3]]) {
                const attribute = geometry.getAttribute(name);
                expect(attribute, name).toBeDefined();
                expect(attribute.itemSize).toBe(size);
                expect(attribute.count).toBe(position.count);
                expect(allFinite(attribute.array), name).toBe(true);
            }
            const index = geometry.getIndex();
            expect(index.count % 3).toBe(0);
            expect(Math.max(...index.array)).toBeLessThan(position.count);
            expect(new Set(index.array).size).toBe(position.count);
            const colour = geometry.getAttribute('color');
            for (const value of colour.array) {
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(1);
            }
            const kind = KINDS.indexOf(id) / KINDS.length;
            const all = vertices(geometry);
            for (const vertex of all) {
                // Height above the root is how far the wind may carry it.
                expect(vertex.height).toBeCloseTo(Math.max(0, vertex.y), 9);
                // Stem, eye, or petal and down: nothing else.
                expect([0, 0.5, 1]).toContain(vertex.part);
                expect(vertex.id).toBeCloseTo(kind, 6);
                expect(vertex.head).toBe(0);
            }
            // Rooted at the ground, with a stem under a head of petals or down.
            expect(Math.min(...all.map((vertex) => vertex.y))).toBeCloseTo(0, 6);
            expect(all.some((vertex) => vertex.part === 0)).toBe(true);
            expect(all.some((vertex) => vertex.part === 1)).toBe(true);
            const head = all.filter((vertex) => vertex.part === 1);
            expect(Math.min(...head.map((vertex) => vertex.y))).toBeGreaterThan(0.08);
            // About as tall as the table says the kind is, and no wider than a hand span or two.
            const { tall } = VERDANT_HILLS_FLOWERS[KINDS.indexOf(id)];
            const top = Math.max(...all.map((vertex) => vertex.y));
            expect(top).toBeGreaterThan(tall * 0.6);
            expect(top).toBeLessThan(tall * 1.5);
            for (const vertex of all) expect(Math.hypot(vertex.x, vertex.z)).toBeLessThan(0.3);
            expect(geometry.boundingSphere.radius).toBeGreaterThan(0.05);
            expect(geometry.name).toContain(id);
            geometry.dispose();
        });

        it.each(SHAPES)('opens the petals of %s (variant %i) to the sky, not to the ground', (id, variant) => {
            const geometry = createVerdantHillsFlowerGeometry(id, { variant });
            const faces = triangles(geometry);
            // Every triangle belongs to one part and has area: no petal is sewn to a stem.
            for (const face of faces) {
                expect(face.part).not.toBeNull();
                expect(face.area).toBeGreaterThan(0);
            }
            // The winding is what the vertex normals are computed from: wound the wrong way, a
            // flower would be lit from underneath.
            expect(skyward(geometry, 1)).toBeGreaterThan(0.25);
            const eyes = faces.filter((face) => face.part === 0.5);
            if (eyes.length > 0) expect(skyward(geometry, 0.5)).toBeGreaterThan(0.25);
            // And the stored normals agree with the winding, part by part.
            const normal = geometry.getAttribute('normal');
            const paint = geometry.getAttribute('paint');
            let lift = 0;
            let count = 0;
            for (let vertex = 0; vertex < normal.count; vertex++) {
                expect(Math.hypot(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex))).toBeCloseTo(1, 4);
                if (paint.getY(vertex) === 1) {
                    lift += normal.getY(vertex);
                    count += 1;
                }
            }
            expect(lift / count).toBeGreaterThan(0.25);
            geometry.dispose();
        });

        it.each(KINDS)('wraps the stems of %s outward', (id) => {
            const geometry = createVerdantHillsFlowerGeometry(id);
            const stems = triangles(geometry).filter((face) => face.part === 0);
            expect(stems.length).toBeGreaterThan(8);
            // A closed tube faces every way equally: its faces sum to nothing sideways ...
            const total = stems.reduce((acc, face) => acc.addScaledVector(face.normal, face.area), new THREE.Vector3());
            const area = stems.reduce((acc, face) => acc + face.area, 0);
            expect(Math.hypot(total.x, total.z) / area).toBeLessThan(0.35);
            // ... and no stem face looks straight up or down.
            for (const face of stems) expect(Math.abs(face.normal.y)).toBeLessThan(0.75);
            geometry.dispose();
        });

        it('builds the same plant for the same kind and variant, whatever was built before it', () => {
            for (const id of KINDS) {
                const first = createVerdantHillsFlowerGeometry(id, { variant: 1 });
                KINDS.forEach((other) => createVerdantHillsFlowerGeometry(other, { variant: 0 }));
                const again = createVerdantHillsFlowerGeometry(id, { variant: 1 });
                for (const name of ['position', 'color', 'paint']) {
                    expect(Array.from(again.getAttribute(name).array), `${id} ${name}`)
                        .toEqual(Array.from(first.getAttribute(name).array));
                }
                expect(Array.from(again.getIndex().array)).toEqual(Array.from(first.getIndex().array));
                // Its other shape is another plant, and no options at all is the first shape.
                const other = createVerdantHillsFlowerGeometry(id, { variant: 0 });
                expect(Array.from(other.getAttribute('position').array))
                    .not.toEqual(Array.from(first.getAttribute('position').array));
                expect(Array.from(createVerdantHillsFlowerGeometry(id).getAttribute('position').array))
                    .toEqual(Array.from(other.getAttribute('position').array));
            }
        });

        it('tells the kinds apart in shape and in colour', () => {
            const built = KINDS.map((id) => createVerdantHillsFlowerGeometry(id));
            const petals = built.map((geometry) => {
                const colour = geometry.getAttribute('color');
                const paint = geometry.getAttribute('paint');
                const tint = new THREE.Color(0, 0, 0);
                let count = 0;
                for (let vertex = 0; vertex < colour.count; vertex++) {
                    if (paint.getY(vertex) === 1) {
                        tint.r += colour.getX(vertex);
                        tint.g += colour.getY(vertex);
                        tint.b += colour.getZ(vertex);
                        count += 1;
                    }
                }
                return [tint.r / count, tint.g / count, tint.b / count];
            });
            for (let first = 0; first < KINDS.length; first++) {
                for (let second = first + 1; second < KINDS.length; second++) {
                    const apart = Math.hypot(...petals[first].map((value, channel) => value - petals[second][channel]));
                    expect(apart, `${KINDS[first]} and ${KINDS[second]}`).toBeGreaterThan(0.08);
                    expect(built[first].getAttribute('position').count)
                        .not.toBe(built[second].getAttribute('position').count);
                }
            }
            // Each kind marks its vertices with an id of its own.
            expect(new Set(built.map((geometry) => geometry.getAttribute('paint').getZ(0))).size).toBe(KINDS.length);
        });

        it('refuses a flower it does not know', () => {
            for (const id of ['orchid', '', undefined, null, 7, 'Buttercup']) {
                expect(() => createVerdantHillsFlowerGeometry(id), String(id)).toThrow(/Unknown flower/);
            }
            expect(() => createVerdantHillsFlowerGeometry('orchid')).toThrow(/orchid/);
        });
    });
});

describe('Verdant Hills meadow cover', () => {
    it('is a share between nought and one everywhere, and the whole of it on the open down', () => {
        const random = seededRandom(7);
        let full = 0;
        for (let count = 0; count < 5000; count++) {
            const [x, z] = [(random() - 0.5) * 200, -random() * 160];
            const cover = verdantHillsMeadowCover(x, z);
            if (!(cover >= 0 && cover <= 1)) throw new Error(`cover ${cover} at ${x}, ${z}`);
            if (cover === 1) full += 1;
        }
        // Most of the hill is in full growth.
        expect(full / 5000).toBeGreaterThan(0.8);
        expect(verdantHillsMeadowCover(-60, -80)).toBe(1);
    });

    it('wears the path nearly bare and leaves the grass beside it', () => {
        for (let index = 0; index < VERDANT_HILLS_PATH.length - 1; index++) {
            const [ax, az] = VERDANT_HILLS_PATH[index];
            const [bx, bz] = VERDANT_HILLS_PATH[index + 1];
            const length = Math.hypot(bx - ax, bz - az);
            const [nx, nz] = [-(bz - az) / length, (bx - ax) / length];
            for (const share of [0.2, 0.5, 0.8]) {
                const [x, z] = [ax + (bx - ax) * share, az + (bz - az) * share];
                expect(verdantHillsPathDistance(x, z)).toBeCloseTo(0, 9);
                expect(verdantHillsMeadowCover(x, z)).toBeLessThan(0.1);
                // A few strides off it, clear of the oak and the gate, the down is itself again.
                const [sx, sz] = [x + nx * 4, z + nz * 4];
                const clear = Math.hypot(sx - GATE.x, sz - GATE.z) > 4 && Math.hypot(sx - OAK.x, sz - OAK.z) > 10
                    && Math.hypot(sx - BENCH.x, sz - BENCH.z) > 3;
                if (clear) expect(verdantHillsMeadowCover(sx, sz)).toBe(1);
                // And it grows back steadily from the tread outward.
                let previous = verdantHillsMeadowCover(x, z);
                for (let off = 0.1; off <= 1.2; off += 0.1) {
                    const here = verdantHillsMeadowCover(x + nx * off, z + nz * off);
                    if (clear) expect(here).toBeGreaterThanOrEqual(previous - 1e-9);
                    previous = here;
                }
            }
        }
    });

    it('grows nothing at the oak\'s trunk, less in its shade, and nothing where people stand', () => {
        expect(verdantHillsMeadowCover(OAK.x, OAK.z)).toBe(0);
        expect(verdantHillsMeadowCover(OAK.x + 0.6, OAK.z - 0.6)).toBe(0);
        expect(verdantHillsMeadowCover(GATE.x, GATE.z)).toBe(0);
        expect(verdantHillsMeadowCover(BENCH.x, BENCH.z)).toBe(0);
        // Out from the trunk, on the side away from the path and the bench, it thickens and never thins.
        let previous = 0;
        let shaded = null;
        for (let away = 0; away <= 14; away += 0.25) {
            const cover = verdantHillsMeadowCover(OAK.x - away, OAK.z - away * 0.3);
            expect(cover).toBeGreaterThanOrEqual(previous - 1e-9);
            if (away === 4) shaded = cover;
            previous = cover;
        }
        expect(previous).toBe(1);
        // Under the boughs it is thin but it is there.
        expect(shaded).toBeGreaterThan(0.2);
        expect(shaded).toBeLessThan(0.9);
    });
});

describe('Verdant Hills meadow', () => {
    let light;
    let meadow;
    const eye = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);

    beforeAll(() => {
        light = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS.Minimal, rng: seededRandom(5) });
        meadow = new VerdantHillsMeadow({ light, tier: SMALL, rng: seededRandom(41) }).build();
    });

    afterAll(() => {
        meadow.dispose();
        light.dispose();
    });

    it('builds instanced draws of grass and of each flower that came up', () => {
        expect(meadow.group).toBeInstanceOf(THREE.Group);
        const meshes = meadow.group.children;
        expect(meshes.length).toBeGreaterThan(2);
        for (const mesh of meshes) {
            expect(mesh.isInstancedMesh, mesh.name).toBe(true);
            expect(mesh.name).toMatch(/^VerdantHills(Grass|Flower) /);
            // The shader stands every plant on its own root: never culled as one, never a caster.
            expect(mesh.frustumCulled).toBe(false);
            expect(mesh.castShadow).toBe(false);
            expect(mesh.material.isNodeMaterial).toBe(true);
            expect(mesh.material.positionNode).toBeTruthy();
            expect(mesh.material.colorNode).toBeTruthy();
            // Both faces of a blade or a petal are seen.
            expect(mesh.material.side).toBe(THREE.DoubleSide);
            expect(mesh.count).toBeGreaterThan(0);
        }
        expect(new Set(meshes.map((mesh) => mesh.name)).size).toBe(meshes.length);
        const grass = grassOf(meadow).map((mesh) => mesh.name).sort();
        expect(grass).toEqual(['VerdantHillsGrass far', 'VerdantHillsGrass near']);
        // All the grass is one material and all the flowers another.
        expect(new Set(grassOf(meadow).map((mesh) => mesh.material)).size).toBe(1);
        expect(new Set(flowersOf(meadow).map((mesh) => mesh.material)).size).toBe(1);
        expect(grassOf(meadow)[0].material).not.toBe(flowersOf(meadow)[0].material);
    });

    it('plants no more than the tier asks for, and nearly all of it', () => {
        const near = grassOf(meadow).find((mesh) => /near/.test(mesh.name));
        const far = grassOf(meadow).find((mesh) => /far/.test(mesh.name));
        expect(near.count).toBeLessThanOrEqual(SMALL.grassNear);
        expect(far.count).toBeLessThanOrEqual(SMALL.grassFar);
        expect(near.count).toBeGreaterThan(SMALL.grassNear * 0.8);
        expect(far.count).toBeGreaterThan(SMALL.grassFar * 0.8);
        expect(meadow.stats.grass).toBe(near.count + far.count);
        const flowers = sum(flowersOf(meadow).map((mesh) => mesh.count));
        expect(flowers).toBeLessThanOrEqual(SMALL.flowers);
        expect(flowers).toBeGreaterThan(SMALL.flowers * 0.5);
        expect(meadow.stats.flowers).toBe(flowers);
        // Triangles are counted as they are drawn: each plant's own, times the plants.
        const drawn = (meshes) => sum(meshes.map((mesh) => mesh.count * (mesh.geometry.getIndex().count / 3)));
        expect(meadow.stats.grassTriangles).toBe(drawn(grassOf(meadow)));
        expect(meadow.stats.flowerTriangles).toBe(drawn(flowersOf(meadow)));
    });

    it('gives every draw the data of its own plants and the shape they share', () => {
        for (const mesh of meadow.group.children) {
            const { aRoot, aTurn } = mesh.geometry.attributes;
            for (const attribute of [aRoot, aTurn]) {
                expect(attribute.isInstancedBufferAttribute, mesh.name).toBe(true);
                expect(attribute.itemSize).toBe(4);
                expect(attribute.count).toBe(mesh.count);
                expect(allFinite(attribute.array)).toBe(true);
            }
            for (const name of ['position', 'paint', 'normal']) expect(mesh.geometry.getAttribute(name)).toBeDefined();
            expect(mesh.geometry.getIndex().count).toBeGreaterThan(0);
            expect(mesh.geometry.boundingSphere.radius).toBeGreaterThan(10);
            for (const plant of plants(mesh)) {
                // Turned about its root by an angle, scaled, with a phase and a hue of its own.
                expect(Math.hypot(plant.cos, plant.sin)).toBeCloseTo(1, 5);
                expect(plant.scale).toBeGreaterThan(0.2);
                expect(plant.scale).toBeLessThan(8);
                expect(plant.phase).toBeGreaterThanOrEqual(0);
                expect(plant.phase).toBeLessThan(1);
                expect(plant.hue).toBeGreaterThanOrEqual(0);
                expect(plant.hue).toBeLessThan(1);
            }
        }
        // Grass draws carry the blade coordinates the grass shader reads; flowers carry their colour.
        for (const mesh of grassOf(meadow)) expect(mesh.geometry.getAttribute('uv')).toBeDefined();
        for (const mesh of flowersOf(meadow)) expect(mesh.geometry.getAttribute('color')).toBeDefined();
    });

    it('roots every plant on the ground, where the lens can see it', () => {
        const sight = new VerdantHillsSight();
        let total = 0;
        let unseen = 0;
        for (const mesh of meadow.group.children) {
            for (const plant of plants(mesh)) {
                const floor = verdantHillsGroundHeight(plant.x, plant.z);
                // A thumb's depth into the turf, so no root shows on a slope; never floating.
                if (!(plant.y <= floor + 1e-3 && plant.y > floor - 0.06)) {
                    throw new Error(`${mesh.name} at ${plant.x}, ${plant.z} is ${plant.y - floor} m off the ground`);
                }
                const range = Math.hypot(plant.x - eye[0], plant.z - eye[2]);
                const bearing = Math.atan2(plant.x - eye[0], -(plant.z - eye[2]));
                // In front of the lens, within what the meadow's own survey covers.
                expect(Math.abs(bearing)).toBeLessThanOrEqual(sight.halfAngle + 1e-6);
                expect(range).toBeGreaterThan(1);
                expect(range).toBeLessThan(160);
                total += 1;
                if (!verdantHillsInSight(plant.x, floor + 0.45, plant.z)) unseen += 1;
                // Nothing grows where nothing can: not on the tread of the path, not in the trunk.
                expect(verdantHillsMeadowCover(plant.x, plant.z)).toBeGreaterThan(0);
            }
        }
        expect(total).toBeGreaterThan(1000);
        expect(unseen / total).toBeLessThan(0.02);
    });

    it('keeps the fine grass at the lens and the coarse grass beyond it', () => {
        const range = (plant) => Math.hypot(plant.x - eye[0], plant.z - eye[2]);
        const near = plants(grassOf(meadow).find((mesh) => /near/.test(mesh.name))).map(range);
        const far = plants(grassOf(meadow).find((mesh) => /far/.test(mesh.name))).map(range);
        expect(Math.max(...near)).toBeLessThan(Math.max(...far));
        expect(Math.min(...near)).toBeLessThan(Math.min(...far));
        // The two overlap, so there is no ring where the grass changes.
        expect(Math.min(...far)).toBeLessThan(Math.max(...near));
        // Planted evenly in the logarithm of distance: as many in the first half of it as the second.
        const middle = Math.sqrt(Math.min(...near) * Math.max(...near));
        const inner = near.filter((value) => value < middle).length / near.length;
        expect(inner).toBeGreaterThan(0.3);
        expect(inner).toBeLessThan(0.7);
        // On both sides of the gaze.
        const all = meadow.group.children.flatMap((mesh) => plants(mesh));
        const left = all.filter((plant) => plant.x < eye[0]).length / all.length;
        expect(left).toBeGreaterThan(0.25);
        expect(left).toBeLessThan(0.75);
    });

    it('counts its flowers by kind and knows where every dandelion clock stands', () => {
        expect(Object.keys(meadow.census).sort()).toEqual([...KINDS].sort());
        expect(sum(Object.values(meadow.census))).toBe(meadow.stats.flowers);
        for (const id of KINDS) {
            const draws = flowersOf(meadow).filter((mesh) => mesh.name.includes(` ${id} `));
            expect(sum(draws.map((mesh) => mesh.count)), id).toBe(meadow.census[id]);
        }
        // The down is not one flower from end to end.
        expect(Object.values(meadow.census).filter((count) => count > 0).length).toBeGreaterThanOrEqual(3);
        // One place for each clock: on the plant, about a clock's height above its root.
        expect(meadow.clocks).toHaveLength(meadow.census.clock * 3);
        expect(allFinite(meadow.clocks)).toBe(true);
        const clocks = flowersOf(meadow).filter((mesh) => mesh.name.includes(' clock '))
            .flatMap((mesh) => plants(mesh));
        const { tall } = VERDANT_HILLS_FLOWERS.find((flower) => flower.id === 'clock');
        for (let index = 0; index < meadow.clocks.length; index += 3) {
            const [x, y, z] = meadow.clocks.slice(index, index + 3);
            const plant = clocks.find((entry) => Math.abs(entry.x - x) < 1e-3 && Math.abs(entry.z - z) < 1e-3);
            expect(plant, `clock ${index / 3}`).toBeDefined();
            expect(y - plant.y).toBeGreaterThan(tall * plant.scale * 0.8);
            expect(y - plant.y).toBeLessThan(tall * plant.scale * 1.3);
        }
    });

    it('grows the same down from the same seed and another from another', () => {
        const again = new VerdantHillsMeadow({ light, tier: SMALL, rng: seededRandom(41) }).build();
        const other = new VerdantHillsMeadow({ light, tier: SMALL, rng: seededRandom(42) }).build();
        const roots = (built) => built.group.children
            .map((mesh) => [mesh.name, Array.from(mesh.geometry.attributes.aRoot.array)]);
        expect(roots(again)).toEqual(roots(meadow));
        expect(again.census).toEqual(meadow.census);
        expect(again.clocks).toEqual(meadow.clocks);
        expect(roots(other)).not.toEqual(roots(meadow));
        again.dispose();
        other.dispose();
    });

    it('plants less for a tier that asks for less, and nothing for one that asks for nothing', () => {
        const thin = new VerdantHillsMeadow({
            light,
            tier: {
                ...SMALL, grassNear: 40, grassFar: 60, flowers: 30,
            },
            rng: seededRandom(41),
        }).build();
        expect(thin.stats.grass).toBeLessThanOrEqual(100);
        expect(thin.stats.grass).toBeGreaterThan(50);
        expect(thin.stats.flowers).toBeLessThanOrEqual(30);
        thin.dispose();
        const bare = new VerdantHillsMeadow({
            light,
            tier: {
                ...SMALL, grassNear: 0, grassFar: 0, flowers: 0,
            },
            rng: seededRandom(41),
        });
        expect(() => bare.build()).not.toThrow();
        expect(bare.group.children).toHaveLength(0);
        expect(bare.stats).toEqual({
            grass: 0, flowers: 0, grassTriangles: 0, flowerTriangles: 0,
        });
        expect(bare.clocks).toEqual([]);
        expect(() => bare.dispose()).not.toThrow();
    });

    it.each(['Minimal', 'Medium'])('plants the %s tier within its budget', (quality) => {
        const tier = VERDANT_HILLS_TIERS[quality];
        const built = new VerdantHillsMeadow({ light, tier, rng: seededRandom(624) }).build();
        expect(built.stats.grass).toBeLessThanOrEqual(tier.grassNear + tier.grassFar);
        expect(built.stats.grass).toBeGreaterThan((tier.grassNear + tier.grassFar) * 0.8);
        expect(built.stats.flowers).toBeLessThanOrEqual(tier.flowers);
        expect(built.stats.flowers).toBeGreaterThan(tier.flowers * 0.5);
        expect(built.clocks.length).toBe(built.census.clock * 3);
        expect(built.census.clock).toBeGreaterThan(0);
        built.dispose();
    });

    it('releases everything it made and nothing it borrowed', () => {
        const built = new VerdantHillsMeadow({ light, tier: SMALL, rng: seededRandom(9) }).build();
        const parent = new THREE.Group();
        parent.add(built.group);
        const released = new Map();
        const watch = (resource, name) => {
            released.set(resource, 0);
            resource.addEventListener('dispose', () => released.set(resource, released.get(resource) + 1));
            return name;
        };
        const materials = new Set();
        for (const mesh of built.group.children) {
            watch(mesh.geometry, mesh.name);
            materials.add(mesh.material);
            watch(mesh, `${mesh.name} mesh`);
        }
        materials.forEach((material) => watch(material, material.name));
        built.owned.forEach((resource) => { if (!released.has(resource)) watch(resource, 'owned'); });
        const lightReleased = [];
        light.noiseTexture.addEventListener('dispose', () => lightReleased.push('noise'));
        built.dispose();
        // Each geometry, material and instanced draw exactly once.
        for (const [resource, count] of released) expect(count, resource.name || resource.type).toBe(1);
        expect(released.size).toBeGreaterThan(8);
        expect(parent.children).toHaveLength(0);
        expect(built.group.children).toHaveLength(0);
        expect(built.owned).toHaveLength(0);
        expect(lightReleased).toEqual([]);
        // Twice is no more than once.
        built.dispose();
        for (const count of released.values()) expect(count).toBe(1);
    });
});
