import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { VerdantHillsLight } from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { verdantHillsTier } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import {
    VerdantHillsTerrain, prepareGroundSteps, vertexNormalsSteps,
} from '../../src/themes/verdant-hills/verdant-hills-terrain.js';
import { seededRandom } from '../../src/utils/helpers.js';

/**
 * Verdant Hills built its ground mesh (the wedge's rings over the height function) in one 43 ms
 * build step on every start. It is built in steps once a session now, and each start gets its own
 * geometry over the kept arrays.
 */
const run = (steps) => {
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
    }
};

/** Run steps to the end; how many breaths they took and what they returned. */
function count(steps) {
    let yields = 0;
    let next = steps.next();
    while (!next.done) {
        yields += 1;
        next = steps.next();
    }
    return { yields, value: next.value };
}

/** A clock that moves 30 ms each time it is read: every check is past the step budget. */
function slowClock() {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
        now += 30;
        return now;
    });
}

/** The same normals as three makes them (computeVertexNormals), as the float32 words. */
function threeNormals(position, index) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    return new Uint32Array(geometry.getAttribute('normal').array.buffer);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Verdant Hills keeps its ground for the session', () => {
    it('prepares once, then every terrain shares the kept arrays in a geometry of its own', () => {
        const light = new VerdantHillsLight({ tier: verdantHillsTier('Low'), rng: () => 0.5 });
        run(prepareGroundSteps());
        expect(run(prepareGroundSteps())).toBe(false);
        const a = new VerdantHillsTerrain({ light }).build();
        const b = new VerdantHillsTerrain({ light }).build();
        expect(b.mesh.geometry).not.toBe(a.mesh.geometry);
        for (const name of ['position', 'normal']) {
            expect(b.mesh.geometry.getAttribute(name).array).toBe(a.mesh.geometry.getAttribute(name).array);
        }
        expect(b.triangles).toBe(a.triangles);
        expect(a.triangles).toBeGreaterThan(0);
        // Its normals are summed a time slice a step: the very bits three's computeVertexNormals makes.
        const { geometry } = a.mesh;
        const normals = new Uint32Array(geometry.getAttribute('normal').array.buffer);
        expect(normals).toEqual(threeNormals(geometry.getAttribute('position').array, geometry.index.array));
    }, 60_000);

    it('sums the normals in steps, bit for bit as three does, faces naming a corner twice included', () => {
        const random = seededRandom(5);
        const position = Float32Array.from({ length: 900 }, () => random() * 10 - 5);
        const index = Uint32Array.from({ length: 1800 }, () => Math.floor(random() * 300));
        for (let i = 0; i < 90; i += 3) index[i + 1] = index[i];
        const stepped = count(vertexNormalsSteps(position, index, { due: () => true, restart() {} }));
        expect(stepped.yields).toBeGreaterThan(0);
        expect(new Uint32Array(stepped.value.buffer)).toEqual(threeNormals(position, index));
    });
});

describe('Verdant Hills plants its layout in steps on a first visit', () => {
    it.each([
        ['field', 'layoutVerdantHillsFieldTrees', 1],
        ['far', 'layoutVerdantHillsFarTrees', 2],
        ['sheep', 'layoutVerdantHillsSheep', 3],
    ])('%s: the steps plant what one call plants; a later prepare does not step', async (name, list, salt) => {
        // A layout module of its own: its lists are planted once a module.
        vi.resetModules();
        const layout = await import('../../src/themes/verdant-hills/verdant-hills-layout.js');
        slowClock();
        const first = count(layout.prepareVerdantHillsLayoutSteps(name));
        vi.restoreAllMocks();
        expect(first.value).toBe(true);
        expect(first.yields).toBeGreaterThan(3);
        expect(count(layout.prepareVerdantHillsLayoutSteps(name))).toEqual({ yields: 0, value: false });
        expect(layout[list]()).toEqual(layout[list](seededRandom(layout.VERDANT_HILLS_LAYOUT_SEED + salt)));
    }, 60_000);
});
