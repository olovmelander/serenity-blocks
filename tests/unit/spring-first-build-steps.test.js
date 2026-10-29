/**
 * Spring's first visit builds its four big meshes' geometry (land, step face, river, pour) in
 * steps of ~24 ms instead of one 185 ms and one 166 ms step (docs/THEME_FLEET_240_2026-10.md §13).
 * The steps must build exactly what one call builds, and a later visit must not step at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { useValleyGround, valleyGround } from '../../src/themes/spring/spring-world.js';
import { decodeValley } from '../../src/themes/spring/spring-terrain.js';
import { tierFor } from '../../src/themes/spring/spring-quality.js';
import { createLand, createLandGeometry, prepareLandSteps } from '../../src/themes/spring/spring-land.js';
import {
    createFaceGeometry, createPour, createPourGeometry, createStepFace, prepareFaceSteps, preparePourSteps,
} from '../../src/themes/spring/spring-fall.js';
import { createRiver, createRiverGeometry, prepareRiverSteps } from '../../src/themes/spring/spring-river.js';
import { faceAlong, lipDepth } from '../../src/themes/spring/spring-fall-plan.js';
import { createUniforms } from '../../src/themes/spring/spring-tsl.js';

const here = path.dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
    const file = path.resolve(here, '../../src/themes/spring/assets/spring-valley.bin');
    useValleyGround(decodeValley(new Uint8Array(zlib.inflateSync(fs.readFileSync(file)))));
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** A clock that moves 30 ms each time it is read: every check is past the step budget. */
function slowClock() {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
        now += 30;
        return now;
    });
}

/** Run steps to the end; how many breaths they took and what they returned. */
function run(steps) {
    let yields = 0;
    let next = steps.next();
    while (!next.done) {
        yields += 1;
        next = steps.next();
    }
    return { yields, value: next.value };
}

function expectSameGeometry(a, b) {
    expect(Object.keys(b.attributes).sort()).toEqual(Object.keys(a.attributes).sort());
    for (const name of Object.keys(a.attributes)) expect(b.attributes[name].array).toEqual(a.attributes[name].array);
    expect(b.index.array).toEqual(a.index.array);
}

describe('spring first visit: the big meshes built in steps', () => {
    const textures = { noise: new THREE.DataTexture(), lattice: new THREE.DataTexture() };
    const tier = tierFor('Low');
    const cases = [
        {
            name: 'land',
            direct: (ground) => createLandGeometry(ground, tier).geometry,
            prepare: (ground) => prepareLandSteps(ground, tier),
            make: (ground) => createLand(createUniforms(), textures, tier, ground),
        },
        {
            name: 'step face',
            direct: (ground) => createFaceGeometry(ground, {
                cols: tier.faceCols ?? 300, rows: tier.faceRows ?? 170,
            }).geometry,
            prepare: (ground) => prepareFaceSteps(ground, tier),
            make: (ground) => createStepFace(createUniforms(), textures, tier, ground),
        },
        {
            name: 'river',
            direct: (ground) => createRiverGeometry({
                cols: tier.riverCols ?? 40, detail: tier.riverDetail ?? 1, baked: ground,
            }).geometry,
            prepare: (ground) => prepareRiverSteps(tier, ground),
            make: (ground) => createRiver(createUniforms(), textures, tier, ground),
        },
    ];

    it.each(cases)('$name: steps build what one call builds; a second visit does not step', (c) => {
        // A ground object of its own: the session memo is keyed on it, so this is a first visit.
        const ground = { ...valleyGround() };
        const direct = c.direct(ground);
        slowClock();
        const first = run(c.prepare(ground));
        expect(first.value).toBe(true);
        expect(first.yields).toBeGreaterThan(3);
        vi.restoreAllMocks();
        const part = c.make(ground);
        expectSameGeometry(direct, part.mesh.geometry);
        expect(run(c.prepare(ground))).toEqual({ yields: 0, value: false });
        part.dispose();
    });

    it('the pour (no ground: one per session and tier) steps too, and matches one call', () => {
        const pourTier = { pourCols: 37, pourRows: 23 };
        const direct = createPourGeometry({ cols: 37, rows: 23 }).geometry;
        slowClock();
        const first = run(preparePourSteps(pourTier));
        expect(first).toMatchObject({ value: true });
        expect(first.yields).toBeGreaterThan(3);
        vi.restoreAllMocks();
        const part = createPour(createUniforms(), textures, pourTier);
        expectSameGeometry(direct, part.mesh.geometry);
        expect(run(preparePourSteps(pourTier))).toEqual({ yields: 0, value: false });
        part.dispose();
    });
});

describe('spring fall plan: a column asked again answers the same', () => {
    it('lipDepth and faceAlong are the same whatever was asked between', () => {
        const across = [-12.8, -0.6, 3.3, 6.2, 12.6, 19];
        const first = across.map((a) => [lipDepth(a), faceAlong(a, 20), faceAlong(a, 8.5)]);
        // Asked again in another order, each straight after a different column.
        for (const k of [5, 2, 0, 4, 1, 3]) {
            lipDepth(across[(k + 1) % across.length]);
            faceAlong(across[(k + 2) % across.length], 14);
            expect([lipDepth(across[k]), faceAlong(across[k], 20), faceAlong(across[k], 8.5)]).toEqual(first[k]);
        }
    });
});
