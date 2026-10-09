import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { VerdantHillsLight } from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import { VerdantHillsRibbons } from '../../src/themes/verdant-hills/verdant-hills-ribbons.js';

vi.setConfig({ testTimeout: 30000 });

/** Rows of the uniform array that describe one ribbon. */
const ROWS = 6;
const UP = new THREE.Vector3(0, 1, 0);
function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** A pool of `count` ribbons; the light is only needed once the mesh is built. */
function create(count = 6, light = null) {
    return new VerdantHillsRibbons({ light, tier: { ribbons: count } });
}

/** The six rows of one ribbon, by what they hold. */
function read(ribbons, index) {
    const [start, heading, tone, pace, shape, loop] = ribbons.rows.slice(index * ROWS, index * ROWS + ROWS);
    return {
        origin: new THREE.Vector3(start.x, start.y, start.z),
        age: start.w,
        heading: new THREE.Vector3(heading.x, heading.y, heading.z),
        length: heading.w,
        colour: [tone.x, tone.y, tone.z],
        strength: tone.w,
        speed: pace.x,
        loopRadius: pace.y,
        loopAt: pace.z,
        life: pace.w,
        loops: shape.x,
        width: shape.y,
        phase: shape.z,
        lift: shape.w,
        axis: new THREE.Vector3(loop.x, loop.y, loop.z),
        wobble: loop.w,
    };
}

const snapshot = (ribbons) => ribbons.rows.map((row) => row.toArray());

/** A ribbon out to the right from a spot over the hill. */
function ribbon(overrides = {}) {
    return {
        origin: new THREE.Vector3(1, 62, -8), heading: new THREE.Vector3(1, 0, 0), ...overrides,
    };
}

describe('Verdant Hills ribbons of wind', () => {
    describe('the pool', () => {
        it('holds as many ribbons as the tier asks for, six zeroed rows each', () => {
            for (const [asked, count] of [[6, 6], [1, 1], [0, 1], [-4, 1], [7.9, 7], [18, 18]]) {
                const ribbons = create(asked);
                expect(ribbons.count, `asked ${asked}`).toBe(count);
                expect(ribbons.rows).toHaveLength(count * ROWS);
                expect(ribbons.active()).toBe(0);
                for (const row of ribbons.rows) {
                    expect(row).toBeInstanceOf(THREE.Vector4);
                    // Four zeros: a default Vector4 would have left a 1 in `w`, and `w` is a ribbon's
                    // age, its strength or its life.
                    expect(row.toArray()).toEqual([0, 0, 0, 0]);
                }
                expect(new Set(ribbons.rows).size).toBe(count * ROWS);
                expect(ribbons.group).toBeInstanceOf(THREE.Group);
            }
            for (const [quality, tier] of Object.entries(VERDANT_HILLS_TIERS)) {
                const ribbons = new VerdantHillsRibbons({ light: null, tier });
                expect(ribbons.count, quality).toBe(tier.ribbons);
                expect(ribbons.count).toBeGreaterThan(0);
            }
        });

        it('launches into the first free slot and says which', () => {
            const ribbons = create(5);
            for (let index = 0; index < 5; index++) {
                expect(ribbons.launch(ribbon({ origin: new THREE.Vector3(index, 60, 0) }))).toBe(index);
                expect(ribbons.active()).toBe(index + 1);
                expect(read(ribbons, index).origin.x).toBe(index);
            }
            // The others were left alone.
            for (let index = 0; index < 5; index++) expect(read(ribbons, index).age).toBe(0);
        });

        it('takes the ribbon nearest its end when every slot is flying', () => {
            const ribbons = create(4);
            const lives = [4, 1, 3, 2];
            lives.forEach((life) => ribbons.launch(ribbon({ life })));
            ribbons.update(0.5);
            expect(ribbons.active()).toBe(4);
            // Half a second in, the one-second ribbon is furthest through its life, then the two-second one.
            const order = [1, 3];
            for (const expected of order) {
                const slot = ribbons.launch(ribbon({ life: 60, origin: new THREE.Vector3(9, 9, 9) }));
                expect(slot).toBe(expected);
                expect(read(ribbons, slot)).toMatchObject({ age: 0, life: 60 });
                expect(read(ribbons, slot).origin.toArray()).toEqual([9, 9, 9]);
                expect(ribbons.active()).toBe(4);
            }
            // The two that had most of their flight ahead of them are still flying it.
            expect(read(ribbons, 0)).toMatchObject({ age: 0.5, life: 4 });
            expect(read(ribbons, 2)).toMatchObject({ age: 0.5, life: 3 });
        });

        it('replaces the earliest of a burst launched all at once', () => {
            const ribbons = create(3);
            for (let index = 0; index < 3; index++) ribbons.launch(ribbon({ origin: new THREE.Vector3(index, 0, 0) }));
            // No time has passed: none is nearer its end than another, so they go in the order they came.
            expect(ribbons.launch(ribbon({ origin: new THREE.Vector3(10, 0, 0) }))).toBe(0);
            expect(ribbons.launch(ribbon({ origin: new THREE.Vector3(11, 0, 0) }))).toBe(1);
            expect([0, 1, 2].map((index) => read(ribbons, index).origin.x)).toEqual([10, 11, 2]);
        });

        it('prefers a slot whose ribbon has ended to one still in the air', () => {
            const ribbons = create(4);
            [5, 5, 0.4, 5].forEach((life) => ribbons.launch(ribbon({ life })));
            ribbons.update(0.5);
            expect(ribbons.active()).toBe(3);
            expect(ribbons.launch(ribbon({ life: 9 }))).toBe(2);
            expect(ribbons.active()).toBe(4);
            for (const index of [0, 1, 3]) expect(read(ribbons, index)).toMatchObject({ age: 0.5, life: 5 });
        });

        it('never grows however many are launched, and keeps the vectors the shader was given', () => {
            const ribbons = create(7);
            const { rows } = ribbons;
            const vectors = [...rows];
            const random = seededRandom(3);
            for (let count = 0; count < 500; count++) {
                const slot = ribbons.launch(ribbon({ life: 0.3 + random() * 2, strength: 0.2 + random() }));
                expect(slot).toBeGreaterThanOrEqual(0);
                expect(slot).toBeLessThan(7);
                if (count % 3 === 0) ribbons.update(0.05 + random() * 0.2);
                expect(ribbons.active()).toBeLessThanOrEqual(7);
            }
            expect(ribbons.rows).toBe(rows);
            expect(ribbons.rows).toHaveLength(7 * ROWS);
            ribbons.rows.forEach((row, index) => expect(row).toBe(vectors[index]));
            expect(rows.every((row) => row.toArray().every(Number.isFinite))).toBe(true);
        });
    });

    describe('a launch', () => {
        it('writes the six rows the shader reads, as its comment lays them out', () => {
            const ribbons = create(3);
            const colour = new THREE.Color(0.2, 0.5, 0.9);
            const slot = ribbons.launch({
                origin: new THREE.Vector3(3, 61, -9),
                heading: new THREE.Vector3(0, 0, -5),
                colour,
                length: 6.5,
                speed: 12,
                life: 2.25,
                width: 0.08,
                strength: 0.75,
                loops: 2,
                loopRadius: 0.6,
                loopAt: 1.75,
                lift: 0.125,
                wobble: 0.2,
                axis: new THREE.Vector3(1, 0, 0),
                phase: 1.5,
            });
            expect(slot).toBe(0);
            const rows = ribbons.rows.slice(0, ROWS).map((row) => row.toArray());
            // [origin xyz, age] [heading xyz, length] [colour rgb, strength]
            // [speed, loop radius, loop start, life] [loops, width, phase, lift] [loop axis xyz, wobble]
            expect(rows[0]).toEqual([3, 61, -9, 0]);
            expect(rows[1]).toEqual([0, 0, -1, 6.5]);
            expect(rows[2]).toEqual([0.2, 0.5, 0.9, 0.75]);
            expect(rows[3]).toEqual([12, 0.6, 1.75, 2.25]);
            expect(rows[4]).toEqual([2, 0.08, 1.5, 0.125]);
            expect(rows[5]).toEqual([1, 0, 0, 0.2]);
            // The other ribbons' rows are untouched.
            for (const row of ribbons.rows.slice(ROWS)) expect(row.toArray()).toEqual([0, 0, 0, 0]);
        });

        it('fills in a whole ribbon when it is given only a place and a way to go', () => {
            const ribbons = create(2);
            ribbons.launch(ribbon());
            const made = read(ribbons, 0);
            expect(made.colour).toEqual([1, 1, 1]);
            expect(made.strength).toBe(1);
            for (const name of ['length', 'speed', 'life', 'width', 'loopRadius']) {
                expect(made[name], name).toBeGreaterThan(0);
            }
            expect(made.loops).toBeGreaterThanOrEqual(0);
            expect(made.loopAt).toBeGreaterThanOrEqual(0);
            expect(made.age).toBe(0);
            // Its loops lean upward unless it is told otherwise.
            expect(made.axis.y).toBeGreaterThan(0.99);
            // A ribbon of wind is a thin thing that is soon gone.
            expect(made.width).toBeLessThan(0.5);
            expect(made.life).toBeLessThan(10);
        });

        it('normalises the heading, whatever its length', () => {
            const ribbons = create(4);
            const random = seededRandom(7);
            for (let count = 0; count < 200; count++) {
                const heading = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5)
                    .multiplyScalar(10 ** (random() * 8 - 4));
                const given = heading.clone();
                const slot = ribbons.launch(ribbon({ heading }));
                const made = read(ribbons, slot);
                expect(made.heading.length()).toBeCloseTo(1, 6);
                expect(made.heading.dot(given.clone().normalize())).toBeCloseTo(1, 6);
                // The caller's vector is its own.
                expect(heading.equals(given)).toBe(true);
            }
        });

        it('keeps the loop axis square to the heading, a unit vector on the side it was asked to lean', () => {
            const ribbons = create(4);
            const random = seededRandom(11);
            for (let count = 0; count < 400; count++) {
                const heading = new THREE.Vector3(random() - 0.5, (random() - 0.5) * 0.6, random() - 0.5);
                const axis = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(3);
                const given = axis.clone();
                const slot = ribbons.launch(ribbon({ heading, axis }));
                const made = read(ribbons, slot);
                expect(made.axis.length()).toBeCloseTo(1, 6);
                // Square to the heading, so a loop closes on itself ...
                expect(Math.abs(made.axis.dot(made.heading))).toBeLessThan(1e-6);
                // ... and leaning the way that was asked, as nearly as the heading allows.
                expect(made.axis.dot(given)).toBeGreaterThan(0);
                expect(axis.equals(given)).toBe(true);
            }
            // With no axis given it leans upward.
            const level = read(ribbons, ribbons.launch(ribbon({ heading: new THREE.Vector3(0.6, 0.3, -0.7) })));
            expect(level.axis.y).toBeGreaterThan(0.5);
            expect(Math.abs(level.axis.dot(level.heading))).toBeLessThan(1e-6);
            // An axis that lies along the heading is no axis: the loop stands upright instead.
            for (const scale of [1, -1, 40]) {
                const along = new THREE.Vector3(2, 0.5, -3);
                const axis = along.clone().multiplyScalar(scale);
                const made = read(ribbons, ribbons.launch(ribbon({ heading: along, axis })));
                expect(made.axis.length()).toBeCloseTo(1, 6);
                expect(Math.abs(made.axis.dot(made.heading))).toBeLessThan(1e-6);
                expect(made.axis.y).toBeGreaterThan(0.5);
            }
        });

        it('gives a ribbon launched straight up a loop axis too', () => {
            const ribbons = create(2);
            for (const heading of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -3, 0)]) {
                const made = read(ribbons, ribbons.launch(ribbon({ heading })));
                expect(made.axis.length()).toBeCloseTo(1, 6);
                expect(Math.abs(made.axis.dot(made.heading))).toBeLessThan(1e-6);
            }
        });

        it('caps the strength at one and copies what it is given', () => {
            const ribbons = create(3);
            expect(read(ribbons, ribbons.launch(ribbon({ strength: 5 }))).strength).toBe(1);
            expect(read(ribbons, ribbons.launch(ribbon({ strength: 0.3 }))).strength).toBeCloseTo(0.3, 12);
            const origin = new THREE.Vector3(4, 5, 6);
            const colour = new THREE.Color(0.1, 0.2, 0.3);
            const slot = ribbons.launch(ribbon({ origin, colour }));
            origin.set(99, 99, 99);
            colour.setRGB(1, 0, 0);
            // The director reuses one vector for every origin it hands over.
            expect(read(ribbons, slot).origin.toArray()).toEqual([4, 5, 6]);
            expect(read(ribbons, slot).colour).toEqual([0.1, 0.2, 0.3]);
            // Plain objects with the same fields will do as well as vectors and colours.
            const plain = ribbons.launch(ribbon({ colour: { r: 0.5, g: 0.25, b: 0.125 } }));
            expect(read(ribbons, plain).colour).toEqual([0.5, 0.25, 0.125]);
        });

        it('refuses a ribbon with no place, no heading or no strength, and writes nothing', () => {
            const ribbons = create(3);
            ribbons.launch(ribbon());
            const before = snapshot(ribbons);
            const heading = new THREE.Vector3(1, 0, 0);
            const origin = new THREE.Vector3(0, 60, 0);
            for (const bad of [
                {}, { origin }, { heading }, { origin: null, heading }, { origin, heading: undefined },
                { origin, heading, strength: 0 }, { origin, heading, strength: -1 }, { origin, heading, strength: NaN },
                { origin, heading, strength: null }, { origin, heading, strength: 'strong' },
            ]) {
                expect(ribbons.launch(bad), JSON.stringify(bad)).toBe(-1);
            }
            expect(snapshot(ribbons)).toEqual(before);
            expect(ribbons.active()).toBe(1);
            // The next good one goes where it would have gone anyway.
            expect(ribbons.launch(ribbon())).toBe(1);
        });

        it('refuses a ribbon it cannot place or point', () => {
            const ribbons = create(3);
            const before = snapshot(ribbons);
            const good = ribbon();
            for (const bad of [
                { ...good, origin: new THREE.Vector3(NaN, 60, 0) },
                { ...good, origin: new THREE.Vector3(0, Infinity, 0) },
                { ...good, heading: new THREE.Vector3(NaN, 0, 0) },
                { ...good, heading: new THREE.Vector3(0, 0, 0) },
            ]) {
                expect(ribbons.launch(bad)).toBe(-1);
            }
            expect(snapshot(ribbons)).toEqual(before);
        });
    });

    describe('time', () => {
        it('ages the ribbons that are flying and retires each at the end of its life', () => {
            const ribbons = create(4);
            ribbons.launch(ribbon({ life: 1 }));
            ribbons.launch(ribbon({ life: 2 }));
            ribbons.update(0.25);
            ribbons.launch(ribbon({ life: 0.5 }));
            expect([0, 1, 2, 3].map((index) => read(ribbons, index).age)).toEqual([0.25, 0.25, 0, 0]);
            expect(ribbons.active()).toBe(3);
            ribbons.update(0.5);
            // The half-second ribbon has had its half second.
            expect(ribbons.active()).toBe(2);
            expect(read(ribbons, 2).strength).toBe(0);
            ribbons.update(0.25);
            expect(ribbons.active()).toBe(1);
            expect(read(ribbons, 0).strength).toBe(0);
            expect(read(ribbons, 1)).toMatchObject({ age: 1, strength: 1 });
            ribbons.update(5);
            expect(ribbons.active()).toBe(0);
            // A ribbon that has ended is not aged on: its rows stay as its last frame drew them.
            const rested = snapshot(ribbons);
            ribbons.update(3);
            expect(snapshot(ribbons)).toEqual(rested);
            // Nothing but the age and the strength of a ribbon ever changes while it flies.
            const fresh = create(1);
            fresh.launch(ribbon({ life: 2, colour: new THREE.Color(0.3, 0.6, 0.9) }));
            const launched = snapshot(fresh);
            fresh.update(0.75);
            const flown = snapshot(fresh);
            flown[0][3] = 0;
            expect(flown).toEqual(launched);
        });

        it('ignores a step that is no time at all', () => {
            const ribbons = create(2);
            ribbons.launch(ribbon({ life: 1 }));
            ribbons.update(0.25);
            const before = snapshot(ribbons);
            for (const dt of [0, -0, -1, NaN, -Infinity, undefined, null, 'x', {}]) ribbons.update(dt);
            expect(snapshot(ribbons)).toEqual(before);
            expect(ribbons.active()).toBe(1);
        });

        it('retires a ribbon of no life on its first frame', () => {
            const ribbons = create(2);
            for (const life of [0, -3]) {
                const slot = ribbons.launch(ribbon({ life }));
                expect(ribbons.active()).toBe(1);
                ribbons.update(1 / 60);
                expect(ribbons.active()).toBe(0);
                expect(read(ribbons, slot).strength).toBe(0);
            }
        });

        it('forgets every ribbon on reset and starts again from the first slot', () => {
            const ribbons = create(4);
            const { rows } = ribbons;
            const vectors = [...rows];
            for (let count = 0; count < 6; count++) ribbons.launch(ribbon({ life: 3 }));
            ribbons.update(0.5);
            expect(ribbons.active()).toBe(4);
            ribbons.reset();
            expect(ribbons.active()).toBe(0);
            expect(ribbons.rows).toBe(rows);
            ribbons.rows.forEach((row, index) => {
                expect(row).toBe(vectors[index]);
                expect(row.toArray()).toEqual([0, 0, 0, 0]);
            });
            expect(ribbons.launch(ribbon())).toBe(0);
            // A reset pool flies the next session as a new pool would.
            const fresh = create(4);
            ribbons.reset();
            for (const pool of [ribbons, fresh]) {
                for (let count = 0; count < 7; count++) {
                    pool.launch(ribbon({ life: 1 + count * 0.2, origin: new THREE.Vector3(count, 0, 0) }));
                    pool.update(0.3);
                }
            }
            expect(snapshot(ribbons)).toEqual(snapshot(fresh));
        });
    });

    describe('the mesh', () => {
        let light;

        beforeAll(() => {
            light = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS.Minimal, rng: seededRandom(5) });
        });

        afterAll(() => {
            light.dispose();
        });

        it.each([1, 5, 18])('builds one mesh holding a strip for each of %i ribbons', (count) => {
            const ribbons = create(count, light);
            expect(ribbons.build()).toBe(ribbons);
            const { mesh } = ribbons;
            expect(ribbons.group.children).toEqual([mesh]);
            expect(mesh.isMesh).toBe(true);
            expect(mesh.geometry).toBe(ribbons.geometry);
            expect(mesh.material).toBe(ribbons.material);
            // The shader places every vertex, wherever the ribbon has got to: never culled, never a caster.
            expect(mesh.frustumCulled).toBe(false);
            expect(mesh.castShadow).toBe(false);
            expect(mesh.material.isNodeMaterial).toBe(true);
            expect(mesh.material.transparent).toBe(true);
            expect(mesh.material.depthWrite).toBe(false);
            expect(mesh.material.side).toBe(THREE.DoubleSide);
            expect(mesh.material.positionNode).toBeTruthy();
            expect(mesh.material.opacityNode).toBeTruthy();
            const position = mesh.geometry.getAttribute('position');
            const strip = mesh.geometry.getAttribute('aStrip');
            const index = mesh.geometry.getIndex();
            expect(strip.itemSize).toBe(3);
            expect(strip.count).toBe(position.count);
            // The same number of vertices for every ribbon, in pairs across the strip.
            const each = position.count / count;
            expect(Number.isInteger(each) && each % 2 === 0 && each >= 8).toBe(true);
            const segments = each / 2 - 1;
            expect(index.count).toBe(count * segments * 6);
            for (let vertex = 0; vertex < strip.count; vertex++) {
                const [along, side, owner] = [strip.getX(vertex), strip.getY(vertex), strip.getZ(vertex)];
                const step = Math.floor((vertex % each) / 2);
                // Head to tail in even strides, one vertex on either edge, and the ribbon it belongs to.
                expect(along).toBeCloseTo(step / segments, 6);
                expect(side).toBe(vertex % 2 === 0 ? -1 : 1);
                expect(owner).toBe(Math.floor(vertex / each));
            }
            // No triangle joins one ribbon to the next, and none is used up on a point.
            for (let corner = 0; corner < index.count; corner += 3) {
                const corners = [index.getX(corner), index.getX(corner + 1), index.getX(corner + 2)];
                expect(new Set(corners).size).toBe(3);
                expect(new Set(corners.map((vertex) => Math.floor(vertex / each))).size).toBe(1);
                expect(Math.max(...corners) - Math.min(...corners)).toBeLessThanOrEqual(3);
            }
            ribbons.dispose();
        });

        it('keeps the pool it had before it was built, and flies it', () => {
            const ribbons = create(3, light);
            const { rows } = ribbons;
            ribbons.launch(ribbon());
            ribbons.build();
            expect(ribbons.rows).toBe(rows);
            expect(ribbons.active()).toBe(1);
            ribbons.update(0.2);
            expect(read(ribbons, 0).age).toBeCloseTo(0.2, 12);
            ribbons.dispose();
        });

        it('releases its geometry and material and leaves the scene', () => {
            const ribbons = create(4, light).build();
            const parent = new THREE.Group();
            parent.add(ribbons.group);
            const released = [];
            ribbons.geometry.addEventListener('dispose', () => released.push('geometry'));
            ribbons.material.addEventListener('dispose', () => released.push('material'));
            ribbons.dispose();
            expect(released.sort()).toEqual(['geometry', 'material']);
            expect(parent.children).toHaveLength(0);
            expect(ribbons.group.children).toHaveLength(0);
            expect(ribbons.mesh).toBeNull();
            // A pool that was never built has nothing to release, and says nothing.
            const unbuilt = create(2);
            expect(() => unbuilt.dispose()).not.toThrow();
            // The light it drew with is not its own to release.
            expect(light.noiseTexture.image).toBeTruthy();
        });
    });

    it('launches and flies without making vectors of its own', () => {
        const ribbons = create(6);
        const { scratch, axis, rows } = ribbons;
        const kept = [...rows];
        for (let count = 0; count < 40; count++) {
            ribbons.launch(ribbon({ axis: count % 2 ? UP : new THREE.Vector3(0, 0, 1) }));
            ribbons.update(0.1);
        }
        expect(ribbons.scratch).toBe(scratch);
        expect(ribbons.axis).toBe(axis);
        ribbons.rows.forEach((row, index) => expect(row).toBe(kept[index]));
        // The shared "up" it leans on by default is still up.
        expect(UP.toArray()).toEqual([0, 1, 0]);
        ribbons.launch(ribbon());
        expect(new THREE.Vector3(0, 1, 0).equals(UP)).toBe(true);
    });
});
