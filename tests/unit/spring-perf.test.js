/**
 * Spring — the frame's economies: the far leaves' level of detail (spring-forest.js), the mist's
 * cut-cornered puffs (spring-mist.js), the draw order and the instances' order, and the effects
 * that rest when nothing is happening. Each keeps the picture: these tests pin what is drawn,
 * not only that less is drawn.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, SpringWorld, fovForAspect, useValleyGround,
} from '../../src/themes/spring/spring-world.js';
import { EYE } from '../../src/themes/spring/spring-plan.js';
import { decodeValley } from '../../src/themes/spring/spring-terrain.js';
import { LEAF_LOD, leafLod, thinSpray } from '../../src/themes/spring/spring-forest.js';
import { puffGeometry } from '../../src/themes/spring/spring-mist.js';

const here = path.dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
    const file = path.resolve(here, '../../src/themes/spring/assets/spring-valley.bin');
    useValleyGround(decodeValley(new Uint8Array(zlib.inflateSync(fs.readFileSync(file)))));
});

/**
 * A leaf as the sprays draw it: a fan of `n` triangles from its stalk (vertex `base`) round an
 * ovate outline of n + 1 points, a little curved out of its plane. Returns its vertices and
 * triangles, appended to the arrays given.
 */
function addLeaf(position, index, n = 18, at = [0, 0, 0]) {
    const base = position.length / 3;
    position.push(at[0], at[1], at[2]);
    for (let i = 0; i <= n; i += 1) {
        const a = Math.PI * (i / n); // round from one side of the stalk, over the tip, to the other
        const width = 0.4 * Math.sin(a) * (1.15 - 0.3 * Math.cos(a));
        const along = 1 - Math.cos(a);
        position.push(at[0] + width * Math.cos(a * 2) * 0.9, at[1] + along, at[2] + 0.05 * along * along);
    }
    for (let i = 0; i < n; i += 1) index.push(base, base + 1 + i, base + 2 + i);
}

/** A twig as the sprays draw it: a three-sided tube of `rings` rings, each joined to the next. */
function addTwig(position, index, rings, at = [0, 0, 0]) {
    const first = position.length / 3;
    for (let ring = 0; ring < rings; ring += 1) {
        for (let k = 0; k < 3; k += 1) {
            const a = (k / 3) * Math.PI * 2;
            const bend = 0.01 * ring * ring;
            position.push(at[0] + 0.02 * Math.cos(a) + bend, at[1] + ring * 0.05, at[2] + 0.02 * Math.sin(a));
        }
    }
    for (let ring = 0; ring + 1 < rings; ring += 1) {
        for (let k = 0; k < 3; k += 1) {
            const a = first + ring * 3 + k;
            const b = first + ring * 3 + ((k + 1) % 3);
            index.push(a, b, a + 3, b, b + 3, a + 3);
        }
    }
    return first;
}

function area(position, index) {
    let sum = 0;
    for (let t = 0; t < index.length; t += 3) {
        const corner = (v) => new THREE.Vector3().fromArray(position, v * 3);
        const [a, b, c] = [corner(index[t]), corner(index[t + 1]), corner(index[t + 2])];
        sum += new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).length() / 2;
    }
    return sum;
}

describe('spring forest: the far leaves', () => {
    it('draws a leaf from every third point of its outline, the tip kept, at its own area', () => {
        const position = [];
        const index = [];
        addLeaf(position, index);
        const source = new Float32Array(position);
        const thin = thinSpray(index, source, { stride: 3 });
        expect(thin.index).toHaveLength(6 * 3);
        // Every triangle still turns about the stalk, in the same winding, and the tip (outline
        // point 9) and both corners at the stalk are kept.
        for (let t = 0; t < thin.index.length; t += 3) expect(thin.index[t]).toBe(0);
        expect(new Set(thin.index)).toEqual(new Set([0, 1, 4, 7, 10, 13, 16, 19]));
        expect(area(thin.position, thin.index)).toBeCloseTo(area(position, index), 6);
        // Only the kept outline points move.
        const moved = [];
        for (let v = 0; v < position.length / 3; v += 1) {
            if (source[v * 3 + 1] !== thin.position[v * 3 + 1]) moved.push(v);
        }
        expect(moved.every((v) => thin.index.includes(v))).toBe(true);
    });

    it('draws a far leaf as its stalk, its tip and the corners at the stalk, at its own area', () => {
        const position = [];
        const index = [];
        addLeaf(position, index);
        const thin = thinSpray(index, new Float32Array(position));
        expect(LEAF_LOD.stride).toBe(9);
        expect(thin.index).toEqual([0, 1, 10, 0, 10, 19]);
        expect(area(thin.position, thin.index)).toBeCloseTo(area(position, index), 6);
    });

    it('keeps twigs, small fans and anything else whole', () => {
        const position = [];
        const index = [];
        addLeaf(position, index, 18, [0, 0, 0]);
        addLeaf(position, index, 4, [3, 0, 0]); // a strand leaf: four triangles
        addTwig(position, index, 3, [6, 0, 0]); // a stub of a twig: two segments
        // An open strip (a spruce shoot): rows of three, four triangles a row.
        const shoot = position.length / 3;
        for (let row = 0; row < 5; row += 1) {
            position.push(9 - 0.05, row * 0.1, 0, 9, row * 0.1, 0.02, 9 + 0.05, row * 0.1, 0);
        }
        for (let row = 0; row < 4; row += 1) {
            const o = shoot + row * 3;
            index.push(o, o + 1, o + 3, o + 1, o + 4, o + 3, o + 1, o + 2, o + 4, o + 2, o + 5, o + 4);
        }
        const thin = thinSpray(index, new Float32Array(position));
        expect(thin.index.length / 3).toBe(2 + 4 + 12 + 16);
        expect(thin.index.slice(-(4 + 12 + 16) * 3)).toEqual(index.slice(-(4 + 12 + 16) * 3));
    });

    it('draws a twig from its first, middle and last rings', () => {
        const position = [];
        const index = [];
        const first = addTwig(position, index, 7);
        const thin = thinSpray(index, new Float32Array(position));
        // Two segments of six triangles, joining rings 0 → 3 → 6, in the same winding.
        expect(thin.index).toHaveLength(2 * 6 * 3);
        const rings = new Set(thin.index.map((v) => Math.floor((v - first) / 3)));
        expect([...rings].sort()).toEqual([0, 3, 6]);
        expect(thin.index.slice(0, 3)).toEqual([first, first + 1, first + 9]);
        expect(Array.from(thin.position)).toEqual(Array.from(new Float32Array(position)));
    });

    it('builds the far spray once, sharing every attribute but the moved positions', () => {
        const position = [];
        const index = [];
        for (let k = 0; k < 3; k += 1) addLeaf(position, index, 18, [k, 0, 0]);
        const spray = new THREE.BufferGeometry();
        spray.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
        spray.setAttribute('normal', new THREE.Float32BufferAttribute(position.map(() => 0.5), 3));
        spray.setIndex(index);
        const far = leafLod(spray);
        expect(leafLod(spray)).toBe(far);
        expect(far.index.count).toBe(3 * 2 * 3);
        expect(far.attributes.normal).toBe(spray.attributes.normal);
        expect(far.attributes.position).not.toBe(spray.attributes.position);
        // A spray thinning would not change is drawn as it is.
        const strand = new THREE.BufferGeometry();
        const p2 = [];
        const i2 = [];
        addLeaf(p2, i2, 4);
        strand.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
        strand.setIndex(i2);
        expect(leafLod(strand)).toBe(strand);
        expect(LEAF_LOD.from).toBeLessThan(60); // every modelled tree stands farther off than this
    });
});

describe('spring mist: the puffs', () => {
    it('cuts the card\'s corners outside the circle its sides touch, and no more', () => {
        const geometry = puffGeometry();
        const p = geometry.attributes.position;
        for (let i = 1; i < p.count; i += 1) {
            // Every corner lies on the unit square's edge (±0.5), outside the circle it touches.
            expect(Math.max(Math.abs(p.getX(i)), Math.abs(p.getY(i)))).toBeCloseTo(0.5, 6);
        }
        // Every side of the octagon touches the circle of radius 0.5: its middle lies on it.
        const index = geometry.index.array;
        for (let t = 0; t < index.length; t += 3) {
            const mx = (p.getX(index[t + 1]) + p.getX(index[t + 2])) / 2;
            const my = (p.getY(index[t + 1]) + p.getY(index[t + 2])) / 2;
            expect(Math.hypot(mx, my)).toBeCloseTo(0.5, 6);
        }
        expect(area(Array.from(p.array), Array.from(index))).toBeCloseTo(8 * Math.tan(Math.PI / 8) * 0.25, 6);
    });
});

describe('spring world: order and rest', () => {
    const makeWorld = (quality = 'Low') => {
        const scene = new THREE.Scene();
        const aspect = 16 / 9;
        const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        const world = new SpringWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, aspect);
        return { camera, world };
    };

    it('draws the ground after the river, the meadow and the stones that hide it', () => {
        const { world } = makeWorld();
        const land = world.parts.land.mesh;
        expect(land.renderOrder).toBeGreaterThan(world.parts.river.mesh.renderOrder);
        // Drawn after the river, the ground still loses to it where their depths tie (far off).
        expect(land.material.depthFunc).toBe(THREE.LessDepth);
        expect(world.parts.river.mesh.material.depthFunc).toBe(THREE.LessEqualDepth);
        world.parts.meadow.mesh.traverse((object) => {
            if (object.isMesh) expect(object.renderOrder).toBeLessThan(land.renderOrder);
        });
        expect(world.parts.sky.mesh.renderOrder).toBeGreaterThan(land.renderOrder);
        world.dispose();
    });

    it('stands the meadow\'s plants nearest first', () => {
        const { world } = makeWorld();
        let draws = 0;
        world.parts.meadow.mesh.traverse((object) => {
            if (!object.isInstancedMesh) return;
            draws += 1;
            const roots = object.geometry.attributes.aRoot.array;
            let last = -1;
            for (let i = 0; i < roots.length; i += 4) {
                const d = Math.hypot(roots[i] - EYE.x, roots[i + 2] - EYE.z);
                expect(d).toBeGreaterThanOrEqual(last);
                last = d;
            }
        });
        expect(draws).toBeGreaterThan(2);
        world.dispose();
    });

    it('leaves the ice and the birds alone while none are out, and wakes them when they are', () => {
        const { camera, world } = makeWorld();
        const step = (t) => {
            world.updateCamera(camera, { time: t, delta: 1 / 30 });
            world.update({ time: t, delta: 1 / 30 }, camera);
        };
        step(0.1);
        const floes = world.floes.mesh.instanceMatrix;
        const birds = world.flights.meshes.map((mesh) => mesh.instanceMatrix);
        const versions = () => [floes.version, ...birds.map((b) => b.version)];
        const idle = versions();
        for (let t = 0.2; t < 1; t += 0.1) step(t);
        expect(versions()).toEqual(idle);
        // Four lines and a perfect clear: the ice goes out and the swans come over.
        world.onClear({ lines: 4, rowCodes: [], combo: 1 });
        world.onClear({ lines: 4, perfect: true });
        for (let t = 1; t < 4; t += 0.1) step(t);
        expect(world.floes.live).toBeGreaterThan(0);
        expect(world.flights.live.some((n) => n > 0)).toBe(true);
        expect(floes.version).toBeGreaterThan(idle[0]);
        world.dispose();
    });
});
