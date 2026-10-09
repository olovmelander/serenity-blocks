/**
 * Waves — what is in the air: the dolphins and the spray, on the CPU side.
 *
 * Both are drawn from interleaved instance buffers the CPU writes: a dolphin's rows every frame
 * from its arc, a drop's rows once, when it leaves. These tests read the buffers back through the
 * attributes the materials read them with, so they hold whatever the layout of a row becomes.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
    FLOW, WAVE, axisOffset, landingDistance, lipAngle, wavePoint,
} from '../../src/themes/waves/waves-core.js';
import { REST_RIG } from '../../src/themes/waves/waves-composition.js';
import { HOURS, HOUR_COLOURS } from '../../src/themes/waves/waves-hours.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/waves/waves-quality.js';
import {
    createLight, createWaterNoise, createWaveShape, sunDirection,
} from '../../src/themes/waves/waves-tsl.js';
import { WavesPod, leapersFor } from '../../src/themes/waves/waves-life.js';
import {
    GRAVITY, SprayPool, createLipRain, createMist,
} from '../../src/themes/waves/waves-spray.js';

const DT = 1 / 60;
const EYE = REST_RIG.eye;
const SUN = sunDirection();
const made = [];

/** The uniforms the world shares with everything it builds. */
function uniforms() {
    return {
        time: uniform(0),
        sun: uniform(SUN.clone()),
        warm: uniform(0),
        open: uniform(0),
        bulge: uniform(new THREE.Vector4(-60, 0, 5, 0)),
        tear: uniform(0),
        // The hour everything in the air is lit by: golden hour, as the world starts.
        light: createLight(uniformArray(HOUR_COLOURS.map((key) => new THREE.Vector4(...HOURS[0][key], 0)), 'vec4')),
    };
}

function makePod(quality = 'High', seed = 187) {
    const pod = new WavesPod({
        tier: tierFor(quality), U: uniforms(), sun: SUN, eye: EYE, seed,
    });
    made.push(pod);
    return pod;
}

function makePool(quality = 'Minimal', seed = 187) {
    const pool = new SprayPool({ tier: tierFor(quality), U: uniforms(), seed });
    made.push(pool);
    return pool;
}

afterEach(() => {
    for (const thing of made.splice(0)) thing.dispose();
    vi.restoreAllMocks();
});

/** One dolphin's rows, as the material reads them. */
function instance(pod, i) {
    const place = pod.geometry.getAttribute('aPlace');
    const head = pod.geometry.getAttribute('aHead');
    return {
        x: place.getX(i),
        y: place.getY(i),
        z: place.getZ(i),
        size: place.getW(i),
        heading: Math.hypot(head.getX(i), head.getY(i), head.getZ(i)),
    };
}

/** Every drop of the pool, as the material reads it. */
function drops(pool) {
    const start = pool.geometry.getAttribute('aStart');
    const flight = pool.geometry.getAttribute('aFlight');
    const tint = pool.geometry.getAttribute('aTint');
    const out = [];
    for (let i = 0; i < pool.count; i++) {
        out.push({
            i,
            x: start.getX(i),
            y: start.getY(i),
            z: start.getZ(i),
            birth: start.getW(i),
            vx: flight.getX(i),
            vy: flight.getY(i),
            vz: flight.getZ(i),
            size: flight.getW(i),
            rgb: [tint.getX(i), tint.getY(i), tint.getZ(i)],
            life: tint.getW(i),
        });
    }
    return out;
}

/** The drops that have been thrown since the pool was last emptied. */
const thrown = (pool) => drops(pool).filter((drop) => drop.birth > -1000);

/** How far a point is from the still wave's section at its own distance, and the row nearest it. */
function nearestRow(p, open, from = 0, to = 1) {
    const q = { x: 0, y: 0, z: 0 };
    const steps = 4000;
    let off = Infinity;
    let row = from;
    for (let i = 0; i <= steps; i++) {
        const r = from + ((to - from) * i) / steps;
        wavePoint(r, -p.z, open, q);
        const here = Math.hypot(q.x - p.x, q.y - p.y);
        if (here < off) {
            off = here;
            row = r;
        }
    }
    return { off, row };
}

/** The top of a leap's arc. */
function apex(arc) {
    const t = arc.vy / GRAVITY;
    return {
        t,
        x: arc.x + arc.vx * t,
        y: arc.y + arc.vy * t - 0.5 * GRAVITY * t * t,
        z: arc.z + arc.vz * t,
    };
}

describe('waves pod: the dolphins', () => {
    it('keeps a pod the size its tier pays for, every one of them hidden and heading somewhere', () => {
        for (const quality of QUALITY_NAMES) {
            const pod = makePod(quality);
            expect(pod.count).toBe(QUALITY[quality].dolphins);
            expect(pod.arcs).toHaveLength(pod.count);
            expect(pod.geometry.instanceCount).toBe(pod.count);
            expect(pod.data.length % pod.count).toBe(0);
            expect(pod.airborne).toBe(0);
            for (let i = 0; i < pod.count; i++) {
                const at = instance(pod, i);
                expect(at.size).toBe(0);
                // A zero heading would be normalised into NaN on the GPU.
                expect(at.heading).toBeCloseTo(1, 6);
            }
        }
        // One draw call, one node material, never culled (its instances are placed on the GPU).
        const pod = makePod('Low');
        expect(pod.mesh.material.isNodeMaterial).toBe(true);
        expect(pod.mesh.frustumCulled).toBe(false);
        expect(pod.mesh.geometry).toBe(pod.geometry);
        // A tier with no dolphins still has the one the perfect clear calls.
        const lone = new WavesPod({
            tier: { dolphins: 0 }, U: uniforms(), sun: SUN, eye: EYE,
        });
        made.push(lone);
        expect(lone.count).toBe(1);
    });

    it('leaves from the lower face of the wave, up and out toward the sea', () => {
        const pod = makePod('Ultra');
        const wrong = [];
        for (let i = 0; i < 60; i++) {
            const open = (i % 5) / 4;
            const arc = pod.leap(i * 10, open);
            const d = -arc.z;
            const { off, row } = nearestRow(arc, open);
            const where = `leap ${i} at d ${d.toFixed(2)}, open ${open}`;
            if (!(off < 0.01)) wrong.push(`${where}: starts ${off} m off the wave`);
            // The face: the first rows of the wave, right of its foot, above the trough.
            if (!(row > 0 && row < 0.5)) wrong.push(`${where}: starts at row ${row}`);
            if (!(arc.x > axisOffset(d) && arc.y > 0)) wrong.push(`${where}: starts at (${arc.x}, ${arc.y})`);
            // Ahead of the eye, where the lip has not yet come down across the view.
            if (!(d > landingDistance(open))) wrong.push(`${where}: starts behind the lip's touchdown`);
            if (!(arc.vy > 0 && arc.vx < 0)) wrong.push(`${where}: leaves along (${arc.vx}, ${arc.vy})`);
            if (!(arc.flight > 0 && arc.size > 0)) wrong.push(`${where}: flight ${arc.flight}, size ${arc.size}`);
        }
        expect(wrong).toEqual([]);
        // Where it is told to: the distance and the height asked for.
        const told = pod.leap(0, 0, { d: 11, height: 2 });
        expect(told.z).toBe(-11);
        expect(apex(told).y - told.y).toBeCloseTo(2, 9);
        expect(nearestRow(told, 0).off).toBeLessThan(0.01);
    });

    it('is in the air for its flight, comes back down to the water and breaks the surface twice', () => {
        const pod = makePod('High');
        const t0 = 10;
        const arc = pod.leap(t0, 0, { d: 12 });
        const { flight } = arc;
        expect(flight).toBeGreaterThan(1);
        // The arc itself: up from where it left, and down to the trough's level at the end of the flight.
        const landingY = arc.y + arc.vy * flight - 0.5 * GRAVITY * flight * flight;
        expect(landingY).toBeCloseTo(0, 9);
        expect(apex(arc).y).toBeGreaterThan(arc.y);
        expect(apex(arc).t).toBeLessThan(flight);

        const splash = vi.fn();
        const frames = [];
        const end = t0 + flight + 3;
        for (let n = 0; t0 - 1 + n * DT <= end; n++) {
            const time = t0 - 1 + n * DT;
            pod.update(time, splash);
            frames.push({ time, airborne: pod.airborne, ...instance(pod, 0) });
        }
        // Before it leaves and long after it is back: hidden.
        expect(frames[0].size).toBe(0);
        expect(frames[frames.length - 1].size).toBe(0);
        expect(arc.active).toBe(false);
        // Airborne from the moment it breaks the surface to the moment it goes back in.
        const inAir = frames.filter((frame) => frame.airborne > 0);
        expect(inAir.every((frame) => frame.airborne === 1)).toBe(true);
        expect(inAir[0].time).toBeGreaterThanOrEqual(t0 - 1e-9);
        expect(inAir[0].time).toBeLessThan(t0 + 2 * DT);
        expect(inAir[inAir.length - 1].time).toBeLessThanOrEqual(t0 + flight + 1e-9);
        expect(inAir[inAir.length - 1].time).toBeGreaterThan(t0 + flight - 2 * DT);
        expect(inAir.length * DT).toBeCloseTo(flight, 1);
        // In the air it is drawn, on its arc: over the top of it and back down to the water.
        expect(inAir.every((frame) => frame.size > 0)).toBe(true);
        const highest = inAir.reduce((top, frame) => Math.max(top, frame.y), -Infinity);
        expect(highest).toBeCloseTo(apex(arc).y, 2);
        expect(inAir[0].y).toBeCloseTo(arc.y, 1);
        expect(Math.abs(inAir[inAir.length - 1].y)).toBeLessThan(0.1);
        // Once where it breaks the surface, once where it goes back in. No more.
        expect(splash).toHaveBeenCalledTimes(2);
        const [[x0, y0, z0, s0], [x1, y1, z1, s1]] = splash.mock.calls;
        expect([x0, y0, z0]).toEqual([arc.x, arc.y, arc.z]);
        expect(x1).toBeCloseTo(arc.x + arc.vx * flight, 9);
        expect(y1).toBe(0);
        expect(z1).toBeCloseTo(arc.z + arc.vz * flight, 9);
        expect(s0).toBeGreaterThan(0);
        expect(s1).toBeGreaterThan(0);
        // It went back into the sea in front of the wave, not into the wave.
        expect(x1).toBeLessThan(x0);
        const [first, second] = splash.mock.invocationCallOrder;
        expect(first).toBeLessThan(second);
    });

    it('throws a hero across the sun: the top of its arc is on the line from the eye to the sun', () => {
        const pod = makePod('High');
        // Well ahead, where the sun's line stands clear of the face (nearer the eye the smallest
        // leap a dolphin makes is already higher than the sun).
        for (const open of [0, 0.5, 1]) {
            for (const d of [12, 13, 14, 15, 16]) {
                const arc = pod.leap(0, open, { hero: true, d });
                const top = apex(arc);
                const rel = [top.x - EYE.x, top.y - EYE.y, top.z - EYE.z];
                const along = rel[0] * SUN.x + rel[1] * SUN.y + rel[2] * SUN.z;
                const off = Math.hypot(rel[0] - SUN.x * along, rel[1] - SUN.y * along, rel[2] - SUN.z * along);
                const where = `d ${d}, open ${open}`;
                expect(off, where).toBeLessThan(0.3);
                expect(along, where).toBeGreaterThan(0); // toward the sun, not away from it
                // It still leaves the face and comes down in the sea in front of the wave.
                expect(nearestRow(arc, open).off, where).toBeLessThan(0.01);
                expect(arc.vx, where).toBeLessThan(0);
                expect(arc.y + arc.vy * arc.flight - 0.5 * GRAVITY * arc.flight ** 2, where).toBeCloseTo(0, 9);
            }
        }
    });

    it('never writes a size for a hidden dolphin, nor a heading that is not a direction', () => {
        const pod = makePod('Extreme');
        const stride = pod.data.length / pod.count;
        const wrong = [];
        // A pod sent one after another, the first across the sun, as a long chain sends it.
        for (let i = 0; i < pod.count; i++) pod.leap(5 + i * 0.6, 0.4, { hero: i === 0, d: i === 0 ? 12.5 : null });
        const end = Math.max(...pod.arcs.map((arc) => arc.t0 + arc.flight)) + 3;
        let shown = 0;
        for (let n = 0; n * DT < end; n++) {
            const time = n * DT;
            pod.update(time, null);
            for (let i = 0; i < pod.count; i++) {
                const arc = pod.arcs[i];
                const at = instance(pod, i);
                const row = Array.from(pod.data.subarray(i * stride, (i + 1) * stride));
                if (!row.every(Number.isFinite)) wrong.push(`dolphin ${i} at ${time}: ${row}`);
                if (!(Math.abs(at.heading - 1) < 1e-5)) wrong.push(`dolphin ${i} at ${time}: heading ${at.heading}`);
                const flying = arc.active && time >= arc.t0 && time <= arc.t0 + arc.flight;
                if (flying && !(at.size > 0)) wrong.push(`dolphin ${i} at ${time}: in the air and not drawn`);
                if (!arc.active && at.size !== 0) wrong.push(`dolphin ${i} at ${time}: retired and still drawn`);
                if (at.size > 0) shown += 1;
            }
        }
        expect(wrong).toEqual([]);
        expect(shown).toBeGreaterThan(pod.count * 60);
        // All of them are back in the water, and hidden.
        expect(pod.airborne).toBe(0);
        expect(pod.arcs.every((arc) => !arc.active)).toBe(true);
        for (let i = 0; i < pod.count; i++) expect(instance(pod, i).size).toBe(0);
    });

    it('counts who is in the air, and tells the renderer when its rows change', () => {
        const pod = makePod('High');
        pod.leap(1, 0);
        pod.leap(1.5, 0);
        pod.leap(40, 0);
        const before = pod.buffer.version;
        pod.update(0, null);
        expect(pod.buffer.version).toBeGreaterThan(before);
        expect(pod.airborne).toBe(0);
        pod.update(1.2, null);
        expect(pod.airborne).toBe(1);
        pod.update(2.5, null);
        expect(pod.airborne).toBe(2);
        pod.update(41, null);
        expect(pod.airborne).toBe(1);
        // No listener for the splashes is no error.
        expect(() => pod.update(100)).not.toThrow();
        expect(pod.airborne).toBe(0);
    });

    it('takes its dolphins in turn and never grows, however many are called', () => {
        const pod = makePod('Minimal');
        const { data, arcs } = pod;
        const size = data.length;
        const first = pod.leap(0, 0);
        for (let i = 1; i < pod.count; i++) expect(pod.leap(i, 0)).not.toBe(first);
        // One more than the pod: the first is taken again.
        expect(pod.leap(100, 0)).toBe(first);
        expect(first.t0).toBe(100);
        for (let i = 0; i < 50; i++) pod.leap(200 + i, 0.5);
        expect(pod.arcs).toBe(arcs);
        expect(pod.arcs).toHaveLength(pod.count);
        expect(pod.data).toBe(data);
        expect(pod.data).toHaveLength(size);
    });

    it('starts over on reset: nobody in the air, and the same leaps in the same order', () => {
        const pod = makePod('High');
        const options = [{}, {}, { hero: true, d: 12.5 }];
        const snapshot = () => options.map((option, i) => ({ ...pod.leap(i, i * 0.5, option) }));
        const first = snapshot();
        pod.update(1.5, null);
        expect(pod.airborne).toBeGreaterThan(0);
        pod.reset();
        expect(pod.airborne).toBe(0);
        expect(pod.arcs.every((arc) => !arc.active)).toBe(true);
        for (let i = 0; i < pod.count; i++) {
            expect(instance(pod, i).size).toBe(0);
            expect(instance(pod, i).heading).toBeCloseTo(1, 6);
        }
        expect(snapshot()).toEqual(first);
        // A pod built from the same seed leaps the same way; another seed is another pod.
        const twin = makePod('High');
        expect([0, 1].map((i) => ({ ...twin.leap(i, i * 0.5) }))).toEqual(first.slice(0, 2));
        const other = makePod('High', 4);
        expect({ ...other.leap(0, 0) }).not.toEqual(first[0]);
    });

    it('calls more dolphins for a longer chain, none for a clear that is not one', () => {
        expect(leapersFor(0)).toBe(0);
        expect(leapersFor(1)).toBe(0);
        let previous = 0;
        for (let combo = 0; combo <= 40; combo++) {
            const n = leapersFor(combo);
            expect(Number.isInteger(n)).toBe(true);
            expect(n).toBeGreaterThanOrEqual(previous);
            // One more at a time: a chain builds the pod, it does not jump to it.
            expect(n - previous).toBeLessThanOrEqual(1);
            previous = n;
        }
        expect(previous).toBeGreaterThan(1);
        expect(leapersFor(1000)).toBe(previous);
        // The dearest tier can send the whole call.
        expect(QUALITY.Extreme.dolphins).toBeGreaterThanOrEqual(previous);
    });

    it('lets go of everything it made', () => {
        const pod = new WavesPod({
            tier: tierFor('Low'), U: uniforms(), sun: SUN, eye: EYE,
        });
        const scene = new THREE.Scene();
        scene.add(pod.mesh);
        const spies = [pod.geometry, pod.model.geometry, pod.material].map((thing) => vi.spyOn(thing, 'dispose'));
        pod.dispose();
        expect(scene.children).toHaveLength(0);
        for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    });
});

describe('waves pod: thrown spray', () => {
    it('starts with nothing in the air: every drop born long ago', () => {
        for (const quality of QUALITY_NAMES) {
            const pool = makePool(quality);
            expect(pool.count).toBe(QUALITY[quality].spray);
            expect(pool.geometry.instanceCount).toBe(pool.count);
            expect(pool.cursor).toBe(0);
            expect(thrown(pool)).toHaveLength(0);
            const all = drops(pool);
            expect(all).toHaveLength(pool.count);
            // Long past any life a drop is given, and with a life that is not a division by nothing.
            expect(all.every((drop) => drop.birth < -1000 && drop.life > 0 && drop.size === 0)).toBe(true);
            expect(pool.data.every(Number.isFinite)).toBe(true);
        }
        expect(GRAVITY).toBeGreaterThan(0);
    });

    it('throws a crown: as many drops as asked for, up and out from the point it is given', () => {
        const pool = makePool();
        const options = {
            n: 17, out: [0.2, 0.6], up: [0.5, 1.1], size: 0.03, rgb: [0.2, 0.9, 0.4], life: [1.5, 2.5], radius: 0.3,
        };
        const { version } = pool.buffer;
        pool.crown(7, 1.5, 0, -3, options);
        expect(pool.buffer.version).toBeGreaterThan(version);
        expect(pool.cursor).toBe(17);
        const crown = thrown(pool);
        expect(crown).toHaveLength(17);
        expect(crown.map((drop) => drop.i)).toEqual(Array.from({ length: 17 }, (_, i) => i));
        for (const drop of crown) {
            // From the point, within the crown's radius, just clear of the surface.
            expect(Math.hypot(drop.x - 1.5, drop.z + 3)).toBeLessThanOrEqual(0.3 + 1e-6);
            expect(drop.y).toBeGreaterThanOrEqual(0);
            expect(drop.y).toBeLessThan(0.1);
            // Upward, at a speed from the range it was given.
            expect(drop.vy).toBeGreaterThanOrEqual(0.5 - 1e-6);
            expect(drop.vy).toBeLessThanOrEqual(1.1 + 1e-6);
            // Leaving now, in its colour, for a life from the range it was given.
            expect(drop.birth).toBeGreaterThanOrEqual(7);
            expect(drop.birth).toBeLessThan(7.5);
            expect(drop.rgb[0]).toBeCloseTo(0.2, 6);
            expect(drop.rgb[1]).toBeCloseTo(0.9, 6);
            expect(drop.rgb[2]).toBeCloseTo(0.4, 6);
            expect(drop.life).toBeGreaterThanOrEqual(1.5 - 1e-6);
            expect(drop.life).toBeLessThanOrEqual(2.5 + 1e-6);
            expect(drop.size).toBeGreaterThan(0);
        }
        // Thrown all round the point, not to one side of it.
        const outward = crown.map((drop) => Math.atan2(drop.z + 3, drop.x - 1.5));
        expect(Math.max(...outward) - Math.min(...outward)).toBeGreaterThan(Math.PI / 2);
        // `toward` sends the same crown toward the eye by that much.
        pool.reset();
        pool.crown(7, 1.5, 0, -3, options);
        const plain = thrown(pool).map((drop) => drop.vz);
        pool.reset();
        pool.crown(7, 1.5, 0, -3, { ...options, toward: 0.75 });
        thrown(pool).forEach((drop, i) => expect(drop.vz - plain[i]).toBeCloseTo(0.75, 5));
        // None asked for: none thrown.
        pool.reset();
        pool.crown(7, 0, 0, 0, { n: 0 });
        expect(thrown(pool)).toHaveLength(0);
        // With nothing said at all it still throws some.
        pool.crown(7, 0, 0, 0);
        expect(thrown(pool).length).toBeGreaterThan(0);
    });

    it('throws the lip: every drop leaves the lip\'s edge, between the distances it is given', () => {
        for (const open of [0, 0.5, 1]) {
            const pool = makePool('Low');
            const from = landingDistance(open) - 0.5;
            const to = landingDistance(open) + WAVE.throwLength - 2;
            pool.throwLip(20, open, {
                from, to, n: 60, speed: [0.8, 2], size: 0.03, life: [2, 3], delay: 0.3, flown: 0.9,
            });
            const sheet = thrown(pool);
            expect(sheet).toHaveLength(60);
            expect(pool.cursor).toBe(60);
            const wrong = [];
            for (const drop of sheet) {
                const d = -drop.z;
                const where = `drop ${drop.i} at d ${d.toFixed(2)}, open ${open}`;
                if (!(d >= from - 1e-4 && d <= to + 1e-4)) wrong.push(`${where}: outside the throw`);
                // On the wave, in the last of its rows before the edge.
                const { off, row } = nearestRow(drop, open, 0.8, 1);
                if (!(off < 0.01 && row > 0.9)) wrong.push(`${where}: ${off} m off the wave, at row ${row}`);
                // Some are written as already in flight: the sheet is in the air the moment it is thrown.
                const early = drop.birth >= 20 - 0.9 - 1e-4;
                const late = drop.birth <= 20 + 0.3 + 1e-4;
                if (!(early && late)) wrong.push(`${where}: born ${drop.birth}`);
                if (!(drop.life >= 2 - 1e-4 && drop.life <= 3 + 1e-4)) wrong.push(`${where}: life ${drop.life}`);
                if (!(drop.size > 0)) wrong.push(`${where}: size ${drop.size}`);
            }
            expect(wrong).toEqual([]);
            // All along the throw, not from one place on it.
            const reach = sheet.map((drop) => -drop.z);
            expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan((to - from) * 0.5);
        }
    });

    it('throws the lip the way the water was going: off the edge, along the lip', () => {
        const pool = makePool('Low');
        // Where the lip hangs down the far side, the water leaves it going down and inward.
        const d = landingDistance(0) + 1;
        expect(lipAngle(d, 0)).toBeGreaterThan(Math.PI * 1.25);
        pool.throwLip(0, 0, {
            from: d, to: d, n: 80, speed: [3, 3], delay: 0, flown: 0,
        });
        const edge = wavePoint(1, d, 0);
        const inner = wavePoint(0.95, d, 0);
        const tangent = [edge.x - inner.x, edge.y - inner.y];
        const sheet = thrown(pool);
        const mean = sheet.reduce((sum, drop) => [sum[0] + drop.vx / 80, sum[1] + drop.vy / 80], [0, 0]);
        // The same way, on the whole, as the last stretch of the lip runs.
        expect(mean[0] * tangent[0] + mean[1] * tangent[1]).toBeGreaterThan(0);
        expect(Math.hypot(...mean)).toBeGreaterThan(1.5);
        // Thrown at once when no delay and no head start are asked for.
        expect(sheet.every((drop) => drop.birth === 0)).toBe(true);
    });

    it('splits a prism throw into colours of its own and leaves a plain one in the colour given', () => {
        const pool = makePool('Low');
        const rgb = [1, 0.9, 0.8];
        pool.throwLip(0, 0, { n: 40, rgb });
        for (const drop of thrown(pool)) {
            expect(drop.rgb[0]).toBeCloseTo(1, 6);
            expect(drop.rgb[1]).toBeCloseTo(0.9, 6);
            expect(drop.rgb[2]).toBeCloseTo(0.8, 6);
        }
        pool.reset();
        pool.throwLip(0, 0, { n: 40, rgb, prism: 0.4 });
        const hues = new Set();
        for (const drop of thrown(pool)) {
            // Leaned toward a colour, never past black and never by more than it was asked.
            drop.rgb.forEach((channel, c) => {
                expect(channel).toBeGreaterThanOrEqual(rgb[c] * 0.6 - 1e-6);
                expect(channel).toBeLessThanOrEqual(rgb[c] * 1.4 + 1e-6);
            });
            hues.add(drop.rgb.map((channel) => channel.toFixed(3)).join());
        }
        expect(hues.size).toBeGreaterThan(30);
        // The colour it was given is still the caller's.
        expect(rgb).toEqual([1, 0.9, 0.8]);
    });

    it('throws a wheel of spray off the walls, all round the tube at one distance, and ahead', () => {
        const pool = makePool('Low');
        const d = landingDistance(0) + 1.5;
        pool.swirl(30, 0, { d, n: 48 });
        const wheel = thrown(pool);
        expect(wheel).toHaveLength(48);
        expect(pool.cursor).toBe(48);
        const wrong = [];
        const angles = [];
        for (const drop of wheel) {
            const where = `drop ${drop.i}`;
            if (!(Math.abs(-drop.z - d) < 1)) wrong.push(`${where}: at d ${-drop.z}`);
            // Just off the wall, on the tube's side of it.
            const { off } = nearestRow(drop, 0);
            const inside = ((drop.x - axisOffset(-drop.z)) / WAVE.a) ** 2 + ((drop.y - WAVE.b) / WAVE.b) ** 2;
            if (!(off < 0.5)) wrong.push(`${where}: ${off} m from the wall`);
            if (!(inside < 1)) wrong.push(`${where}: outside the tube`);
            // Flung ahead, down the line, a moment after the one before it.
            if (!(drop.vz < 0)) wrong.push(`${where}: flung back (${drop.vz})`);
            if (!(drop.birth >= 30 && drop.birth < 31)) wrong.push(`${where}: born ${drop.birth}`);
            if (!(drop.size > 0 && drop.life > 0)) wrong.push(`${where}: size ${drop.size}, life ${drop.life}`);
            angles.push(Math.atan2(drop.x - axisOffset(-drop.z), WAVE.b - drop.y));
        }
        expect(wrong).toEqual([]);
        // A wheel: from the face over the roof and down the lip.
        const sorted = wheel.map((drop) => drop.birth);
        expect(sorted.every((birth, i) => i === 0 || birth >= sorted[i - 1])).toBe(true);
        expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI);
        expect(wheel.some((drop) => drop.y > WAVE.b)).toBe(true);
        expect(wheel.some((drop) => drop.y < WAVE.b)).toBe(true);
    });

    it('wraps round its ring of drops without growing: the oldest are thrown again first', () => {
        const pool = makePool('Minimal');
        const { data, count } = pool;
        const size = data.length;
        pool.crown(1, 0, 0, 0, { n: count - 5 });
        expect(pool.cursor).toBe(count - 5);
        expect(thrown(pool)).toHaveLength(count - 5);
        // Past the end: back to the start.
        pool.throwLip(50, 0, { n: 12, delay: 0, flown: 0 });
        expect(pool.cursor).toBe(7);
        expect(thrown(pool)).toHaveLength(count);
        const again = drops(pool).filter((drop) => drop.birth === 50).map((drop) => drop.i).sort((a, b) => a - b);
        expect(again).toEqual([0, 1, 2, 3, 4, 5, 6, count - 5, count - 4, count - 3, count - 2, count - 1]);
        // Many times round.
        pool.swirl(60, 0, { n: count * 3 + 11 });
        expect(pool.cursor).toBe((7 + count * 3 + 11) % count);
        expect(thrown(pool)).toHaveLength(count);
        expect(pool.data).toBe(data);
        expect(pool.data).toHaveLength(size);
        expect(pool.count).toBe(count);
        expect(pool.data.every(Number.isFinite)).toBe(true);
    });

    it('empties on reset, and throws the same drops again after it', () => {
        const pool = makePool('Low');
        const throwAll = () => {
            pool.crown(3, 0.4, 0, -2, { n: 20 });
            pool.throwLip(3, 0.3, { n: 50 });
            pool.swirl(3, 0.3, { n: 30 });
            return Array.from(pool.data);
        };
        const first = throwAll();
        expect(thrown(pool)).toHaveLength(100);
        expect(first.every(Number.isFinite)).toBe(true);
        const { version } = pool.buffer;
        pool.reset();
        expect(pool.buffer.version).toBeGreaterThan(version);
        expect(pool.cursor).toBe(0);
        expect(thrown(pool)).toHaveLength(0);
        expect(drops(pool).every((drop) => drop.birth < -1000 && drop.life > 0)).toBe(true);
        expect(throwAll()).toEqual(first);
        // The same seed is the same spray; another seed is another.
        const twin = makePool('Low');
        twin.crown(3, 0.4, 0, -2, { n: 20 });
        expect(Array.from(twin.data.subarray(0, 240))).toEqual(first.slice(0, 240));
        const other = makePool('Low', 3);
        other.crown(3, 0.4, 0, -2, { n: 20 });
        expect(Array.from(other.data.subarray(0, 240))).not.toEqual(first.slice(0, 240));
    });

    it('lets go of everything it made', () => {
        const pool = new SprayPool({ tier: tierFor('Low'), U: uniforms() });
        const scene = new THREE.Scene();
        scene.add(pool.mesh);
        const spies = [pool.geometry, pool.base, pool.material].map((thing) => vi.spyOn(thing, 'dispose'));
        pool.dispose();
        expect(scene.children).toHaveLength(0);
        for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    });
});

describe('waves pod: the standing rain and the spindrift', () => {
    const build = (quality, seed) => {
        const U = uniforms();
        const tier = tierFor(quality);
        const shape = createWaveShape(U);
        const noise = createWaterNoise(32);
        const rain = createLipRain({
            tier, U, shape, seed,
        });
        const mist = createMist({
            tier, U, shape, noise, seed,
        });
        made.push(rain, mist, noise);
        return { tier, rain, mist };
    };
    const seeds = (part) => Array.from(part.mesh.geometry.getAttribute('aSeed').array);

    it('seeds a drop for every droplet its tier pays for, and at least a few sheets of mist', () => {
        for (const quality of QUALITY_NAMES) {
            const { tier, rain, mist } = build(quality, 187);
            expect(rain.mesh.geometry.instanceCount).toBe(tier.droplets);
            expect(mist.mesh.geometry.instanceCount).toBeGreaterThanOrEqual(tier.mist);
            expect(mist.mesh.geometry.instanceCount).toBeGreaterThanOrEqual(4);
            expect(seeds(rain)).toHaveLength(tier.droplets * 4);
            expect(seeds(rain).every((s) => s >= 0 && s <= 1)).toBe(true);
            expect(seeds(mist).every((s) => s >= 0 && s <= 1)).toBe(true);
            for (const part of [rain, mist]) {
                expect(part.mesh.material.isNodeMaterial).toBe(true);
                // Light added to the frame and nothing else touched.
                expect(part.mesh.material.depthWrite).toBe(false);
                expect(part.mesh.material.blending).toBe(THREE.AdditiveBlending);
                expect(part.mesh.frustumCulled).toBe(false);
            }
        }
    });

    it('gives the mist both of its kinds, spread along their lines, the same for the same seed', () => {
        const { mist, rain } = build('Medium', 187);
        const rows = [];
        const all = seeds(mist);
        for (let i = 0; i < all.length; i += 4) rows.push(all.slice(i, i + 4));
        // The boil where the lip lands, and the plume off the crest: each sheet is one or the other.
        expect(rows.every((row) => row[3] === 0 || row[3] === 1)).toBe(true);
        expect(rows.some((row) => row[3] === 0)).toBe(true);
        expect(rows.some((row) => row[3] === 1)).toBe(true);
        // Stratified along the line: one sheet to each stretch of it.
        rows.forEach((row, i) => {
            expect(row[0]).toBeGreaterThanOrEqual(i / rows.length - 1e-6);
            expect(row[0]).toBeLessThanOrEqual((i + 1) / rows.length + 1e-6);
        });
        const twin = build('Medium', 187);
        expect(seeds(twin.mist)).toEqual(all);
        expect(seeds(twin.rain)).toEqual(seeds(rain));
        const other = build('Medium', 5);
        expect(seeds(other.mist)).not.toEqual(all);
        expect(seeds(other.rain)).not.toEqual(seeds(rain));
    });

    it('leaves the scene and frees what it made', () => {
        const U = uniforms();
        const shape = createWaveShape(U);
        const noise = createWaterNoise(32);
        made.push(noise);
        const tier = tierFor('Low');
        const parts = [createLipRain({ tier, U, shape }), createMist({
            tier, U, shape, noise,
        })];
        const scene = new THREE.Scene();
        for (const part of parts) {
            scene.add(part.mesh);
            const geometry = vi.spyOn(part.mesh.geometry, 'dispose');
            const material = vi.spyOn(part.mesh.material, 'dispose');
            part.dispose();
            expect(geometry).toHaveBeenCalledOnce();
            expect(material).toHaveBeenCalledOnce();
        }
        expect(scene.children).toHaveLength(0);
        // The drops are carried at the flow's own pace: slow motion, like the wave.
        expect(FLOW.u).toBeGreaterThan(0);
    });
});
