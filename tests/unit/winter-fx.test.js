/**
 * Winter — gameplay effects that are their own geometry (winter-fx.js): the fox fires' pool of
 * sparks and powder, the row beams and the paw prints. CPU side only: what is written into the
 * pools the GPU reads, and the closed-form path the shader's twin follows.
 */

import {
    afterAll, beforeAll, beforeEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FOX_FIRE, bakeNoise, createNoiseTexture, createShadowTexture, createWinterUniforms,
} from '../../src/themes/winter/winter-tsl.js';
import {
    BEAM_ROWS, SPARK_DRAG, SPARK_HANG, createPrints, createRowBeams, createSparks, sparkPoint,
} from '../../src/themes/winter/winter-fx.js';

/** The shared uniforms, made as WinterWorld.build() makes them. */
let u;
let textures;
beforeAll(() => {
    const noise = createNoiseTexture(bakeNoise());
    const shadow = createShadowTexture(new Uint8Array(4).fill(255), 2);
    textures = [noise, shadow];
    u = createWinterUniforms({ noise, shadow });
});
afterAll(() => textures.forEach((texture) => texture.dispose()));

/** A pool's per-instance array, and how often it has been flagged for upload. */
const data = (part, name) => part.geometry.getAttribute(name).array;
const uploads = (part, names) => names.map((name) => part.geometry.getAttribute(name).version);
const release = (part) => {
    part.geometry.dispose();
    part.material.dispose();
};

describe('winter fox fires: a spark\'s flight', () => {
    const from = [1.5, 0.4, -9];

    it('starts where it was thrown, as it was thrown', () => {
        const vel = [2, 3, -1];
        expect(sparkPoint(from, vel, 0, 8)).toEqual(from);
        // (Thrown a moment ahead: it waits at its place.)
        expect(sparkPoint(from, vel, -0.3, 8)).toEqual(from);
        const soon = sparkPoint(from, vel, 1e-4, 8);
        vel.forEach((v, k) => expect((soon[k] - from[k]) / 1e-4).toBeCloseTo(v, 2));
        const out = [0, 0, 0];
        expect(sparkPoint(from, vel, 0.7, 8, out)).toBe(out);
        expect(out).toEqual(sparkPoint(from, vel, 0.7, 8));
    });

    it('spends its throw, never going farther than its speed over its drag', () => {
        const vel = [4, 0, -3];
        let previous = 0;
        for (let tau = 0.05; tau <= 8; tau += 0.05) {
            const p = sparkPoint(from, vel, tau, 0);
            expect(p.every((v) => Number.isFinite(v))).toBe(true);
            const gone = Math.hypot(p[0] - from[0], p[2] - from[2]);
            expect(gone).toBeGreaterThan(previous);
            expect(gone).toBeLessThanOrEqual(5 / SPARK_DRAG + 1e-9);
            // Along its throw, and with nothing to lift it, level.
            expect((p[0] - from[0]) * 3 + (p[2] - from[2]) * 4).toBeCloseTo(0, 9);
            expect(p[1]).toBe(from[1]);
            previous = gone;
        }
        expect(previous).toBeCloseTo(5 / SPARK_DRAG, 4);
    });

    it('hangs a moment, and then the sky draws it up faster and faster', () => {
        expect(SPARK_HANG).toBeGreaterThan(0);
        const still = [0, 0, 0];
        const lift = 7;
        // Until the hang is over nothing lifts it.
        for (const tau of [0, SPARK_HANG * 0.5, SPARK_HANG]) {
            expect(sparkPoint(from, still, tau, lift)[1]).toBe(from[1]);
        }
        let previous = from[1];
        let lastClimb = 0;
        for (let tau = SPARK_HANG + 0.1; tau <= SPARK_HANG + 4; tau += 0.1) {
            const p = sparkPoint(from, still, tau, lift);
            const climb = p[1] - previous;
            expect(climb).toBeGreaterThan(lastClimb);
            // Straight up: nothing carries it sideways.
            expect(p[0]).toBe(from[0]);
            expect(p[2]).toBe(from[2]);
            previous = p[1];
            lastClimb = climb;
        }
        // A constant pull: half the lift times the square of the time it has been rising.
        expect(sparkPoint(from, still, SPARK_HANG + 2, lift)[1] - from[1]).toBeCloseTo(lift * 2, 9);
        // More lift, higher; none, level; powder's negative lift settles it.
        const at = (pull) => sparkPoint(from, still, SPARK_HANG + 1.5, pull)[1];
        expect(at(11)).toBeGreaterThan(at(5));
        expect(at(0)).toBe(from[1]);
        expect(at(-0.35)).toBeLessThan(from[1]);
    });
});

describe('winter fox fires: the pool', () => {
    const ALL = ['aBirth', 'aVel', 'aTint', 'aKind'];
    const COUNT = 96;
    let sparks;
    beforeAll(() => {
        sparks = createSparks(u, COUNT);
    });
    beforeEach(() => sparks.reset());
    afterAll(() => release(sparks));

    it('is one always-drawn pool of sleeping quads', () => {
        expect(sparks.count).toBe(COUNT);
        expect(sparks.geometry.instanceCount).toBe(COUNT);
        expect(sparks.mesh.frustumCulled).toBe(false);
        expect(sparks.material.isNodeMaterial).toBe(true);
        expect(sparks.material.depthWrite).toBe(false);
        ALL.forEach((name) => {
            const attribute = sparks.geometry.getAttribute(name);
            expect(attribute.isInstancedBufferAttribute, name).toBe(true);
            expect(attribute.count, name).toBe(COUNT);
            expect(attribute.itemSize, name).toBe(4);
            // Gameplay writes them: the GPU is told to expect it.
            expect(attribute.usage, name).toBe(THREE.DynamicDrawUsage);
        });
        // Every attribute is its own vertex buffer on WebGPU, and a pipeline binds eight.
        expect(Object.keys(sparks.geometry.attributes).length).toBeLessThanOrEqual(8);
        const birth = data(sparks, 'aBirth');
        for (let i = 0; i < COUNT; i++) expect(birth[i * 4 + 3]).toBe(-100);
    });

    it('throws a handful: so many slots, from where it was thrown, inside its speeds, lives and sizes', () => {
        const before = uploads(sparks, ALL);
        const from = [2, 0.3, -11];
        const toward = [0.9, 0.45, -0.3];
        const rgb = [0.2, 0.5, 1];
        const written = sparks.emit({
            from,
            toward,
            n: 40,
            rgb,
            time: 7,
            speed: [2, 6],
            cone: 0.4,
            life: [3, 5],
            size: 0.1,
            glow: 1.2,
            stagger: 0.05,
            jitter: 0.12,
            lift: [4, 9],
        });
        expect(written).toBe(40);
        uploads(sparks, ALL).forEach((v, k) => expect(v, ALL[k]).toBeGreaterThan(before[k]));
        const birth = data(sparks, 'aBirth');
        const vel = data(sparks, 'aVel');
        const tint = data(sparks, 'aTint');
        const kind = data(sparks, 'aKind');
        const heading = [0, 0, 0];
        for (let i = 0; i < 40; i++) {
            const o = i * 4;
            // Within the handful's own scatter of where it left, never before it was thrown.
            for (let k = 0; k < 3; k++) expect(Math.abs(birth[o + k] - from[k])).toBeLessThanOrEqual(0.0601);
            expect(birth[o + 3]).toBeGreaterThanOrEqual(7);
            expect(birth[o + 3]).toBeLessThanOrEqual(7.0501);
            const speed = Math.hypot(vel[o], vel[o + 1], vel[o + 2]);
            expect(speed).toBeGreaterThanOrEqual(2 - 1e-5);
            expect(speed).toBeLessThanOrEqual(6 + 1e-5);
            for (let k = 0; k < 3; k++) heading[k] += vel[o + k] / speed / 40;
            // How long it lasts.
            expect(vel[o + 3]).toBeGreaterThanOrEqual(3);
            expect(vel[o + 3]).toBeLessThanOrEqual(5);
            // The piece's hue, a little brighter or duller from spark to spark, and its size.
            const gain = tint[o] / rgb[0];
            expect(gain).toBeGreaterThan(0.5);
            expect(gain).toBeLessThan(1.5);
            expect(tint[o + 1] / rgb[1]).toBeCloseTo(gain, 5);
            expect(tint[o + 2] / rgb[2]).toBeCloseTo(gain, 5);
            expect(tint[o + 3]).toBeGreaterThan(0.1 * 0.5);
            expect(tint[o + 3]).toBeLessThan(0.1 * 1.5);
            // (seed, nature, lift, glow): a spark, drawn up, about as bright as asked.
            expect(kind[o]).toBeGreaterThanOrEqual(0);
            expect(kind[o]).toBeLessThan(1);
            expect(kind[o + 1]).toBe(0);
            expect(kind[o + 2]).toBeGreaterThanOrEqual(4);
            expect(kind[o + 2]).toBeLessThanOrEqual(9);
            expect(kind[o + 3]).toBeGreaterThan(1.2 * 0.5);
            expect(kind[o + 3]).toBeLessThan(1.2 * 1.5);
        }
        // On the whole they go the way they were thrown.
        const along = heading[0] * toward[0] + heading[1] * toward[1] + heading[2] * toward[2];
        expect(along / Math.hypot(...toward)).toBeGreaterThan(0.7);
        // No two alike.
        expect(new Set(Array.from({ length: 40 }, (_, i) => kind[i * 4])).size).toBe(40);
        // The rest of the pool sleeps on.
        for (let i = 40; i < COUNT; i++) expect(birth[i * 4 + 3]).toBe(-100);
    });

    it('throws a jet when the cone is shut, and the fires\' own colours when none is given', () => {
        sparks.emit({
            from: [0, 1, -5], toward: [3, 0, -4], n: 12, rgb: [1, 1, 1], time: 1, speed: [4, 4], cone: 0, jitter: 0,
        });
        const vel = data(sparks, 'aVel');
        const birth = data(sparks, 'aBirth');
        for (let i = 0; i < 12; i++) {
            // One heading for all of them: along the throw (the handful's own small upward bias
            // aside), all from the one point at the one moment.
            expect(Math.hypot(vel[i * 4], vel[i * 4 + 1], vel[i * 4 + 2])).toBeCloseTo(4, 5);
            for (let k = 0; k < 3; k++) expect(vel[i * 4 + k]).toBeCloseTo(vel[k], 6);
            expect(Array.from(birth.slice(i * 4, i * 4 + 4))).toEqual([0, 1, -5, 1]);
        }
        expect((vel[0] * 3 + vel[2] * -4) / 5 / 4).toBeGreaterThan(0.95);
        expect(vel[1]).toBeGreaterThanOrEqual(0);
        sparks.reset();
        sparks.emit({
            from: [0, 1, -5], n: 80, rgb: null, time: 2,
        });
        const tint = data(sparks, 'aTint');
        const seen = new Set();
        for (let i = 0; i < 80; i++) {
            const o = i * 4;
            const match = FOX_FIRE.findIndex((c) => {
                const gain = Math.max(tint[o], tint[o + 1], tint[o + 2]) / Math.max(...c);
                return gain > 0.5 && gain < 1.5 && c.every((v, k) => Math.abs(tint[o + k] - v * gain) < 1e-5);
            });
            expect(match, `spark ${i}`).toBeGreaterThanOrEqual(0);
            seen.add(match);
        }
        expect(seen.size).toBe(FOX_FIRE.length);
        // Thrown with nothing said: upward.
        expect(vel[1]).toBeGreaterThan(0);
    });

    it('kicks snow up as powder: its own nature, settling instead of rising', () => {
        const written = sparks.emit({
            from: [0, 0.15, -8],
            toward: [0.5, 1, 0.1],
            n: 20,
            rgb: [0.5, 0.6, 0.75],
            time: 3,
            powder: true,
            lift: [5, 11],
        });
        expect(written).toBe(20);
        sparks.emit({
            from: [0, 0.15, -8], n: 6, rgb: [1, 0, 0], time: 3,
        });
        const kind = data(sparks, 'aKind');
        for (let i = 0; i < 20; i++) {
            expect(kind[i * 4 + 1]).toBe(1);
            // Whatever lift was asked for, powder has none: it sinks.
            expect(kind[i * 4 + 2]).toBeLessThan(0);
        }
        // The sparks thrown after it into the same pool are sparks.
        for (let i = 20; i < 26; i++) {
            expect(kind[i * 4 + 1]).toBe(0);
            expect(kind[i * 4 + 2]).toBeGreaterThan(0);
        }
    });

    it('goes round its pool as a ring and never grows', () => {
        const birth = data(sparks, 'aBirth');
        const quiet = { from: [0, 1, -5], rgb: [1, 1, 1], stagger: 0 };
        expect(sparks.emit({ ...quiet, n: COUNT - 3, time: 1 })).toBe(COUNT - 3);
        expect(sparks.emit({ ...quiet, n: 8, time: 2 })).toBe(8);
        // The last three slots, then round to the first five.
        for (const i of [COUNT - 3, COUNT - 2, COUNT - 1, 0, 1, 2, 3, 4]) expect(birth[i * 4 + 3], `slot ${i}`).toBe(2);
        for (let i = 5; i < COUNT - 3; i++) expect(birth[i * 4 + 3]).toBe(1);
        // More than it holds: the whole pool, once.
        expect(sparks.emit({ ...quiet, n: COUNT + 40, time: 3 })).toBe(COUNT);
        for (let i = 0; i < COUNT; i++) expect(birth[i * 4 + 3]).toBe(3);
        // None asked for: none thrown.
        expect(sparks.emit({ ...quiet, n: 0, time: 4 })).toBe(0);
        expect(birth.some((v, k) => k % 4 === 3 && v === 4)).toBe(false);
        expect(sparks.count).toBe(COUNT);
        expect(sparks.geometry.instanceCount).toBe(COUNT);
        expect(sparks.geometry.getAttribute('aBirth').count).toBe(COUNT);
    });

    it('may be thrown a moment ahead, each spark at or after that moment', () => {
        sparks.emit({
            from: [0, 1, -5], n: 30, time: 12.5, stagger: 0.4,
        });
        const birth = data(sparks, 'aBirth');
        const times = Array.from({ length: 30 }, (_, i) => birth[i * 4 + 3]);
        times.forEach((time) => {
            expect(time).toBeGreaterThanOrEqual(12.5);
            expect(time).toBeLessThanOrEqual(12.9001);
        });
        // Staggered: not all at once.
        expect(new Set(times).size).toBeGreaterThan(20);
    });

    it('parks every slot on a reset and throws the same handful again afterwards', () => {
        const burst = {
            from: [2, 1, -6], toward: [-1, 0.5, -0.3], n: 30, rgb: null, time: 5, stagger: 0.2,
        };
        sparks.emit(burst);
        const first = ALL.map((name) => Array.from(data(sparks, name).slice(0, 30 * 4)));
        sparks.emit({ ...burst, time: 6 });
        const before = uploads(sparks, ['aBirth']);
        sparks.reset();
        expect(uploads(sparks, ['aBirth'])[0]).toBeGreaterThan(before[0]);
        const birth = data(sparks, 'aBirth');
        for (let i = 0; i < COUNT; i++) expect(birth[i * 4 + 3]).toBe(-100);
        // From the first slot, with the first handful's own scatter: a replay throws the same sparks.
        sparks.emit(burst);
        expect(ALL.map((name) => Array.from(data(sparks, name).slice(0, 30 * 4)))).toEqual(first);
        // The handful after it is another one.
        sparks.emit(burst);
        expect(Array.from(data(sparks, 'aVel').slice(30 * 4, 60 * 4))).not.toEqual(first[1]);
    });
});

describe('winter row beams', () => {
    let beams;
    beforeAll(() => {
        beams = createRowBeams(u);
    });
    afterAll(() => release(beams));

    it('is two strips a row, dark until fired', () => {
        const { frame } = beams.uniforms;
        expect(beams.geometry.instanceCount).toBe(BEAM_ROWS * 2);
        const strips = data(beams, 'aRow');
        for (let i = 0; i < BEAM_ROWS * 2; i++) {
            expect(strips[i * 2]).toBe(Math.floor(i / 2));
            expect(strips[i * 2 + 1]).toBe(i % 2 ? 1 : -1);
        }
        expect(frame.value.w).toBe(0);
        expect(frame.value.z).toBeLessThan(0);
        // Drawn over the scene in screen space: no depth test, nothing written to depth.
        expect(beams.material.depthTest).toBe(false);
        expect(beams.material.depthWrite).toBe(false);
        expect(beams.mesh.frustumCulled).toBe(false);
    });

    it('fires the rows it is given from the card\'s edges and parks again', () => {
        const { rows, frame, color } = beams.uniforms;
        beams.fire([0.7, 0.66], 0.41, 0.59, [1, 0.8, 0.5], 12, 0.9);
        expect(rows.value.toArray()).toEqual([0.7, 0.66, -1, -1]);
        expect(frame.value.toArray()).toEqual([0.41, 0.59, 12, 0.9]);
        expect(color.value.toArray()).toEqual([1, 0.8, 0.5]);
        // Four rows at most; full strength unless told.
        beams.fire([0.8, 0.76, 0.72, 0.68, 0.64], 0.3, 0.7, [0.5, 0.5, 1], 13);
        expect(rows.value.toArray()).toEqual([0.8, 0.76, 0.72, 0.68]);
        expect(frame.value.toArray()).toEqual([0.3, 0.7, 13, 1]);
        expect(color.value.toArray()).toEqual([0.5, 0.5, 1]);
        beams.fire([0.5], 0.3, 0.7, [1, 1, 1], 14);
        expect(rows.value.toArray()).toEqual([0.5, -1, -1, -1]);
        beams.reset();
        expect(frame.value.w).toBe(0);
        expect(frame.value.z).toBeLessThan(0);
    });
});

describe('winter paw prints', () => {
    const COUNT = 12;
    let prints;
    beforeAll(() => {
        prints = createPrints(u, COUNT);
    });
    beforeEach(() => prints.reset());
    afterAll(() => release(prints));

    const row = (name, i) => Array.from(data(prints, name).slice(i * 4, i * 4 + 4));

    it('starts as untrodden snow', () => {
        expect(prints.count).toBe(COUNT);
        expect(prints.pressed).toBe(0);
        expect(prints.geometry.instanceCount).toBe(COUNT);
        expect(Object.keys(prints.geometry.attributes).length).toBeLessThanOrEqual(8);
        for (const name of ['aPrint', 'aMade']) {
            expect(prints.geometry.getAttribute(name).usage).toBe(THREE.DynamicDrawUsage);
            expect(prints.geometry.getAttribute(name).count).toBe(COUNT);
        }
        for (let i = 0; i < COUNT; i++) {
            const [made, glow, size] = row('aMade', i);
            // Made long ago, of no size: nothing is drawn.
            expect(made).toBeLessThan(-100);
            expect(glow).toBe(0);
            expect(size).toBe(0);
        }
    });

    it('presses a print where the fox trod, when, how big and how alight', () => {
        const before = uploads(prints, ['aPrint', 'aMade']);
        prints.press(1.5, 0.25, -9, 0.75, 4.5, 0.5, 0.25);
        expect(prints.pressed).toBe(1);
        expect(row('aPrint', 0)).toEqual([1.5, 0.25, -9, 0.75]);
        expect(row('aMade', 0)).toEqual([4.5, 0.5, 0.25, 0]);
        uploads(prints, ['aPrint', 'aMade']).forEach((v, k) => expect(v).toBeGreaterThan(before[k]));
        // Unlit and of a usual size unless told.
        prints.press(2, 0.25, -9.5, 1, 5);
        expect(prints.pressed).toBe(2);
        const [made, glow, size] = row('aMade', 1);
        expect(made).toBe(5);
        expect(glow).toBe(0);
        expect(size).toBeGreaterThan(0);
        // The others are still untrodden.
        for (let i = 2; i < COUNT; i++) expect(row('aMade', i)[0]).toBeLessThan(-100);
    });

    it('keeps only so many: the oldest is trodden over', () => {
        for (let k = 0; k < COUNT + 3; k++) prints.press(k, 0, -k, 0.125 * k, 10 + k, 0, 0.25);
        // It counts every print ever pressed...
        expect(prints.pressed).toBe(COUNT + 3);
        // ...and holds the last COUNT of them: the first three slots were pressed again.
        for (let i = 0; i < 3; i++) {
            expect(row('aPrint', i)).toEqual([COUNT + i, 0, -(COUNT + i), 0.125 * (COUNT + i)]);
            expect(row('aMade', i)[0]).toBe(10 + COUNT + i);
        }
        for (let i = 3; i < COUNT; i++) {
            expect(row('aPrint', i)).toEqual([i, 0, -i, 0.125 * i]);
            expect(row('aMade', i)[0]).toBe(10 + i);
        }
        expect(prints.count).toBe(COUNT);
        expect(prints.geometry.instanceCount).toBe(COUNT);
    });

    it('is fresh snow again after a reset, and fills from the first slot', () => {
        for (let k = 0; k < 5; k++) prints.press(k, 0, -k, 0, 20 + k, 1, 0.25);
        const before = uploads(prints, ['aMade']);
        prints.reset();
        expect(uploads(prints, ['aMade'])[0]).toBeGreaterThan(before[0]);
        expect(prints.pressed).toBe(0);
        for (let i = 0; i < COUNT; i++) expect(row('aMade', i)[0]).toBeLessThan(-100);
        prints.press(7, 0.5, -3, 0.5, 30, 0, 0.25);
        expect(row('aPrint', 0)).toEqual([7, 0.5, -3, 0.5]);
        expect(prints.pressed).toBe(1);
    });
});
