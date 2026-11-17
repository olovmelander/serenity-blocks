/**
 * Waves — what is in the air and in the water: the sea life and the spray, on the CPU side.
 *
 * Both are drawn from interleaved instance buffers the CPU writes: an animal's rows every frame
 * from its act (waves-acts.js), a drop's rows once, when it leaves. These tests read the buffers
 * back through the attributes the materials read them with, so they hold whatever the layout of a
 * row becomes.
 */
import { readFileSync } from 'node:fs';
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
import { WavesLife, leapersFor } from '../../src/themes/waves/waves-life.js';
import {
    KINDS, SPECIES, actPose, makeWhale,
} from '../../src/themes/waves/waves-acts.js';
import { FAUNA_STRIDE, slotsFor } from '../../src/themes/waves/waves-fauna.js';
import { parseSeaLife } from '../../src/themes/waves/waves-cast.js';
import {
    GRAVITY, SprayPool, createLipRain, createMist,
} from '../../src/themes/waves/waves-spray.js';

const DT = 1 / 60;
/** The two dolphins: what the board's pod is made of. */
const LEAPERS = ['bottlenose', 'spinner'];
const EYE = REST_RIG.eye;
const SUN = sunDirection();
const made = [];
const PACK = parseSeaLife(readFileSync(new URL('../../src/themes/waves/assets/sea-life.glb', import.meta.url)));

/** The uniforms the world shares with everything it builds. */
function uniforms() {
    return {
        time: uniform(0),
        sun: uniform(SUN.clone()),
        warm: uniform(0),
        open: uniform(0),
        bulge: uniform(new THREE.Vector4(-60, 0, 5, 0)),
        tear: uniform(0),
        heave: uniform(0),
        glowing: uniform(0),
        // The sea's own state, as it starts: glass.
        sea: uniform(new THREE.Vector4(0.3, 0, 0, 0.15)),
        // The hour everything in the air is lit by: golden hour, as the world starts.
        light: createLight(uniformArray(HOUR_COLOURS.map((key) => new THREE.Vector4(...HOURS[0][key], 0)), 'vec4')),
    };
}

/** The sea life of a tier: only what the board calls (`ambient`: the sea's own visits too). */
function makeLife(quality = 'High', { seed = 187, ambient = false, pack = PACK } = {}) {
    const life = new WavesLife({
        tier: tierFor(quality), U: uniforms(), sun: SUN, eye: EYE, seed, ambient,
    });
    if (pack) life.attach(pack);
    made.push(life);
    return life;
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

/** The `i`th animal of a kind, as the material reads it. */
function instance(life, kind, i = 0) {
    const { geometry } = life.fauna.kinds[kind];
    const place = geometry.getAttribute('aRow0');
    const head = geometry.getAttribute('aRow1');
    const back = geometry.getAttribute('aRow2');
    return {
        x: place.getX(i),
        y: place.getY(i),
        z: place.getZ(i),
        metres: place.getW(i),
        heading: Math.hypot(head.getX(i), head.getY(i), head.getZ(i)),
        back: Math.hypot(back.getX(i), back.getY(i), back.getZ(i)),
        square: head.getX(i) * back.getX(i) + head.getY(i) * back.getY(i) + head.getZ(i) * back.getZ(i),
        depth: back.getW(i),
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

/** The leap fields that make it what it is (none of what a frame writes on it). */
const leapShape = (arc) => ({
    kind: arc.kind,
    t0: arc.t0,
    x: arc.x,
    y: arc.y,
    z: arc.z,
    vx: arc.vx,
    vy: arc.vy,
    vz: arc.vz,
    metres: arc.metres,
    style: arc.style,
    turns: arc.turns,
    flight: arc.flight,
});

describe('waves life: the animals', () => {
    it('has room for as many of each kind as its tier pays for, and the pod a chain can call', () => {
        for (const quality of QUALITY_NAMES) {
            const life = makeLife(quality);
            const tier = QUALITY[quality];
            expect(life.count).toBe(tier.dolphins);
            for (const kind of KINDS) {
                expect(life.capacity[kind]).toBe(slotsFor(kind, tier));
                expect(life.capacity[kind]).toBeGreaterThanOrEqual(1);
                expect(life.capacity[kind]).toBeLessThanOrEqual(SPECIES[kind].slots);
                expect(life.fauna.slots(kind)).toBe(life.capacity[kind]);
            }
            // The two dolphins hold a whole chain's pod at once, on every tier.
            expect(life.capacity.bottlenose + life.capacity.spinner).toBeGreaterThanOrEqual(life.count);
        }
        // A tier with no dolphins still has the one the perfect clear calls.
        const lone = new WavesLife({
            tier: { dolphins: 0, life: 1 }, U: uniforms(), sun: SUN, eye: EYE,
        });
        made.push(lone);
        expect(lone.count).toBe(1);
    });

    it('draws each kind with one instanced draw in the air, and one behind the water for those seen through it', () => {
        const life = makeLife('Low');
        expect(life.mesh.isGroup).toBe(true);
        const { kinds } = life.fauna;
        expect(Object.keys(kinds).sort()).toEqual([...KINDS].sort());
        const materials = new Set();
        for (const kind of KINDS) {
            const { inAir, behind, geometry } = kinds[kind];
            expect(inAir.geometry).toBe(geometry);
            expect(inAir.frustumCulled).toBe(false);
            materials.add(inAir.material);
            // A far whale and a bird in the sky are never seen through the water.
            if (kind === 'humpback' || kind === 'seabird') {
                expect(behind).toBeNull();
            } else {
                expect(behind.geometry).toBe(geometry);
                expect(behind.material.depthFunc).toBe(THREE.GreaterDepth);
                expect(behind.material.transparent).toBe(true);
                expect(behind.material.depthWrite).toBe(false);
                expect(behind.renderOrder).toBeLessThan(inAir.renderOrder);
                materials.add(behind.material);
            }
            // The pack's own body, with the rows this tier writes on top of it.
            expect(geometry.index).toBe(PACK.kinds[kind].geometry.index);
            expect(geometry.getAttribute('position')).toBe(PACK.kinds[kind].geometry.getAttribute('position'));
            expect(geometry.getAttribute('aRow0').data.stride).toBe(FAUNA_STRIDE);
        }
        // Two materials for the whole cast: two pipelines, whatever comes into the water.
        expect(materials.size).toBe(2);
        expect([...materials].every((material) => material.isNodeMaterial)).toBe(true);
        // Nothing is drawn before anything is there.
        life.update(0, 0, null);
        for (const kind of KINDS) {
            expect(kinds[kind].inAir.visible).toBe(false);
            expect(instance(life, kind).metres).toBe(0);
        }
    });

    it('runs without its bodies: the acts, the counts and the splashes go on, nothing is drawn', () => {
        const life = makeLife('High', { pack: null });
        expect(life.fauna).toBeNull();
        const arc = life.leap(1, 0, { d: 11 });
        const heard = [];
        for (let n = 0; n * DT <= arc.flight + 4; n++) life.update(n * DT, 0, (act, event) => heard.push(event.type));
        expect(heard).toEqual(['breach', 'entry']);
        expect(life.drawn.bottlenose + life.drawn.spinner).toBe(0);
        // They arrive late: from then on it is drawn.
        expect(life.attach(PACK)).toBe(true);
        expect(life.attach(PACK)).toBe(false);
        life.leap(20, 0, { d: 11 });
        life.update(21, 0, null);
        expect(life.drawn.bottlenose + life.drawn.spinner).toBe(1);
    });

    it('leaves the trough at the foot of the wave, ahead of the lip, up and out toward the sea', () => {
        const life = makeLife('Ultra');
        const wrong = [];
        for (let i = 0; i < 60; i++) {
            const open = (i % 5) / 4;
            const arc = life.leap(i * 10, open);
            const d = -arc.z;
            const where = `leap ${i} at d ${d.toFixed(2)}, open ${open}`;
            // On the water in front of the face (clear of the card), within a few metres of its foot.
            if (!(arc.row <= 0 && arc.y === 0)) wrong.push(`${where}: starts at row ${arc.row}, y ${arc.y}`);
            const out = axisOffset(d) - arc.x;
            if (!(out > 0.5 && out < 3.2)) wrong.push(`${where}: starts ${out} m out from the foot of the face`);
            if (!(d > landingDistance(open))) wrong.push(`${where}: starts behind the lip's touchdown`);
            if (!(arc.vy > 0 && arc.vx < 0)) wrong.push(`${where}: leaves along (${arc.vx}, ${arc.vy})`);
            if (!(arc.flight > 0 && arc.metres > 0)) wrong.push(`${where}: flight ${arc.flight}, metres ${arc.metres}`);
            if (!LEAPERS.includes(arc.kind)) wrong.push(`${where}: a ${arc.kind}`);
        }
        expect(wrong).toEqual([]);
        // Where it is told to: the distance and the height asked for.
        const told = life.leap(0, 0, { d: 11, height: 2 });
        expect(told.z).toBe(-11);
        expect(apex(told).y - told.y).toBeCloseTo(2, 9);
        // What it is told to be.
        expect(life.leap(0, 0, { kind: 'spinner', style: 'spin', turns: 3 })).toMatchObject({
            kind: 'spinner', style: 'spin', turns: 3,
        });
    });

    it('flies its leaps every way: plain arcs, spins, somersaults, breaches onto the side', () => {
        const life = makeLife('High');
        const styles = {};
        const kinds = {};
        for (let i = 0; i < 400; i++) {
            const arc = life.leap(i, 0);
            styles[`${arc.kind}:${arc.style}`] = (styles[`${arc.kind}:${arc.style}`] || 0) + 1;
            kinds[arc.kind] = (kinds[arc.kind] || 0) + 1;
            if (arc.style === 'spin') expect(arc.turns).toBeGreaterThanOrEqual(2);
        }
        // Mostly bottlenose, the spinners spinning.
        expect(kinds.bottlenose).toBeGreaterThan(kinds.spinner);
        expect(kinds.spinner).toBeGreaterThan(60);
        expect(styles['spinner:spin']).toBeGreaterThan(styles['spinner:arc'] || 0);
        for (const style of ['bottlenose:arc', 'bottlenose:flip', 'bottlenose:side', 'spinner:spin']) {
            expect(styles[style], style).toBeGreaterThan(10);
        }
        // A hero is always a plain arc: the one the sun is behind.
        expect(life.leap(0, 0, { hero: true, d: 12.5 }).style).toBe('arc');
    });

    it('is in the air for its flight, comes back down to the water and breaks the surface twice', () => {
        const life = makeLife('High');
        const t0 = 10;
        const arc = life.leap(t0, 0, { d: 12, kind: 'bottlenose', style: 'arc' });
        const { flight } = arc;
        expect(flight).toBeGreaterThan(1);
        const landingY = arc.y + arc.vy * flight - 0.5 * GRAVITY * flight * flight;
        expect(landingY).toBeCloseTo(0, 9);
        expect(apex(arc).t).toBeLessThan(flight);

        const heard = [];
        const frames = [];
        const end = t0 + arc.life + 1;
        for (let n = 0; t0 - 3 + n * DT <= end; n++) {
            const time = t0 - 3 + n * DT;
            life.update(time, 0, (act, event, pose) => heard.push({
                act, type: event.type, time, x: pose.x, y: pose.y, z: pose.z,
            }));
            frames.push({ time, airborne: life.airborne, ...instance(life, 'bottlenose') });
        }
        // Before its run-up and after it is gone: not drawn; and no longer one of the board's acts.
        expect(frames[0].metres).toBe(0);
        expect(frames[frames.length - 1].metres).toBe(0);
        expect(life.acts).not.toContain(arc);
        // Airborne from the moment it breaks the surface to the moment it is back in.
        const inAir = frames.filter((frame) => frame.airborne > 0);
        expect(inAir.every((frame) => frame.airborne === 1)).toBe(true);
        expect(inAir[0].time).toBeGreaterThanOrEqual(t0 - 1e-9);
        expect(inAir[0].time).toBeLessThan(t0 + 2 * DT);
        expect(inAir[inAir.length - 1].time).toBeLessThanOrEqual(t0 + flight + 1e-9);
        expect(inAir.length * DT).toBeCloseTo(flight, 1);
        // In the air it is drawn, on its arc, with nothing of the sea over it.
        expect(inAir.every((frame) => frame.metres > 0 && frame.depth === 0)).toBe(true);
        const highest = inAir.reduce((top, frame) => Math.max(top, frame.y), -Infinity);
        expect(highest).toBeCloseTo(apex(arc).y, 2);
        // Under the water before and after, drawn with the water over it.
        const under = frames.filter((frame) => frame.metres > 0 && frame.airborne === 0);
        expect(under.length).toBeGreaterThan(30);
        expect(under.every((frame) => frame.depth >= 0)).toBe(true);
        expect(under.some((frame) => frame.depth > 0.3)).toBe(true);
        // Once where it breaks the surface, once as its nose goes back in. No more.
        expect(heard.map((h) => h.type)).toEqual(['breach', 'entry']);
        expect(heard.every((h) => h.act === arc)).toBe(true);
        expect(heard[0].time).toBeCloseTo(t0, 1);
        expect(heard[1].time).toBeCloseTo(t0 + arc.noseAt, 1);
        expect([heard[0].x, heard[0].y, heard[0].z].map((v) => +v.toFixed(6))).toEqual([arc.x, arc.y, arc.z].map((v) => +v.toFixed(6)));
        // It went back into the sea further out than it left.
        expect(heard[1].x).toBeLessThan(heard[0].x);
    });

    it('throws a hero across the sun: the top of its arc is on the line from the eye to the sun', () => {
        const life = makeLife('High');
        for (const open of [0, 0.5, 1]) {
            for (const d of [12, 13, 14, 15, 16]) {
                const arc = life.leap(0, open, { hero: true, d });
                const top = apex(arc);
                const rel = [top.x - EYE.x, top.y - EYE.y, top.z - EYE.z];
                const along = rel[0] * SUN.x + rel[1] * SUN.y + rel[2] * SUN.z;
                const off = Math.hypot(rel[0] - SUN.x * along, rel[1] - SUN.y * along, rel[2] - SUN.z * along);
                const where = `d ${d}, open ${open}`;
                expect(off, where).toBeLessThan(0.3);
                expect(along, where).toBeGreaterThan(0); // toward the sun, not away from it
                expect(arc.kind, where).toBe('bottlenose');
                // It still leaves the trough and comes down in the sea in front of the wave.
                expect(arc.y, where).toBe(0);
                expect(arc.vx, where).toBeLessThan(0);
                expect(arc.y + arc.vy * arc.flight - 0.5 * GRAVITY * arc.flight ** 2, where).toBeCloseTo(0, 9);
            }
        }
    });

    it('never writes a size for an animal that is not there, nor a heading or a back that is not a direction', () => {
        const life = makeLife('Extreme', { ambient: true });
        const wrong = [];
        // A pod sent one after another, the first across the sun, as a long chain sends it.
        for (let i = 0; i < life.count; i++) life.leap(5 + i * 0.6, 0.4, { hero: i === 0, d: i === 0 ? 12.5 : null });
        let shown = 0;
        // Ten minutes of the sea's own visits on top: every kind comes by.
        const seen = new Set();
        for (let n = 0; n * (DT * 6) < 600; n++) {
            const time = n * DT * 6;
            life.update(time, 0.4, null);
            for (const kind of KINDS) {
                const { data, slots } = life.fauna.kinds[kind];
                for (let i = 0; i < slots; i++) {
                    const row = Array.from(data.subarray(i * FAUNA_STRIDE, (i + 1) * FAUNA_STRIDE));
                    if (!row.every(Number.isFinite)) wrong.push(`${kind} ${i} at ${time}: ${row}`);
                    const at = instance(life, kind, i);
                    if (!(at.metres > 0)) continue;
                    shown += 1;
                    seen.add(kind);
                    if (!(Math.abs(at.heading - 1) < 1e-5)) wrong.push(`${kind} ${i} at ${time}: heading ${at.heading}`);
                    if (!(Math.abs(at.back - 1) < 1e-5)) wrong.push(`${kind} ${i} at ${time}: back ${at.back}`);
                    if (!(Math.abs(at.square) < 1e-5)) wrong.push(`${kind} ${i} at ${time}: back not square (${at.square})`);
                    if (i >= life.drawn[kind]) wrong.push(`${kind} ${i} at ${time}: drawn past the count`);
                }
            }
        }
        expect(wrong.slice(0, 10)).toEqual([]);
        expect(shown).toBeGreaterThan(1000);
        expect([...seen].sort()).toEqual([...KINDS].sort());
    });

    it('counts who is in the air, and tells the renderer when its rows change', () => {
        const life = makeLife('High');
        life.leap(1, 0);
        life.leap(1.5, 0);
        life.leap(40, 0);
        const { buffer } = life.fauna.kinds.bottlenose;
        const before = buffer.version;
        life.update(0, 0, null);
        expect(buffer.version).toBeGreaterThan(before);
        expect(life.airborne).toBe(0);
        life.update(1.2, 0, null);
        expect(life.airborne).toBe(1);
        life.update(2.5, 0, null);
        expect(life.airborne).toBe(2);
        life.update(41, 0, null);
        expect(life.airborne).toBe(1);
        // No listener for the splashes is no error.
        expect(() => life.update(100, 0)).not.toThrow();
        expect(life.airborne).toBe(0);
    });

    it('keeps no more leapers live than its pod, and lets the board call again once one is down', () => {
        const life = makeLife('Minimal');
        for (let i = 0; i < life.count; i++) {
            expect(life.canLeap()).toBe(true);
            life.leap(1 + i * 0.6, 0);
        }
        expect(life.live()).toBe(life.count);
        expect(life.canLeap()).toBe(false);
        // A whale, a turtle or a manta is not one of the pod.
        life.add(makeWhale({
            at: 1, mode: 'blow', x: -30, z: -120, hx: 1, hz: 0,
        }));
        expect(life.live()).toBe(life.count);
        // Once the first is back in the water, one more may go.
        const first = life.acts[0];
        life.update(first.t0 + first.flight + 0.01, 0, null);
        expect(life.canLeap()).toBe(true);
    });

    it('gives what the board called a place to be drawn before the sea\'s own visitors', () => {
        // Minimal draws one whale. The sea's own humpback is out at sea when a perfect clear calls one.
        const life = makeLife('Minimal', { ambient: true });
        expect(life.capacity.humpback).toBe(1);
        let clock = 0;
        const whaleOnScreen = () => {
            const kept = [];
            life.ambient.actsAt(clock, kept);
            return kept.some((act) => act.kind === 'humpback' && clock - act.t0 > 1 && clock - act.t0 < act.life - 1);
        };
        while (!whaleOnScreen() && clock < 4000) clock += 1;
        expect(whaleOnScreen()).toBe(true);
        life.update(clock, 0, null);
        expect(life.drawn.humpback).toBe(1);
        const ambientAt = instance(life, 'humpback');
        const called = life.add(makeWhale({
            at: clock - 2, mode: 'breach', x: -20, z: -55, hx: 0.92, hz: -0.39,
        }));
        life.update(clock + 0.5, 0, null);
        expect(life.drawn.humpback).toBe(1);
        // The one slot is the called whale's; the sea's own waits out of sight.
        const drawn = instance(life, 'humpback');
        const pose = actPose(called, clock + 0.5, 0);
        expect(drawn.x).toBeCloseTo(pose.x, 4);
        expect(drawn.z).toBeCloseTo(pose.z, 4);
        expect(Math.abs(drawn.z - ambientAt.z)).toBeGreaterThan(1);
    });

    it('starts over on reset: none of the board\'s animals left, and the same leaps in the same order', () => {
        const life = makeLife('High');
        const options = [{}, {}, { hero: true, d: 12.5 }];
        const snapshot = () => options.map((option, i) => leapShape(life.leap(i, i * 0.5, option)));
        const first = snapshot();
        life.update(1.5, 0, null);
        expect(life.airborne).toBeGreaterThan(0);
        life.reset();
        expect(life.acts).toEqual([]);
        expect(life.airborne).toBe(0);
        expect(snapshot()).toEqual(first);
        // The same seed leaps the same way; another seed is another sea.
        const twin = makeLife('High');
        expect([0, 1].map((i) => leapShape(twin.leap(i, i * 0.5)))).toEqual(first.slice(0, 2));
        const other = makeLife('High', { seed: 4 });
        expect(leapShape(other.leap(0, 0))).not.toEqual(first[0]);
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

    it('lets go of everything it made, and nothing of the pack every world shares', () => {
        const life = new WavesLife({
            tier: tierFor('Low'), U: uniforms(), sun: SUN, eye: EYE,
        });
        life.attach(PACK);
        const scene = new THREE.Scene();
        scene.add(life.mesh);
        const { kinds, materials } = life.fauna;
        const spies = [
            ...KINDS.map((kind) => vi.spyOn(kinds[kind].geometry, 'dispose')),
            vi.spyOn(materials.air, 'dispose'),
            vi.spyOn(materials.under, 'dispose'),
        ];
        const shared = KINDS.map((kind) => vi.spyOn(PACK.kinds[kind].geometry, 'dispose'));
        life.dispose();
        expect(scene.children).toHaveLength(0);
        for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
        for (const spy of shared) expect(spy).not.toHaveBeenCalled();
        expect(life.fauna).toBeNull();
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
        // Many times round: once every drop is in the air the cursor sweeps on past the drops it
        // looked at, taking the one nearest its end each time, and the ring never grows.
        pool.swirl(60, 0, { n: count * 3 + 11 });
        expect(Number.isInteger(pool.cursor) && pool.cursor >= 0 && pool.cursor < count).toBe(true);
        expect(thrown(pool)).toHaveLength(count);
        expect(pool.data).toBe(data);
        expect(pool.data).toHaveLength(size);
        expect(pool.count).toBe(count);
        expect(pool.data.every(Number.isFinite)).toBe(true);
    });

    it('throws new drops over spent ones, skipping a throw still hanging in the air', () => {
        const pool = makePool('Low');
        const { count } = pool;
        const block = count - 300;
        // A long, slow throw that hangs in the air (a held quad's), then a short crown: the pool is
        // full and its cursor is back at the start of the throw.
        pool.throwLip(10, 0, {
            n: block, delay: 0, flown: 0, life: [6, 6], speed: [0.2, 0.4],
        });
        pool.crown(10, 0, 0, -5, { n: 300, life: [0.5, 0.6] });
        expect(pool.cursor).toBe(0);
        const hanging = drops(pool).filter((drop) => drop.i < block && pool.remaining(drop.i, 11) > 0)
            .map((drop) => drop.i);
        expect(hanging.length).toBeGreaterThan(block * 0.9);
        // A second later the crown is spent: the next throw skips over the one hanging and takes
        // the crown's drops, touching at most a drop or two of the throw on its way past.
        const kept = Array.from(pool.data);
        pool.crown(11, 0, 0, -5, { n: 250, life: [1, 1] });
        const stride = pool.data.length / count;
        const touched = hanging.filter((i) => kept.slice(i * stride, (i + 1) * stride)
            .some((v, k) => v !== pool.data[i * stride + k]));
        expect(touched.length).toBeLessThanOrEqual(Math.ceil(block / 256));
        expect(drops(pool).filter((drop) => drop.birth >= 11)).toHaveLength(250);
        // Round robin would have thrown all 250 over the hanging throw.
        expect(touched.length).toBeLessThan(250 / 20);
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

    it('spreads the plume along the crest, one sheet to a stretch, the same for the same seed', () => {
        const { mist, rain } = build('Medium', 187);
        const rows = [];
        const all = seeds(mist);
        for (let i = 0; i < all.length; i += 4) rows.push(all.slice(i, i + 4));
        // Every sheet is the plume off the crest (the white water where the lip lands is its own
        // part, waves-whitewater.js): no sheet is marked as anything else.
        expect(new Set(rows.map((row) => row[3])).size).toBeGreaterThan(2);
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
