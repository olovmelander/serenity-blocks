import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    SUMMER_FLOWERS, createSummerFlowerGeometry, createSummerGrassGeometry, createSummerLilyGeometry,
    summerFlowerSlotForPiece,
} from '../../src/themes/summer/summer-flowers.js';
import {
    SUMMER_BOUQUET_KINDS, SUMMER_PIECE_FLOWERS, SummerReactions,
} from '../../src/themes/summer/summer-reactions.js';

const IDS = SUMMER_FLOWERS.map((flower) => flower.id);
const LETTERS = Object.keys(SUMMER_PIECE_FLOWERS);
/** What the meadow's flower shader reads from every vertex, and how wide each is. */
const FLOWER_ATTRIBUTES = {
    position: 3, normal: 3, color: 3, paint: 4, head: 4,
};
const GRASS_ATTRIBUTES = {
    position: 3, normal: 3, uv: 2, paint: 4,
};
/** The parts a vertex can belong to: stem and leaf, the eye of a flower, seed down, petal. */
const PARTS = [0, 0.5, 0.75, 1];
/** Every shape the meadow draws of every kind: two near variants and the far one. */
const SHAPES = IDS.flatMap((id) => [
    [id, 'near', { far: false, variant: 0 }],
    [id, 'near, second shape', { far: false, variant: 1 }],
    [id, 'far', { far: true, variant: 0 }],
]);

const triangles = (geometry) => geometry.index.count / 3;
const vertices = (geometry) => geometry.getAttribute('position').count;

/** Everything a broken builder could get wrong about a mesh, as readable messages. */
function meshProblems(geometry, attributes) {
    const problems = [];
    const check = (condition, message) => { if (!condition) problems.push(message); };
    const count = vertices(geometry);
    check(count > 0, 'no vertices');
    check(
        Object.keys(geometry.attributes).sort().join() === Object.keys(attributes).sort().join(),
        `attributes ${Object.keys(geometry.attributes)}`,
    );
    for (const [name, size] of Object.entries(attributes)) {
        const attribute = geometry.getAttribute(name);
        check(Boolean(attribute), `no ${name}`);
        if (attribute) {
            check(attribute.itemSize === size, `${name} is ${attribute.itemSize} wide`);
            check(attribute.count === count, `${name} has ${attribute.count} of ${count}`);
            check(attribute.array instanceof Float32Array, `${name} is not float`);
            check(attribute.array.every(Number.isFinite), `${name} is not finite`);
        }
    }
    const { index } = geometry;
    check(Boolean(index), 'not indexed');
    if (!index) return problems;
    check(index.count > 0 && index.count % 3 === 0, `${index.count} indices`);
    const used = new Set();
    const position = geometry.getAttribute('position');
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let corner = 0; corner < index.count; corner += 3) {
        const corners = [index.getX(corner), index.getX(corner + 1), index.getX(corner + 2)];
        corners.forEach((vertex) => used.add(vertex));
        check(
            corners.every((vertex) => Number.isInteger(vertex) && vertex >= 0 && vertex < count),
            `triangle ${corner / 3} points outside the mesh`,
        );
        a.fromBufferAttribute(position, corners[0]);
        b.fromBufferAttribute(position, corners[1]);
        c.fromBufferAttribute(position, corners[2]);
        const area = b.sub(a).cross(c.sub(a)).length() / 2;
        // A petal is a few square centimetres; anything a million times smaller is a slip.
        check(area > 1e-9, `triangle ${corner / 3} has no area`);
    }
    check(used.size === count, `${count - used.size} vertices belong to no triangle`);
    const normal = geometry.getAttribute('normal');
    for (let vertex = 0; normal && vertex < count; vertex++) {
        const length = Math.hypot(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
        check(Math.abs(length - 1) < 1e-3, `normal ${vertex} has length ${length}`);
    }
    const sphere = geometry.boundingSphere;
    check(Boolean(sphere) && Number.isFinite(sphere.radius) && sphere.radius > 0, 'no bounding sphere');
    return problems;
}

/** Lowest and highest vertex, and how far the plant reaches from the line through its root. */
function extent(geometry) {
    const position = geometry.getAttribute('position');
    let [low, high, reach] = [Infinity, -Infinity, 0];
    for (let vertex = 0; vertex < position.count; vertex++) {
        low = Math.min(low, position.getY(vertex));
        high = Math.max(high, position.getY(vertex));
        reach = Math.max(reach, Math.hypot(position.getX(vertex), position.getZ(vertex)));
    }
    return { low, high, reach };
}

/** One record per vertex, for the checks that read several attributes together. */
function rows(geometry) {
    const read = (name) => geometry.getAttribute(name);
    return Array.from({ length: vertices(geometry) }, (_, vertex) => ({
        y: read('position').getY(vertex),
        colour: ['getX', 'getY', 'getZ'].map((get) => read('color')[get](vertex)),
        height: read('paint').getX(vertex),
        part: read('paint').getY(vertex),
        along: read('paint').getZ(vertex),
        spare: read('paint').getW(vertex),
        offset: Math.hypot(read('head').getX(vertex), read('head').getY(vertex), read('head').getZ(vertex)),
        kind: read('head').getW(vertex),
    }));
}

const arrays = (geometry) => Object.fromEntries([
    ...Object.entries(geometry.attributes).map(([name, attribute]) => [name, Array.from(attribute.array)]),
    ['index', Array.from(geometry.index.array)],
]);

describe('Summer flowers', () => {
    describe('the kinds', () => {
        it('lists the seven flowers of the bouquet and the company they keep', () => {
            expect(Object.isFrozen(SUMMER_FLOWERS)).toBe(true);
            expect(new Set(IDS).size).toBe(SUMMER_FLOWERS.length);
            const seven = SUMMER_FLOWERS.filter((flower) => flower.piece !== null);
            expect(seven).toHaveLength(SUMMER_BOUQUET_KINDS);
            // Each of the seven has an excitement slot of its own, 0..6, in table order.
            expect(seven.map((flower) => flower.slot)).toEqual([...Array(SUMMER_BOUQUET_KINDS).keys()]);
            expect(SUMMER_FLOWERS.slice(0, SUMMER_BOUQUET_KINDS)).toEqual(seven);
            // The rest share a slot past the seven that the director still decays.
            const slots = new SummerReactions().species.length;
            for (const flower of SUMMER_FLOWERS.filter((entry) => entry.piece === null)) {
                expect(flower.slot, flower.id).toBeGreaterThanOrEqual(SUMMER_BOUQUET_KINDS);
                expect(flower.slot, flower.id).toBeLessThan(slots);
            }
            for (const flower of SUMMER_FLOWERS) {
                expect(typeof flower.id === 'string' && flower.id.length > 0).toBe(true);
                expect(Number.isInteger(flower.slot)).toBe(true);
                expect(Number.isInteger(flower.petal), flower.id).toBe(true);
                expect(flower.petal >= 0 && flower.petal <= 0xffffff, flower.id).toBe(true);
                // How much of the meadow it takes, where its drifts grow, and how it likes the crest.
                expect(flower.share, flower.id).toBeGreaterThan(0);
                expect(flower.share, flower.id).toBeLessThan(1);
                expect(flower.patch).toHaveLength(2);
                expect(flower.patch[0], flower.id).toBeGreaterThan(0);
                expect(flower.patch[1], flower.id).toBeGreaterThan(0);
                expect(flower.patch[1], flower.id).toBeLessThan(1);
                expect(flower.crest, flower.id).toBeGreaterThanOrEqual(0);
                expect(flower.tall, flower.id).toBeGreaterThan(0);
            }
            // The seven are told apart by colour.
            expect(new Set(seven.map((flower) => flower.petal)).size).toBe(SUMMER_BOUQUET_KINDS);
        });

        it('gives each tetromino a flower of its own, the one the reactions name', () => {
            expect(LETTERS.slice().sort()).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
            const slots = LETTERS.map((letter) => summerFlowerSlotForPiece(letter));
            expect(slots.slice().sort()).toEqual([...Array(SUMMER_BOUQUET_KINDS).keys()]);
            for (const letter of LETTERS) {
                // One table in the director, one in the meadow: they must say the same.
                expect(summerFlowerSlotForPiece(letter), letter).toBe(SUMMER_PIECE_FLOWERS[letter]);
                const flower = SUMMER_FLOWERS.find((entry) => entry.piece === letter);
                expect(flower.slot).toBe(SUMMER_PIECE_FLOWERS[letter]);
                // The geometry of that kind carries the same slot to the shader.
                const head = createSummerFlowerGeometry(flower.id).getAttribute('head');
                expect(head.getW(0)).toBe(SUMMER_PIECE_FLOWERS[letter]);
            }
            for (const piece of [undefined, '', 'X', 'i', 'II', 0, 3, {}, [], 'clover', 'GARBAGE']) {
                expect(summerFlowerSlotForPiece(piece), String(piece)).toBe(-1);
            }
        });

        // The company (clover, cow parsley, dandelion clocks) is listed with `piece: null`: asking
        // for the flower of "no piece" must not find clover.
        it('has no flower for a piece that is null', () => {
            expect(summerFlowerSlotForPiece(null)).toBe(-1);
        });
    });

    describe('geometry', () => {
        it.each(SHAPES)('builds %s (%s) as a finite, indexed mesh with all the shader reads', (id, _label, options) => {
            const geometry = createSummerFlowerGeometry(id, options);
            expect(meshProblems(geometry, FLOWER_ATTRIBUTES)).toEqual([]);
            expect(geometry.name).toContain(id);
            const kind = SUMMER_FLOWERS.find((flower) => flower.id === id);
            const plant = rows(geometry);
            for (const vertex of plant) {
                // Height above the root is what the wind may carry: it is the vertex's own height.
                expect(vertex.height).toBe(Math.max(0, vertex.y));
                expect(PARTS).toContain(vertex.part);
                expect(vertex.along).toBeGreaterThanOrEqual(0);
                expect(vertex.along).toBeLessThanOrEqual(1);
                expect(vertex.spare).toBe(0);
                // The whole plant answers the call on its kind.
                expect(vertex.kind).toBe(kind.slot);
                // Linear albedo, not light.
                for (const channel of vertex.colour) {
                    expect(channel).toBeGreaterThanOrEqual(0);
                    expect(channel).toBeLessThanOrEqual(1);
                }
            }
            // It stands on its root: nothing under the ground, and it is the height of a wildflower.
            const { low, high, reach } = extent(geometry);
            expect(low).toBeGreaterThan(-0.02);
            expect(low).toBeLessThan(0.02);
            expect(high).toBeGreaterThan(0.15);
            expect(high).toBeLessThan(2);
            expect(reach).toBeLessThan(high);
            expect(geometry.boundingSphere.radius).toBeLessThan(high);
        });

        it.each(SHAPES)('gives %s (%s) a head that can swell on a stem that stays put', (id, _label, options) => {
            const plant = rows(createSummerFlowerGeometry(id, options));
            const head = plant.filter((vertex) => vertex.offset > 0);
            const stem = plant.filter((vertex) => vertex.offset === 0);
            expect(head.length).toBeGreaterThan(2);
            expect(stem.length).toBeGreaterThan(2);
            // Everything that is petal or seed down belongs to a head, and has somewhere to swell to.
            for (const vertex of plant.filter((entry) => entry.part >= 0.75)) expect(vertex.offset).toBeGreaterThan(0);
            // An offset is measured from the middle of the vertex's own head: centimetres, not metres.
            const { high } = extent(createSummerFlowerGeometry(id, options));
            for (const vertex of head) expect(vertex.offset).toBeLessThan(high * 0.5);
            // Heads are carried aloft; the foot of the plant is stem.
            expect(Math.max(...head.map((vertex) => vertex.y))).toBeGreaterThan(high * 0.7);
            expect(Math.min(...stem.map((vertex) => vertex.y))).toBeLessThan(0.02);
        });

        it('makes the far version of every kind much lighter than the near one', () => {
            let [near, far] = [0, 0];
            for (const id of IDS) {
                const detailed = createSummerFlowerGeometry(id);
                const simple = createSummerFlowerGeometry(id, { far: true });
                expect(triangles(simple), id).toBeLessThan(triangles(detailed) * 0.6);
                expect(vertices(simple), id).toBeLessThan(vertices(detailed));
                // Simple, but still a plant of the same size standing in the same place.
                expect(triangles(simple), id).toBeGreaterThanOrEqual(4);
                expect(extent(simple).high / extent(detailed).high, id).toBeGreaterThan(0.6);
                expect(extent(simple).high / extent(detailed).high, id).toBeLessThan(1.6);
                expect(simple.name).not.toBe(detailed.name);
                near += triangles(detailed);
                far += triangles(simple);
            }
            // Tens of thousands of them are drawn beyond the crest.
            expect(far).toBeLessThan(near / 4);
        });

        it('builds the same plant for the same kind and variant, whatever was built before it', () => {
            for (const id of IDS) {
                const first = arrays(createSummerFlowerGeometry(id, { variant: 1 }));
                // Other plants in between do not disturb it.
                createSummerFlowerGeometry(IDS[(IDS.indexOf(id) + 3) % IDS.length]);
                createSummerGrassGeometry({ seed: 5 });
                expect(arrays(createSummerFlowerGeometry(id, { variant: 1 })), id).toEqual(first);
                // A variant is another plant of the same kind; far is another again.
                const other = arrays(createSummerFlowerGeometry(id, { variant: 0 }));
                expect(other.position, id).not.toEqual(first.position);
                expect(new Set(other.head.filter((_, index) => index % 4 === 3)))
                    .toEqual(new Set(first.head.filter((_, index) => index % 4 === 3)));
                expect(arrays(createSummerFlowerGeometry(id, { far: true })).position).not.toEqual(other.position);
            }
            // The default is the near plant, first variant.
            expect(arrays(createSummerFlowerGeometry('daisy')))
                .toEqual(arrays(createSummerFlowerGeometry('daisy', { far: false, variant: 0 })));
            // Each call hands out a geometry of its own to dispose of.
            expect(createSummerFlowerGeometry('daisy')).not.toBe(createSummerFlowerGeometry('daisy'));
        });

        it('tells the kinds apart in shape, not only in colour', () => {
            const shapes = IDS.map((id) => {
                const geometry = createSummerFlowerGeometry(id);
                return `${vertices(geometry)}/${triangles(geometry)}`;
            });
            expect(new Set(shapes).size).toBe(IDS.length);
        });

        it('refuses a flower it does not know', () => {
            for (const id of ['tulip', '', undefined, null, 'Daisy', 'DAISY', ' daisy', 7]) {
                expect(() => createSummerFlowerGeometry(id), String(id)).toThrow(/Unknown flower/);
            }
            // Nothing that is not a flower is ever built, whatever else an object answers to.
            for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
                expect(() => createSummerFlowerGeometry(id), id).toThrow();
            }
        });
    });

    describe('water lilies', () => {
        it('lays a pad on the lake and stands a flower beside it when asked', () => {
            const pad = createSummerLilyGeometry();
            const flowering = createSummerLilyGeometry({ flowering: true });
            for (const geometry of [pad, flowering]) {
                expect(meshProblems(geometry, FLOWER_ATTRIBUTES)).toEqual([]);
                const { low, high, reach } = extent(geometry);
                // Flat on the water, a hand or two across.
                expect(low).toBe(0);
                expect(high).toBeLessThan(0.2);
                expect(reach).toBeGreaterThan(0.1);
                expect(reach).toBeLessThan(0.8);
                const plant = rows(geometry);
                // Planted with the meadow's shader, as one of the company and not one of the seven.
                expect(new Set(plant.map((vertex) => vertex.kind)).size).toBe(1);
                expect(plant[0].kind).toBeGreaterThanOrEqual(SUMMER_BOUQUET_KINDS);
                // One small height for every vertex, so the wind rocks the whole plant as one.
                expect(new Set(plant.map((vertex) => vertex.height)).size).toBe(1);
                expect(plant[0].height).toBeGreaterThan(0);
                expect(plant[0].height).toBeLessThan(1);
            }
            // The pad alone is leaf; the flower adds an eye and petals above it.
            expect(rows(pad).every((vertex) => vertex.part === 0)).toBe(true);
            expect(rows(flowering).some((vertex) => vertex.part === 1)).toBe(true);
            expect(rows(flowering).some((vertex) => vertex.part === 0.5)).toBe(true);
            expect(triangles(flowering)).toBeGreaterThan(triangles(pad) * 2);
            expect(extent(flowering).high).toBeGreaterThan(extent(pad).high);
            expect(flowering.name).not.toBe(pad.name);
            expect(arrays(createSummerLilyGeometry({ flowering: false }))).toEqual(arrays(pad));
        });
    });

    describe('grass', () => {
        it.each([
            ['near', false], ['far', true],
        ])('builds a %s clump as a finite, indexed mesh rooted in the ground', (_label, far) => {
            const geometry = createSummerGrassGeometry({ far, seed: 11 });
            expect(meshProblems(geometry, GRASS_ATTRIBUTES)).toEqual([]);
            const { low, high, reach } = extent(geometry);
            expect(low).toBe(0);
            expect(high).toBeGreaterThan(0.2);
            expect(high).toBeLessThan(1.5);
            expect(reach).toBeLessThan(high);
            const position = geometry.getAttribute('position');
            const uv = geometry.getAttribute('uv');
            const paint = geometry.getAttribute('paint');
            const blades = new Map();
            for (let vertex = 0; vertex < position.count; vertex++) {
                // uv.y runs from root to tip; paint.x is the height the wind works on.
                expect(uv.getY(vertex)).toBeGreaterThanOrEqual(0);
                expect(uv.getY(vertex)).toBeLessThanOrEqual(1);
                expect(paint.getX(vertex)).toBe(position.getY(vertex));
                expect([0, 1]).toContain(paint.getY(vertex));
                // uv.x names the blade, and the shader finds the same name in paint.z.
                expect(paint.getZ(vertex)).toBe(uv.getX(vertex));
                const blade = blades.get(uv.getX(vertex)) || [];
                blade.push({ along: uv.getY(vertex), height: position.getY(vertex) });
                blades.set(uv.getX(vertex), blade);
            }
            expect(blades.size).toBeGreaterThanOrEqual(4);
            for (const blade of blades.values()) {
                // Every blade starts at the root and ends at its own tip, climbing all the way.
                const sorted = blade.slice().sort((a, b) => a.along - b.along);
                expect(sorted[0]).toEqual({ along: 0, height: 0 });
                expect(sorted.at(-1).along).toBe(1);
                expect(sorted.at(-1).height).toBeGreaterThan(0.2);
                for (let rung = 1; rung < sorted.length; rung++) {
                    expect(sorted[rung].height).toBeGreaterThanOrEqual(sorted[rung - 1].height);
                }
            }
        });

        it('stands seed heads above a near clump and keeps a far one to a handful of triangles', () => {
            const near = createSummerGrassGeometry({ seed: 11 });
            const far = createSummerGrassGeometry({ far: true, seed: 11 });
            const marks = (geometry) => {
                const position = geometry.getAttribute('position');
                const paint = geometry.getAttribute('paint');
                const heads = [];
                const blades = [];
                for (let vertex = 0; vertex < position.count; vertex++) {
                    (paint.getY(vertex) > 0 ? heads : blades).push(position.getY(vertex));
                }
                return { heads, blades };
            };
            const close = marks(near);
            expect(close.heads.length).toBeGreaterThan(0);
            expect(close.heads.length).toBeLessThan(close.blades.length);
            // The head is carried at the top of its stalk, over the leaves.
            expect(Math.min(...close.heads)).toBeGreaterThan(Math.max(...close.blades) * 0.7);
            expect(marks(far).heads).toEqual([]);
            expect(triangles(far)).toBeLessThan(triangles(near) * 0.5);
            expect(vertices(far)).toBeLessThan(vertices(near) * 0.5);
            // Fewer blades, each broader, so a far clump still covers its ground.
            const widest = (geometry) => {
                const position = geometry.getAttribute('position');
                let width = 0;
                for (let vertex = 0; vertex + 1 < position.count; vertex += 2) {
                    width = Math.max(width, Math.hypot(
                        position.getX(vertex + 1) - position.getX(vertex),
                        position.getZ(vertex + 1) - position.getZ(vertex),
                    ));
                }
                return width;
            };
            expect(widest(far)).toBeGreaterThan(widest(near) * 1.5);
        });

        it('grows the same clump from the same seed and another from another', () => {
            for (const far of [false, true]) {
                const first = arrays(createSummerGrassGeometry({ far, seed: 23 }));
                createSummerFlowerGeometry('poppy');
                expect(arrays(createSummerGrassGeometry({ far, seed: 23 }))).toEqual(first);
                const other = arrays(createSummerGrassGeometry({ far, seed: 24 }));
                expect(other.position).not.toEqual(first.position);
                // The same mesh, differently grown.
                expect(other.index).toEqual(first.index);
            }
            expect(meshProblems(createSummerGrassGeometry(), GRASS_ATTRIBUTES)).toEqual([]);
            expect(createSummerGrassGeometry({ far: true }).name).not.toBe(createSummerGrassGeometry().name);
        });
    });
});
