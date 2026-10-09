/**
 * Voltage Storm — what is generated on the CPU: the collector tower's mesh, the CPU twins of the
 * rain and the sparks (and the spark pool), and the two noise bakes.
 *
 * Proportions, speeds and colours are still being tuned: everything is measured against the
 * exported constants, or is a relation.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    TOWER_PART, buildTowerGeometry, latticeHalf, latticeLevels, ringHeight,
} from '../../src/themes/voltage-storm/voltage-storm-towers.js';
import {
    SPARK_DRAG, SPARK_FALL, createSparks, rainPoint, sparkPoint,
} from '../../src/themes/voltage-storm/voltage-storm-fx.js';
import {
    NOISE_SIZE, NOISE_SLOPE_GAIN, bakeCloudNoise, bakeNoise, createStormUniforms,
} from '../../src/themes/voltage-storm/voltage-storm-tsl.js';
import { STORM, TOWER, TOWER_RINGS } from '../../src/themes/voltage-storm/voltage-storm-core.js';

const tower = buildTowerGeometry();
const RINGS = Array.from({ length: TOWER_RINGS }, (_, k) => k);

/** The tower's vertices of one part: `{ x, y, z, nx, ny, nz }`. */
function verticesOf(part) {
    const position = tower.getAttribute('position');
    const normal = tower.getAttribute('normal');
    const parts = tower.getAttribute('aPart');
    const out = [];
    for (let i = 0; i < position.count; i++) {
        if (parts.getX(i) === part) {
            out.push({
                x: position.getX(i),
                y: position.getY(i),
                z: position.getZ(i),
                nx: normal.getX(i),
                ny: normal.getY(i),
                nz: normal.getZ(i),
            });
        }
    }
    return out;
}

const radius = (v) => Math.hypot(v.x, v.z);
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
const lowest = (values) => values.reduce((a, b) => Math.min(a, b), Infinity);
const highest = (values) => values.reduce((a, b) => Math.max(a, b), -Infinity);

/** A spark pool on real storm uniforms (the pool's material reads them; nothing is drawn). */
function makeSparks(count = 24) {
    const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    const u = createStormUniforms({ noise: placeholder, cloud: placeholder, sky: placeholder });
    const sparks = createSparks(u, count);
    const read = (name) => sparks.geometry.getAttribute(name).array;
    /** Slot `i` as `{ at, born, velocity, life, tint, size }`. */
    const slot = (i) => ({
        at: [...read('aBirth').slice(i * 4, i * 4 + 3)],
        born: read('aBirth')[i * 4 + 3],
        velocity: [...read('aVel').slice(i * 4, i * 4 + 3)],
        life: read('aVel')[i * 4 + 3],
        tint: [...read('aTint').slice(i * 4, i * 4 + 3)],
        size: read('aTint')[i * 4 + 3],
    });
    return { sparks, read, slot };
}

/** A burst with nothing left to a default that may be tuned. */
function burst(over = {}) {
    return {
        x: 1,
        y: 2,
        z: 3,
        n: 5,
        rgb: [1, 0.5, 0.25],
        time: 7,
        out: [10, 30],
        lift: 0.5,
        life: [0.5, 1],
        size: 0.25,
        ...over,
    };
}

/** The largest step between neighbours of a square field's channel, inside it and across its seam. */
function seams2D(field, size, channel) {
    const at = (x, y) => field[(y * size + x) * 4 + channel];
    let inside = 0;
    let seam = 0;
    for (let a = 0; a < size; a++) {
        seam = Math.max(seam, Math.abs(at(0, a) - at(size - 1, a)), Math.abs(at(a, 0) - at(a, size - 1)));
        for (let b = 1; b < size; b++) {
            inside = Math.max(inside, Math.abs(at(b, a) - at(b - 1, a)), Math.abs(at(a, b) - at(a, b - 1)));
        }
    }
    return { inside, seam };
}

/** The same for a cube of voxels. */
function seams3D(data, size, channel) {
    const at = (x, y, z) => data[((z * size + y) * size + x) * 4 + channel];
    let inside = 0;
    let seam = 0;
    for (let a = 0; a < size; a++) {
        for (let b = 0; b < size; b++) {
            seam = Math.max(
                seam,
                Math.abs(at(0, a, b) - at(size - 1, a, b)),
                Math.abs(at(a, 0, b) - at(a, size - 1, b)),
                Math.abs(at(a, b, 0) - at(a, b, size - 1)),
            );
            for (let c = 1; c < size; c++) {
                inside = Math.max(
                    inside,
                    Math.abs(at(c, a, b) - at(c - 1, a, b)),
                    Math.abs(at(a, c, b) - at(a, c - 1, b)),
                    Math.abs(at(a, b, c) - at(a, b, c - 1)),
                );
            }
        }
    }
    return { inside, seam };
}

describe('voltage storm towers: proportions', () => {
    it('orders a tower from foot to tip, and narrows its lattice as it climbs without pinching it shut', () => {
        expect(TOWER.ringLo).toBeGreaterThan(0);
        expect(TOWER.ringHi).toBeGreaterThan(TOWER.ringLo);
        // The rings sit on the mast, the electrode over it, the finial over that.
        expect(TOWER.mast).toBeGreaterThanOrEqual(TOWER.ringHi);
        expect(TOWER.toroid).toBeGreaterThan(TOWER.mast);
        expect(TOWER.tip).toBeGreaterThan(TOWER.toroid + TOWER.toroidTube);
        expect(TOWER.tip).toBe(1);
        expect(TOWER.toroidRadius).toBeGreaterThan(TOWER.toroidTube);
        expect(TOWER.toroidTube).toBeGreaterThan(0);

        expect(latticeHalf(0)).toBeCloseTo(TOWER.footHalf, 12);
        expect(latticeHalf(TOWER.mast)).toBeCloseTo(TOWER.neckHalf, 12);
        let previous = Infinity;
        for (let i = 0; i <= 100; i++) {
            const half = latticeHalf((TOWER.mast * i) / 100);
            expect(half).toBeLessThan(previous);
            expect(half).toBeGreaterThan(0);
            previous = half;
        }
        // Under the ground and over the mast it holds its last width.
        expect(latticeHalf(-3)).toBe(latticeHalf(0));
        expect(latticeHalf(TOWER.tip)).toBe(latticeHalf(TOWER.mast));
    });

    it('stacks the storeys from the ground to the mast\'s top, shorter as they climb', () => {
        for (const storeys of [1, 2, 9, 16]) {
            const levels = latticeLevels(storeys);
            expect(levels).toHaveLength(storeys + 1);
            expect(levels[0]).toBe(0);
            expect(levels[storeys]).toBeCloseTo(TOWER.mast, 12);
            for (let i = 1; i <= storeys; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
            for (let i = 2; i <= storeys; i++) {
                expect(levels[i] - levels[i - 1]).toBeLessThan(levels[i - 1] - levels[i - 2]);
            }
        }
        expect(latticeLevels()).toEqual(latticeLevels(latticeLevels().length - 1));
    });

    it('spreads the rings evenly between their lowest and highest places', () => {
        expect(ringHeight(0)).toBeCloseTo(TOWER.ringLo, 12);
        expect(ringHeight(TOWER_RINGS - 1)).toBeCloseTo(TOWER.ringHi, 12);
        const gap = ringHeight(1) - ringHeight(0);
        expect(gap).toBeGreaterThan(0);
        for (const k of RINGS.slice(1)) {
            expect(ringHeight(k)).toBeGreaterThanOrEqual(TOWER.ringLo);
            expect(ringHeight(k)).toBeLessThanOrEqual(TOWER.ringHi + 1e-12);
            expect(ringHeight(k) - ringHeight(k - 1)).toBeCloseTo(gap, 12);
        }
    });
});

describe('voltage storm towers: the mesh', () => {
    it('is whole: a place, a unit normal and a part for every vertex, no NaN, one unit tall on the ground', () => {
        const position = tower.getAttribute('position');
        const normal = tower.getAttribute('normal');
        const { count } = position;
        expect(count).toBeGreaterThan(0);
        expect(normal.count).toBe(count);
        expect(tower.getAttribute('aPart').count).toBe(count);
        for (const name of ['position', 'normal', 'aPart']) {
            expect(tower.getAttribute(name).array.every((v) => Number.isFinite(v)), name).toBe(true);
        }
        const index = tower.getIndex();
        expect(index.count % 3).toBe(0);
        expect(highest(index.array)).toBeLessThan(count);
        // No vertex is left out of the picture.
        expect(new Set(index.array).size).toBe(count);

        const heights = [];
        let bent = 0;
        for (let i = 0; i < count; i++) {
            heights.push(position.getY(i));
            bent = Math.max(bent, Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1));
        }
        expect(bent).toBeLessThan(1e-4);
        // Nothing stands higher than the finial's tip: where lightning strikes.
        expect(highest(heights)).toBeCloseTo(TOWER.tip, 6);
        // Its foot is at the water: no part hangs above it, none sinks by more than a beam's width.
        expect(lowest(heights)).toBeLessThanOrEqual(0.001);
        expect(lowest(heights)).toBeGreaterThan(-0.01);
    });

    it('names every part: the steel, the electrode, the finial and each ring', () => {
        const parts = new Set(tower.getAttribute('aPart').array);
        const expected = [
            TOWER_PART.steel, TOWER_PART.electrode, TOWER_PART.finial, ...RINGS.map((k) => TOWER_PART.ring + k),
        ];
        expect([...parts].sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
        // The shader tells a ring from the rest by its id alone.
        expect(new Set(expected).size).toBe(3 + TOWER_RINGS);
        expect(TOWER_PART.ring).toBeGreaterThan(Math.max(TOWER_PART.steel, TOWER_PART.electrode, TOWER_PART.finial));
    });

    it('carries each ring at its own height, round the outside of the mast', () => {
        const widths = [];
        for (const k of RINGS) {
            const ring = verticesOf(TOWER_PART.ring + k);
            const height = ringHeight(k);
            expect(mean(ring.map((v) => v.y)), `ring ${k}`).toBeCloseTo(height, 6);
            // A ring is flat: no thicker than the gap to the next one.
            const thick = highest(ring.map((v) => Math.abs(v.y - height)));
            expect(thick, `ring ${k}`).toBeLessThan((TOWER.ringHi - TOWER.ringLo) / (TOWER_RINGS - 1) / 2);
            expect(lowest(ring.map(radius)), `ring ${k}`).toBeGreaterThan(latticeHalf(height));
            // It goes all the way round: its centre is the tower's axis.
            expect(mean(ring.map((v) => v.x))).toBeCloseTo(0, 6);
            expect(mean(ring.map((v) => v.z))).toBeCloseTo(0, 6);
            widths.push(highest(ring.map(radius)));
        }
        // The stack narrows with the mast it hangs on.
        for (let k = 1; k < widths.length; k++) expect(widths[k]).toBeLessThan(widths[k - 1]);
    });

    it('seats the electrode at the toroid\'s height, as wide as the toroid, with a thin finial to the tip', () => {
        const electrode = verticesOf(TOWER_PART.electrode);
        const reach = TOWER.toroidRadius + TOWER.toroidTube;
        expect(highest(electrode.map((v) => Math.abs(v.y - TOWER.toroid)))).toBeLessThanOrEqual(TOWER.toroidRadius);
        expect(highest(electrode.map(radius))).toBeLessThanOrEqual(reach + 1e-6);
        expect(highest(electrode.map(radius))).toBeGreaterThan(reach * 0.98);
        // The toroid's tube reaches as far under its centre line as its radius.
        expect(lowest(electrode.map((v) => v.y))).toBeCloseTo(TOWER.toroid - TOWER.toroidTube, 4);
        expect(mean(electrode.map((v) => v.x))).toBeCloseTo(0, 6);
        expect(mean(electrode.map((v) => v.z))).toBeCloseTo(0, 6);
        // It is wider than the mast under it: what a strike's light shows first.
        expect(reach).toBeGreaterThan(latticeHalf(TOWER.mast));

        const finial = verticesOf(TOWER_PART.finial);
        expect(finial.length).toBeGreaterThan(0);
        expect(highest(finial.map((v) => v.y))).toBeCloseTo(TOWER.tip, 6);
        expect(lowest(finial.map((v) => v.y))).toBeGreaterThan(TOWER.toroid);
        expect(highest(finial.map(radius))).toBeLessThan(TOWER.toroidTube);
    });

    it('faces its solid parts outward: their normals point away from the tower\'s axis', () => {
        for (const part of [TOWER_PART.electrode, ...RINGS.map((k) => TOWER_PART.ring + k)]) {
            const outward = verticesOf(part).reduce((sum, v) => sum + v.nx * v.x + v.nz * v.z, 0);
            expect(outward, `part ${part}`).toBeGreaterThan(0);
        }
        // The dome's crown looks up, the toroid's underside down.
        const electrode = verticesOf(TOWER_PART.electrode);
        const top = electrode.reduce((best, v) => (v.y > best.y ? v : best));
        const bottom = electrode.reduce((best, v) => (v.y < best.y ? v : best));
        expect(top.ny).toBeGreaterThan(0.5);
        expect(bottom.ny).toBeLessThan(-0.5);
    });

    it('winds every triangle the way its normals point, so no face is drawn inside out', () => {
        const position = tower.getAttribute('position');
        const normal = tower.getAttribute('normal');
        const index = tower.getIndex();
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const n = new THREE.Vector3();
        let inside = 0;
        let flat = 0;
        for (let t = 0; t < index.count; t += 3) {
            const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
            a.fromBufferAttribute(position, corners[0]);
            b.fromBufferAttribute(position, corners[1]).sub(a);
            c.fromBufferAttribute(position, corners[2]).sub(a);
            const face = b.cross(c);
            n.set(0, 0, 0);
            for (const i of corners) n.add(a.fromBufferAttribute(normal, i));
            if (face.length() < 1e-14) flat += 1;
            else if (face.dot(n) <= 0) inside += 1;
        }
        expect(inside).toBe(0);
        expect(flat).toBe(0);
    });

    it('builds the same tower every time', () => {
        const again = buildTowerGeometry();
        const numbers = (geometry, name) => Array.from(geometry.getAttribute(name).array);
        for (const name of ['position', 'normal', 'aPart']) {
            expect(numbers(again, name), name).toEqual(numbers(tower, name));
        }
        expect(Array.from(again.getIndex().array)).toEqual(Array.from(tower.getIndex().array));
    });
});

describe('voltage storm fx: a spark', () => {
    it('leaves from where it was thrown', () => {
        const from = [3, 40, -200];
        expect(sparkPoint(from, [20, 30, -10], 0)).toEqual(from);
        expect(sparkPoint(from, [20, 30, -10], -2)).toEqual(from);
        const out = [9, 9, 9];
        expect(sparkPoint(from, [20, 30, -10], 0.5, out)).toBe(out);
        expect(out).toEqual(sparkPoint(from, [20, 30, -10], 0.5));
    });

    it('slows in the wet air: it goes on along its bearing, never back, and only so far', () => {
        const from = [3, 40, -200];
        const velocity = [24, 10, -18];
        let previous = sparkPoint(from, velocity, 0);
        for (let tau = 0.02; tau <= 6; tau += 0.02) {
            const now = sparkPoint(from, velocity, tau);
            expect(now[0]).toBeGreaterThanOrEqual(previous[0]);
            expect(now[2]).toBeLessThanOrEqual(previous[2]);
            // Its bearing holds: x and z travel stay in the ratio it was thrown with.
            expect((now[0] - from[0]) * velocity[2]).toBeCloseTo((now[2] - from[2]) * velocity[0], 6);
            // It never gets further than its speed over the drag.
            expect(now[0] - from[0]).toBeLessThanOrEqual(velocity[0] / SPARK_DRAG + 1e-9);
            previous = now;
        }
        // Early on it moves at the speed it was thrown with; later it has nearly stopped.
        const early = sparkPoint(from, velocity, 0.001)[0] - from[0];
        expect(early / 0.001).toBeCloseTo(velocity[0], 0);
        const late = sparkPoint(from, velocity, 6)[0] - sparkPoint(from, velocity, 5.999)[0];
        expect(late / 0.001).toBeLessThan(velocity[0] * 0.01);
    });

    it('arcs over and falls below where it started; thrown nowhere, it falls straight down', () => {
        const from = [0, 50, -300];
        const velocity = [15, 26, 0];
        const heights = [];
        for (let tau = 0; tau <= 8; tau += 0.02) heights.push(sparkPoint(from, velocity, tau)[1]);
        const apex = heights.indexOf(Math.max(...heights));
        expect(apex).toBeGreaterThan(0);
        expect(heights[apex]).toBeGreaterThan(from[1]);
        // Up to the apex it climbs, from the apex it falls, and it ends under where it began.
        for (let i = 1; i <= apex; i++) expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
        for (let i = apex + 1; i < heights.length; i++) expect(heights[i]).toBeLessThan(heights[i - 1]);
        expect(heights[heights.length - 1]).toBeLessThan(from[1]);

        expect(SPARK_FALL).toBeGreaterThan(0);
        expect(SPARK_DRAG).toBeGreaterThan(0);
        for (const tau of [0.1, 0.5, 2]) {
            const [x, y, z] = sparkPoint([7, 60, -90], [0, 0, 0], tau);
            expect([x, z]).toEqual([7, -90]);
            expect(y).toBeCloseTo(60 - 0.5 * SPARK_FALL * tau * tau, 9);
        }
    });
});

describe('voltage storm fx: the spark pool', () => {
    it('waits dormant, then throws as many sparks as it is asked for and never more than it holds', () => {
        const { sparks, slot } = makeSparks(24);
        expect(sparks.count).toBe(24);
        // Every slot born long ago, none of them on the lens.
        for (let i = 0; i < 24; i++) {
            expect(slot(i).born).toBeLessThan(-10);
            expect(Math.hypot(...slot(i).at)).toBeGreaterThan(100);
        }
        expect(sparks.emit(burst({ n: 5 }))).toBe(5);
        expect(sparks.emit(burst({ n: 2.6 }))).toBe(3);
        expect(sparks.emit(burst({ n: 0 }))).toBe(0);
        expect(sparks.emit(burst({ n: -4 }))).toBe(0);
        expect(sparks.emit(burst({ n: 1000 }))).toBe(24);
    });

    it('stamps each spark with its birth, a life and the burst\'s own colour', () => {
        const { sparks, slot } = makeSparks(24);
        sparks.emit(burst({ n: 6 }));
        for (let i = 0; i < 6; i++) {
            const spark = slot(i);
            expect(spark.at).toEqual([1, 2, 3]);
            expect(spark.born).toBe(7);
            expect(spark.life).toBeGreaterThanOrEqual(0.5);
            expect(spark.life).toBeLessThanOrEqual(1);
            expect(spark.size).toBeGreaterThan(0);
            // Brighter or dimmer than its neighbour, but the same hue.
            expect(spark.tint[1] / spark.tint[0]).toBeCloseTo(0.5, 5);
            expect(spark.tint[2] / spark.tint[0]).toBeCloseTo(0.25, 5);
            expect(spark.tint[0]).toBeGreaterThan(0);
            // Thrown out round the vertical, no faster than the burst allows.
            expect(Math.hypot(spark.velocity[0], spark.velocity[2])).toBeLessThanOrEqual(30 + 1e-4);
            expect(Math.hypot(...spark.velocity)).toBeGreaterThan(0);
        }
        // The slots it did not need are still dormant.
        for (let i = 6; i < 24; i++) expect(slot(i).born).toBeLessThan(-10);
    });

    it('spreads a staggered burst over its stagger, never before its time', () => {
        const { sparks, slot } = makeSparks(24);
        sparks.emit(burst({ n: 24, stagger: 0.25 }));
        const births = Array.from({ length: 24 }, (_, i) => slot(i).born);
        for (const born of births) {
            expect(born).toBeGreaterThanOrEqual(7);
            expect(born).toBeLessThanOrEqual(7.25 + 1e-6);
        }
        expect(new Set(births).size).toBeGreaterThan(12);
    });

    it('takes the next slots for the next burst, comes round when full, and says when its buffers changed', () => {
        const { sparks, slot } = makeSparks(8);
        const versions = () => ['aBirth', 'aVel', 'aTint'].map((name) => sparks.geometry.getAttribute(name).version);
        const before = versions();
        sparks.emit(burst({ n: 0 }));
        expect(versions()).toEqual(before);
        sparks.emit(burst({ n: 5, time: 1 }));
        versions().forEach((version, i) => expect(version).toBeGreaterThan(before[i]));
        sparks.emit(burst({ n: 5, time: 2 }));
        // Three slots were free; the other two sparks took the oldest.
        expect(Array.from({ length: 8 }, (_, i) => slot(i).born)).toEqual([2, 2, 1, 1, 1, 2, 2, 2]);
    });

    it('throws the same burst again after a reset, and a different one the next time', () => {
        const { sparks, read } = makeSparks(32);
        /** The nine sparks from slot `from` on: every number the pool holds about them. */
        const nine = (from) => ['aBirth', 'aVel', 'aTint']
            .map((name) => Array.from(read(name).slice(from * 4, from * 4 + 36)));
        sparks.emit(burst({ n: 9 }));
        const first = nine(0);
        sparks.emit(burst({ n: 9 }));
        // Two bursts are never the same fan of sparks.
        expect(nine(9)[1]).not.toEqual(first[1]);
        sparks.reset();
        for (let i = 0; i < 32; i++) expect(read('aBirth')[i * 4 + 3]).toBeLessThan(-10);
        sparks.emit(burst({ n: 9 }));
        expect(nine(0)).toEqual(first);
    });
});

describe('voltage storm fx: a rain drop', () => {
    const [boxX, boxY, boxZ] = STORM.rainBox;
    const seeds = [[0.1, 0.2, 0.3, 0.4], [0.9, 0.75, 0.05, 0], [0.5, 0, 1, 1], [0, 0.999, 0.5, 0.6]];
    /** How fast a drop falls, as a multiple of the rain's speed (measured, not assumed). */
    function rainSpeed(seed) {
        const still = [seed[0], 0, seed[2], seed[3]];
        return (rainPoint(still, 0, [0, 0])[1] - rainPoint(still, 0.01, [0, 0])[1]) / (STORM.rainFall * 0.01);
    }
    /** Seconds of the rain's clock a drop takes to fall through the box. */
    const period = (seed) => boxY / (STORM.rainFall * rainSpeed(seed));

    it('stays in its box of air ahead of the lens', () => {
        for (const seed of seeds) {
            for (let clock = -20; clock < 60; clock += 0.37) {
                const [x, y, z] = rainPoint(seed, clock, [0, 0]);
                expect(y).toBeGreaterThan(0);
                expect(y).toBeLessThanOrEqual(boxY);
                expect(Math.abs(x)).toBeLessThanOrEqual(boxX / 2);
                expect(z).toBeLessThanOrEqual(0);
                expect(z).toBeGreaterThanOrEqual(-boxZ - 10);
            }
        }
    });

    it('falls, faster when it is heavier, and comes round to the top of the box again', () => {
        for (const seed of seeds) {
            const turn = period(seed);
            expect(turn).toBeGreaterThan(0);
            let wraps = 0;
            let previous = rainPoint(seed, 3, [0, 0])[1];
            for (let i = 1; i <= 200; i++) {
                const y = rainPoint(seed, 3 + (turn * i) / 200, [0, 0])[1];
                if (y > previous) wraps += 1;
                previous = y;
            }
            // Once round: down all the way, with one jump back to the top.
            expect(wraps).toBe(1);
            const [x0, y0, z0] = rainPoint(seed, 3, [0.2, 0.1]);
            const [x1, y1, z1] = rainPoint(seed, 3 + turn, [0.2, 0.1]);
            expect(x1).toBeCloseTo(x0, 6);
            expect(y1).toBeCloseTo(y0, 6);
            expect(z1).toBeCloseTo(z0, 6);
        }
        // About the rain's own speed, either way.
        const light = rainSpeed([0.5, 0, 0.5, 0]);
        const heavy = rainSpeed([0.5, 0, 0.5, 1]);
        expect(heavy).toBeGreaterThan(light);
        expect(light).toBeGreaterThan(0.5);
        expect(heavy).toBeLessThan(2);
    });

    it('leans with the wind: the further it has fallen, the further it is carried', () => {
        for (const seed of seeds) {
            for (const clock of [0, 1.3, 4.1, 9.9]) {
                const still = rainPoint(seed, clock, [0, 0]);
                const leaning = rainPoint(seed, clock, [0.3, -0.1]);
                const fallen = boxY - still[1];
                expect(leaning[1]).toBe(still[1]);
                expect(leaning[0] - still[0]).toBeCloseTo(0.3 * fallen, 9);
                expect(leaning[2] - still[2]).toBeCloseTo(-0.1 * fallen, 9);
            }
            // With no wind it falls straight: its place across the box never changes.
            const [x, , z] = rainPoint(seed, 0, [0, 0]);
            expect(rainPoint(seed, 5.5, [0, 0])[0]).toBe(x);
            expect(rainPoint(seed, 5.5, [0, 0])[2]).toBe(z);
        }
        const out = [0, 0, 0];
        expect(rainPoint(seeds[0], 1, [0, 0], out)).toBe(out);
    });
});

describe('voltage storm noise bakes', () => {
    const small = bakeNoise(5150, 64);

    it('bakes the same field for the same seed, both height fields stretched over the whole of [0, 1]', () => {
        expect(Array.from(bakeNoise(5150, 64))).toEqual(Array.from(small));
        expect(Array.from(bakeNoise(5151, 64))).not.toEqual(Array.from(small));
        const full = bakeNoise();
        expect(full).toHaveLength(NOISE_SIZE * NOISE_SIZE * 4);
        expect(full.every((v) => Number.isFinite(v))).toBe(true);
        for (const channel of [0, 1]) {
            const values = small.filter((_, i) => i % 4 === channel);
            expect(lowest(values)).toBeCloseTo(0, 6);
            expect(highest(values)).toBeCloseTo(1, 6);
            expect(lowest(values)).toBeGreaterThanOrEqual(0);
        }
        // Two fields, not one twice.
        let same = 0;
        for (let i = 0; i < small.length; i += 4) same += small[i] === small[i + 1] ? 1 : 0;
        expect(same).toBeLessThan(small.length / 40);
    });

    it('tiles: neither field is rougher across its seam than inside', () => {
        for (const channel of [0, 1]) {
            const { inside, seam } = seams2D(small, 64, channel);
            expect(inside).toBeGreaterThan(0);
            expect(seam).toBeLessThanOrEqual(inside * 1.5);
        }
    });

    it('carries the first field\'s slope in the other two channels, finite and right across the seam', () => {
        const size = 64;
        const height = (x, y) => small[((((y + size) % size) * size) + ((x + size) % size)) * 4];
        const last = size - 1;
        for (const [x, y] of [[0, 0], [last, last], [0, 17], [last, 40], [31, 0], [12, last], [20, 33]]) {
            const o = (y * size + x) * 4;
            expect(small[o + 2]).toBeCloseTo((height(x + 1, y) - height(x - 1, y)) * 0.5 * NOISE_SLOPE_GAIN, 5);
            expect(small[o + 3]).toBeCloseTo((height(x, y + 1) - height(x, y - 1)) * 0.5 * NOISE_SLOPE_GAIN, 5);
        }
        expect(small.every((v) => Number.isFinite(v))).toBe(true);
        // A slope has two signs.
        expect(small.some((v, i) => i % 4 === 2 && v > 0)).toBe(true);
        expect(small.some((v, i) => i % 4 === 2 && v < 0)).toBe(true);
    });

    it('bakes the cloud\'s noise at the size asked: size³ voxels of four bytes, the same every time', () => {
        const cloud = bakeCloudNoise(9001, 16);
        expect(cloud).toBeInstanceOf(Uint8Array);
        expect(cloud).toHaveLength(16 ** 3 * 4);
        expect(Array.from(bakeCloudNoise(9001, 16))).toEqual(Array.from(cloud));
        expect(Array.from(bakeCloudNoise(9002, 16))).not.toEqual(Array.from(cloud));
        expect(bakeCloudNoise(9001, 8)).toHaveLength(8 ** 3 * 4);
    });

    it('fills every channel of the cloud\'s noise with shape, and tiles it', () => {
        const size = 16;
        const cloud = bakeCloudNoise(9001, size);
        for (let channel = 0; channel < 4; channel++) {
            const values = new Set();
            for (let i = channel; i < cloud.length; i += 4) values.add(cloud[i]);
            // Not a constant, and not two tones either.
            expect(values.size, `channel ${channel}`).toBeGreaterThan(16);
            const { inside, seam } = seams3D(cloud, size, channel);
            expect(inside, `channel ${channel}`).toBeGreaterThan(0);
            expect(seam, `channel ${channel}`).toBeLessThanOrEqual(inside * 1.25);
        }
    });
});
