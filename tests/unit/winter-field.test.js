/**
 * Winter — the ground as numbers (winter-field.js): the fan of snow, ice and fells opened from
 * under the eye, and the mask of moon shadows the trees throw on the snow.
 */

import {
    beforeAll, describe, expect, it,
} from 'vitest';
import {
    EYE, FRAME_TREES, groundHeight, lakeMask, moonDirection, plantTrees,
} from '../../src/themes/winter/winter-core.js';
import {
    FAN, SHADOW_RECT, bakeMoonShadows, buildGroundFan,
} from '../../src/themes/winter/winter-field.js';
import { GHOST_LODS, planGhosts } from '../../src/themes/winter/winter-ghosts.js';

describe('winter ground fan', () => {
    const SHAPES = [[48, 40], [20, 64]];

    it('is sized by its rings and columns', () => {
        SHAPES.forEach(([rings, columns]) => {
            const fan = buildGroundFan([rings, columns]);
            const count = (rings + 1) * (columns + 1);
            expect(fan.rings).toBe(rings);
            expect(fan.columns).toBe(columns);
            expect(fan.positions).toBeInstanceOf(Float32Array);
            expect(fan.positions).toHaveLength(count * 3);
            expect(fan.normals).toHaveLength(count * 3);
            expect(fan.ground).toHaveLength(count * 4);
            expect(fan.indices).toBeInstanceOf(Uint32Array);
            expect(fan.indices).toHaveLength(rings * columns * 6);
            for (const array of [fan.positions, fan.normals, fan.ground]) {
                expect(array.every((v) => Number.isFinite(v))).toBe(true);
            }
        });
    });

    it('opens from under the eye in rings that grow from its near edge to its far one', () => {
        expect(FAN.near).toBeGreaterThan(0);
        expect(FAN.far).toBeGreaterThan(FAN.near * 100);
        SHAPES.forEach(([rings, columns]) => {
            const fan = buildGroundFan([rings, columns]);
            let previous = 0;
            for (let j = 0; j <= rings; j++) {
                let ring = null;
                for (let i = 0; i <= columns; i++) {
                    const v = j * (columns + 1) + i;
                    const x = fan.positions[v * 3] - EYE.x;
                    const z = fan.positions[v * 3 + 2] - EYE.z;
                    const r = Math.hypot(x, z);
                    // One ring, one radius, and the attribute carries it.
                    if (ring === null) ring = r;
                    expect(Math.abs(r - ring) / ring).toBeLessThan(1e-5);
                    expect(Math.abs(fan.ground[v * 4 + 3] - r) / r).toBeLessThan(1e-5);
                    // Ahead of the viewer, within the fan's half angle, left to right.
                    const bearing = Math.atan2(x, -z);
                    expect(Math.abs(bearing)).toBeLessThanOrEqual(FAN.half + 1e-5);
                    expect(bearing).toBeCloseTo(((i / columns) * 2 - 1) * FAN.half, 4);
                }
                expect(ring).toBeGreaterThan(previous);
                previous = ring;
                if (j === 0) expect(ring).toBeCloseTo(FAN.near, 4);
                if (j === rings) expect(ring / FAN.far).toBeCloseTo(1, 5);
            }
        });
        // Rings a hand apart at the viewer's feet, far apart on the fells: each wider than the last.
        const [rings, columns] = SHAPES[0];
        const fan = buildGroundFan(SHAPES[0]);
        const radius = (j) => fan.ground[j * (columns + 1) * 4 + 3];
        for (let j = 2; j <= rings; j++) {
            expect(radius(j) - radius(j - 1)).toBeGreaterThan(radius(j - 1) - radius(j - 2));
        }
    });

    it('lies on the plan\'s ground, with the plan\'s lake', () => {
        const [rings, columns] = SHAPES[0];
        const fan = buildGroundFan(SHAPES[0]);
        let ice = 0;
        let land = 0;
        let wooded = 0;
        for (let v = 0; v < (rings + 1) * (columns + 1); v++) {
            const x = fan.positions[v * 3];
            const y = fan.positions[v * 3 + 1];
            const z = fan.positions[v * 3 + 2];
            const r = fan.ground[v * 4 + 3];
            // (x and z are stored as floats: far out, a rounding of them moves the height a little.)
            expect(Math.abs(y - groundHeight(x, z)), `vertex ${v}`).toBeLessThan(1e-3 * Math.max(1, r / 50));
            const lake = fan.ground[v * 4];
            const wood = fan.ground[v * 4 + 1];
            const inland = fan.ground[v * 4 + 2];
            expect(lake).toBeGreaterThanOrEqual(0);
            expect(lake).toBeLessThanOrEqual(1);
            expect(wood).toBeGreaterThanOrEqual(0);
            expect(wood).toBeLessThanOrEqual(1);
            // Metres inland, negative on the ice, clamped at both ends.
            if (lake === 1) expect(inland).toBeLessThan(0);
            if (inland > 1) expect(lake).toBe(0);
            expect(Math.abs(lake - lakeMask(x, z)), `vertex ${v}`).toBeLessThan(0.01);
            if (lake === 1) ice += 1;
            if (lake === 0) land += 1;
            if (wood > 0.5) wooded += 1;
            // No wood on the ice.
            if (lake === 1) expect(wood).toBe(0);
        }
        expect(ice).toBeGreaterThan(20);
        expect(land).toBeGreaterThan(ice);
        expect(wooded).toBeGreaterThan(0);
        const inland = Array.from({ length: (rings + 1) * (columns + 1) }, (_, v) => fan.ground[v * 4 + 2]);
        expect(Math.min(...inland)).toBeLessThan(0);
        expect(Math.max(...inland)).toBeGreaterThan(10);
        expect(Math.max(...inland) - Math.min(...inland)).toBeLessThan(1000);
    });

    it('has unit normals that point up', () => {
        SHAPES.forEach((shape) => {
            const fan = buildGroundFan(shape);
            for (let v = 0; v < fan.normals.length / 3; v++) {
                const nx = fan.normals[v * 3];
                const ny = fan.normals[v * 3 + 1];
                const nz = fan.normals[v * 3 + 2];
                expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
                expect(ny).toBeGreaterThan(0);
            }
        });
    });

    it('winds every triangle to face up, in step with its normals', () => {
        SHAPES.forEach((shape) => {
            const fan = buildGroundFan(shape);
            const count = fan.positions.length / 3;
            const { positions: p, normals: n, indices } = fan;
            const used = new Set();
            const facingDown = [];
            const againstNormals = [];
            let highest = 0;
            for (let t = 0; t < indices.length; t += 3) {
                const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
                highest = Math.max(highest, a, b, c);
                used.add(a).add(b).add(c);
                const ux = p[b * 3] - p[a * 3];
                const uy = p[b * 3 + 1] - p[a * 3 + 1];
                const uz = p[b * 3 + 2] - p[a * 3 + 2];
                const vx = p[c * 3] - p[a * 3];
                const vy = p[c * 3 + 1] - p[a * 3 + 1];
                const vz = p[c * 3 + 2] - p[a * 3 + 2];
                const gx = uy * vz - uz * vy;
                const gy = uz * vx - ux * vz;
                const gz = ux * vy - uy * vx;
                // Counter-clockwise seen from above: the face normal has a positive y...
                if (!(gy > 0)) facingDown.push(t / 3);
                // ...and looks the way its corners' normals do.
                for (const v of [a, b, c]) {
                    if (!(gx * n[v * 3] + gy * n[v * 3 + 1] + gz * n[v * 3 + 2] > 0)) againstNormals.push(t / 3);
                }
            }
            expect(highest).toBeLessThan(count);
            expect(facingDown).toEqual([]);
            expect(againstNormals).toEqual([]);
            // No vertex is left out, no cell left open.
            expect(used.size).toBe(count);
            expect(indices.length / 3).toBe(fan.rings * fan.columns * 2);
        });
    });
});

describe('winter moon shadows', () => {
    const SIZE = 256;
    let ghosts;
    let moon;
    beforeAll(() => {
        ghosts = planGhosts();
        moon = moonDirection(16 / 9);
    });

    const centre = { x: SHADOW_RECT.x0 + SHADOW_RECT.width / 2, z: SHADOW_RECT.z0 + SHADOW_RECT.depth / 2 };
    const tree = (over = {}) => ({
        x: centre.x, y: 0, z: centre.z, height: 10, kind: 'sentinel', turn: 0.3, lod: 0, ...over,
    });
    /** The mask's value at a point on the snow (row 0 is the rect's z0). */
    const at = (mask, x, z, size = SIZE) => {
        const i = Math.floor(((x - SHADOW_RECT.x0) / SHADOW_RECT.width) * size);
        const j = Math.floor(((z - SHADOW_RECT.z0) / SHADOW_RECT.depth) * size);
        return mask[j * size + i];
    };
    /** Unit vector on the snow pointing away from a light (where its shadows fall). */
    const awayFrom = (light) => {
        const flat = Math.hypot(light[0], light[2]);
        return [-light[0] / flat, -light[2] / flat];
    };
    const dark = (mask) => mask.reduce((sum, v) => sum + (v < 128 ? 1 : 0), 0);
    const allLit = (mask) => mask.every((v) => v === 255);

    it('leaves the snow in the moon\'s light where no tree stands', () => {
        for (const size of [2, 64, SIZE]) {
            const mask = bakeMoonShadows([], ghosts, moon, size);
            expect(mask).toBeInstanceOf(Uint8Array);
            expect(mask).toHaveLength(size * size);
            expect(allLit(mask)).toBe(true);
        }
    });

    it('lays a tree\'s shadow on the side away from the moon', () => {
        const one = tree();
        const mask = bakeMoonShadows([one], ghosts, moon, SIZE);
        expect(mask).toHaveLength(SIZE * SIZE);
        const [dx, dz] = awayFrom(moon);
        // The moon is ahead and to the right: its shadows come toward the viewer, and to the left.
        expect(dx).toBeLessThan(0);
        expect(dz).toBeGreaterThan(0);
        const length = (one.height * Math.hypot(moon[0], moon[2])) / moon[1];
        expect(length).toBeGreaterThan(one.height);
        // Down-moon of its foot: in shadow, along most of the shadow's length.
        for (const k of [0.12, 0.25, 0.4, 0.55]) {
            const d = length * k;
            expect(at(mask, one.x + dx * d, one.z + dz * d), `${d.toFixed(1)} m down-moon`).toBeLessThan(40);
        }
        // Up-moon of it, to either side, and beyond the shadow's tip: in the light.
        for (const d of [5, 8, 14]) {
            expect(at(mask, one.x - dx * d, one.z - dz * d), `${d} m up-moon`).toBe(255);
            expect(at(mask, one.x - dz * d, one.z + dx * d), `${d} m to one side`).toBe(255);
            expect(at(mask, one.x + dz * d, one.z - dx * d), `${d} m to the other`).toBe(255);
        }
        expect(at(mask, one.x + dx * (length + 5), one.z + dz * (length + 5))).toBe(255);
        // Most of the snow is lit; the shadow is a figure, with a soft edge.
        expect(dark(mask)).toBeGreaterThan(50);
        expect(dark(mask)).toBeLessThan(SIZE * SIZE * 0.1);
        expect(mask.some((v) => v > 20 && v < 235)).toBe(true);
        // The same again gives the same.
        expect(Array.from(bakeMoonShadows([one], ghosts, moon, SIZE))).toEqual(Array.from(mask));
    });

    it('follows the light: another moon, another way; a lower moon, a longer shadow', () => {
        const one = tree();
        // A light low on the left and behind the viewer.
        const raw = [-0.7, 0.35, 0.45];
        const norm = Math.hypot(...raw);
        const lamp = raw.map((v) => v / norm);
        const mask = bakeMoonShadows([one], ghosts, lamp, SIZE);
        const [dx, dz] = awayFrom(lamp);
        expect(dx).toBeGreaterThan(0);
        expect(dz).toBeLessThan(0);
        expect(at(mask, one.x + dx * 6, one.z + dz * 6)).toBeLessThan(40);
        expect(at(mask, one.x - dx * 6, one.z - dz * 6)).toBe(255);
        // Where the real moon's shadow lay there is now light.
        const [mx, mz] = awayFrom(moon);
        expect(at(mask, one.x + mx * 8, one.z + mz * 8)).toBe(255);
        const high = [moon[0] * 0.5, 0.9, moon[2] * 0.5];
        const k = Math.hypot(...high);
        const steep = bakeMoonShadows([one], ghosts, high.map((v) => v / k), SIZE);
        const shallow = bakeMoonShadows([one], ghosts, moon, SIZE);
        expect(dark(shallow)).toBeGreaterThan(dark(steep) * 1.5);
        // A taller tree throws more of it; a sapling next to nothing.
        expect(dark(bakeMoonShadows([tree({ height: 14 })], ghosts, moon, SIZE))).toBeGreaterThan(dark(shallow));
        const sapling = tree({ height: 2, kind: 'gnome' });
        expect(dark(bakeMoonShadows([sapling], ghosts, moon, SIZE))).toBeLessThan(dark(shallow) * 0.5);
    });

    it('keeps the rim lit, whatever falls across it', () => {
        // A tree just inside the rect's left edge, and one just outside its far edge.
        const edge = tree({ x: SHADOW_RECT.x0 + 1.5 });
        const beyond = tree({ z: SHADOW_RECT.z0 - 2, x: centre.x + 20 });
        const mask = bakeMoonShadows([edge, beyond], ghosts, moon, SIZE);
        for (let i = 0; i < SIZE; i++) {
            expect(mask[i]).toBe(255);
            expect(mask[(SIZE - 1) * SIZE + i]).toBe(255);
            expect(mask[i * SIZE]).toBe(255);
            expect(mask[i * SIZE + SIZE - 1]).toBe(255);
        }
        // Both shadows are there, right up to the rim.
        const [dx, dz] = awayFrom(moon);
        expect(at(mask, beyond.x + dx * 8, beyond.z + dz * 8)).toBeLessThan(40);
        const texel = SHADOW_RECT.width / SIZE;
        expect(at(mask, SHADOW_RECT.x0 + texel * 1.5, edge.z + (dz / -dx) * 1.5)).toBeLessThan(128);
    });

    it('draws nothing for the far wood, for trees out of reach, or for a kind it has no mesh of', () => {
        // The far shore's wood is planted at the coarsest level of detail, and casts nothing.
        const farWood = Math.max(...plantTrees(16 / 9, { mid: 4, far: 8 }).map((planted) => planted.lod));
        expect(farWood).toBe(GHOST_LODS - 1);
        expect(allLit(bakeMoonShadows([tree({ lod: farWood })], ghosts, moon, SIZE))).toBe(true);
        expect(allLit(bakeMoonShadows([tree({ kind: 'palm' })], ghosts, moon, SIZE))).toBe(true);
        const reach = 14 / moon[1] + 20;
        const outside = [
            tree({ x: SHADOW_RECT.x0 - reach }),
            tree({ x: SHADOW_RECT.x0 + SHADOW_RECT.width + reach }),
            tree({ z: SHADOW_RECT.z0 - reach }),
            tree({ z: SHADOW_RECT.z0 + SHADOW_RECT.depth + reach }),
        ];
        expect(allLit(bakeMoonShadows(outside, ghosts, moon, SIZE))).toBe(true);
        // Everything nearer casts: the framing trees at both their levels, and the spits' stands.
        const full = dark(bakeMoonShadows([tree({ lod: 0 })], ghosts, moon, SIZE));
        expect(full).toBeGreaterThan(20);
        for (let lod = 1; lod < farWood; lod++) {
            // (One mesh draws every shadow, so the level a tree is drawn at does not change it.)
            expect(dark(bakeMoonShadows([tree({ lod })], ghosts, moon, SIZE)), `lod ${lod}`).toBe(full);
        }
    });

    it('covers the snowfield the framing trees stand on, for the wood as planted', () => {
        for (const aspect of [16 / 9, 430 / 932]) {
            const trees = plantTrees(aspect, { mid: 30, far: 60 });
            const light = moonDirection(aspect);
            const framing = trees.filter((planted) => planted.frame);
            expect(framing).toHaveLength(FRAME_TREES.length);
            // Every framing tree stands inside the mask.
            framing.forEach((planted) => {
                expect(planted.x).toBeGreaterThan(SHADOW_RECT.x0);
                expect(planted.x).toBeLessThan(SHADOW_RECT.x0 + SHADOW_RECT.width);
                expect(planted.z).toBeGreaterThan(SHADOW_RECT.z0);
                expect(planted.z).toBeLessThan(SHADOW_RECT.z0 + SHADOW_RECT.depth);
            });
            const mask = bakeMoonShadows(trees, ghosts, light, SIZE);
            const [dx, dz] = awayFrom(light);
            // The tallest of them shadows the snow down-moon of its foot.
            const tallest = framing.reduce((a, b) => (b.height > a.height ? b : a));
            expect(at(mask, tallest.x + dx * 5, tallest.z + dz * 5), `aspect ${aspect}`).toBeLessThan(60);
            expect(dark(mask)).toBeGreaterThan(200);
            expect(dark(mask)).toBeLessThan(SIZE * SIZE * 0.5);
            // The viewer stands inside the mask too: the shadows that reach the feet are drawn.
            expect(EYE.x).toBeGreaterThan(SHADOW_RECT.x0);
            expect(EYE.x).toBeLessThan(SHADOW_RECT.x0 + SHADOW_RECT.width);
            expect(EYE.z).toBeGreaterThan(SHADOW_RECT.z0);
            expect(EYE.z).toBeLessThan(SHADOW_RECT.z0 + SHADOW_RECT.depth);
        }
    });
});
