/**
 * Vesper Chrysalis — what the evening's new life sets up on the CPU: the stars that flash on cut
 * stone (glints), the moths round the chrysalis and the burst out of it (flutter), the shooting
 * stars (meteors), the cleared rows' streamers home to the chrysalis (blades), and the reeds.
 *
 * Nothing here is drawn. Every one of these parts places its quads in the vertex stage from a few
 * numbers the CPU writes (instance attributes, or slots in a uniform array): these tests pin those
 * numbers, the way a slot is chosen and given back, and that the same seed lays out the same life.
 * The slots live in uniform arrays the parts keep to themselves, so `three/tsl`'s uniformArray is
 * wrapped to note each array a part makes (the arrays are the very ones the shader reads).
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';

import {
    BLADE_SLOTS, CHRYSALIS, createVesperUniforms, planSpires, skyDirection,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-tsl.js';
import { CHIME_CLIMB, createGlints } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-glints.js';
import { BURST_LIFE, BURST_STAGGER, createFlutter } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-life.js';
import { METEOR_SLOTS, createMeteors } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-sky.js';
import { BLADE_FLIGHT, BLADE_LIFE, createBlades } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-fx.js';
import { buildChrysalisGeometry } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-relic.js';
import { buildSpiresGeometry, createReeds } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-shore.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-quality.js';
import { VesperWorld } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-world.js';

const made = vi.hoisted(() => []);
vi.mock('three/tsl', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        uniformArray: (values, type) => {
            made.push(values);
            return actual.uniformArray(values, type);
        },
    };
});

/** The shared uniforms, with a stand-in for the baked noise (nothing here is drawn). */
function uniforms() {
    const noise = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    return createVesperUniforms({ noise });
}

/** Run `create` and hand back what it made, with the uniform arrays it made on the way, in order. */
function withArrays(create) {
    const first = made.length;
    const part = create();
    return { part, arrays: made.slice(first) };
}

/** A part's attribute, as a plain array of its numbers. */
const numbersOf = (part, name) => Array.from(part.geometry.getAttribute(name).array);

/** An instanced attribute's rows as arrays. */
function rowsOf(attribute) {
    const rows = [];
    for (let i = 0; i < attribute.count; i++) {
        rows.push(Array.from({ length: attribute.itemSize }, (_, k) => attribute.array[i * attribute.itemSize + k]));
    }
    return rows;
}

describe('vesper chrysalis life: the glints', () => {
    it('stands a star on each facet it is given, the chrysalis\'s and the crystals\'', () => {
        const relic = buildChrysalisGeometry().userData.facets.slice(0, 40);
        const fixed = buildSpiresGeometry(planSpires(5)).userData.glints;
        const part = createGlints(uniforms(), { relic, fixed });
        const n = relic.length + fixed.length;
        // One instance a facet, all drawn.
        expect(part.count).toBe(n);
        expect(part.mesh.count).toBe(n);
        expect(part.mesh.isInstancedMesh).toBe(true);
        const at = rowsOf(part.geometry.getAttribute('aGlintAt'));
        const normal = rowsOf(part.geometry.getAttribute('aGlintN'));
        expect(at).toHaveLength(n);
        [...relic, ...fixed].forEach((g, i) => {
            const onRelic = i < relic.length;
            // Where it stands (in the chrysalis's own frame, or the world's), and which it rides
            // with: 0 = the chrysalis (it moves with its pose), 1 = the world.
            for (let k = 0; k < 3; k++) {
                expect(at[i][k]).toBeCloseTo(g.at[k], 4);
                expect(normal[i][k]).toBeCloseTo(g.normal[k], 6);
            }
            expect(at[i][3]).toBe(onRelic ? 0 : 1);
            expect(normal[i][3]).toBeCloseTo(g.seed, 6);
            expect(Math.hypot(normal[i][0], normal[i][1], normal[i][2])).toBeCloseTo(1, 5);
        });
        // A light, added over the scene: it never hides what is behind it.
        expect(part.material.isNodeMaterial).toBe(true);
        expect(part.material.transparent).toBe(true);
        expect(part.material.blending).toBe(THREE.AdditiveBlending);
        expect(part.material.depthWrite).toBe(false);
        // A chime climbs a crystal in a few seconds, not in an instant.
        expect(CHIME_CLIMB).toBeGreaterThan(0);
    });

    it('draws nothing with nothing to glint on, and the same stars for the same facets', () => {
        const none = createGlints(uniforms());
        expect(none.count).toBe(0);
        expect(none.mesh.count).toBe(0);
        const relic = buildChrysalisGeometry().userData.facets.slice(0, 12);
        const a = createGlints(uniforms(), { relic });
        const b = createGlints(uniforms(), { relic });
        expect(numbersOf(a, 'aGlintAt')).toEqual(numbersOf(b, 'aGlintAt'));
        expect(rowsOf(a.geometry.getAttribute('aGlintAt')).every((row) => row[3] === 0)).toBe(true);
    });
});

describe('vesper chrysalis life: the moths round the chrysalis', () => {
    it('keeps the company first and the burst after it, each with its own wings', () => {
        for (const name of QUALITY_NAMES) {
            const { flutter: ambient, flutterBurst: burst } = QUALITY[name];
            const part = createFlutter(uniforms(), { ambient, burst });
            expect(part.ambient, name).toBe(ambient);
            expect(part.burst, name).toBe(burst);
            expect(part.count, name).toBe(ambient + burst);
            expect(part.mesh.count, name).toBe(ambient + burst);
            const rows = rowsOf(part.geometry.getAttribute('aFlutter'));
            expect(rows.length, name).toBeGreaterThanOrEqual(ambient + burst);
            const company = rows.slice(0, ambient);
            const flight = rows.slice(ambient, ambient + burst);
            // (seed, second seed, 0 = company | 1 = burst, wingspan in metres)
            expect(company.every((row) => row[2] === 0), name).toBe(true);
            expect(flight.every((row) => row[2] === 1), name).toBe(true);
            rows.slice(0, ambient + burst).forEach((row) => {
                expect(row[0]).toBeGreaterThanOrEqual(0);
                expect(row[0]).toBeLessThan(1);
                expect(row[1]).toBeGreaterThanOrEqual(0);
                expect(row[1]).toBeLessThan(1);
                // Moths a metre or two across: seen at seventy metres, and smaller than the stone
                // they circle.
                expect(row[3]).toBeGreaterThan(0.5);
                expect(row[3]).toBeLessThan(CHRYSALIS.radius);
            });
            // The burst's are the smaller wings.
            const mean = (list) => list.reduce((sum, row) => sum + row[3], 0) / list.length;
            expect(mean(flight), name).toBeLessThan(mean(company));
        }
    });

    it('lays out the same flight from the same seed, and draws nothing when there is none', () => {
        const a = createFlutter(uniforms(), { ambient: 12, burst: 40 });
        const b = createFlutter(uniforms(), { ambient: 12, burst: 40 });
        expect(numbersOf(a, 'aFlutter')).toEqual(numbersOf(b, 'aFlutter'));
        // A tier with fewer keeps the same first ones: the company of a leaner tier is the start of a richer one's.
        const lean = createFlutter(uniforms(), { ambient: 6, burst: 0 });
        expect(numbersOf(lean, 'aFlutter')).toEqual(numbersOf(a, 'aFlutter').slice(0, 6 * 4));
        const none = createFlutter(uniforms(), { ambient: 0, burst: 0 });
        expect(none.count).toBe(0);
        expect(none.mesh.count).toBe(0);
        // Nonsense counts are no moths, not a broken buffer.
        const odd = createFlutter(uniforms(), { ambient: -3, burst: 2.6 });
        expect(odd.ambient).toBe(0);
        expect(odd.burst).toBe(3);
        expect(odd.count).toBe(3);
        // The burst leaves over a moment and lives for seconds after.
        expect(BURST_STAGGER).toBeGreaterThan(0);
        expect(BURST_LIFE).toBeGreaterThan(BURST_STAGGER * 2);
        // Wings of light seen from both sides, over the scene, writing no depth.
        expect(a.material.side).toBe(THREE.DoubleSide);
        expect(a.material.transparent).toBe(true);
        expect(a.material.depthWrite).toBe(false);
    });
});

describe('vesper chrysalis life: the shooting stars', () => {
    /** Every star the world's own showers ask for: the arguments it fires them with. */
    let asked;
    let world;

    beforeAll(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        world = new VesperWorld({ scene: new THREE.Scene(), quality: 'Minimal', capture: true }).build();
        asked = [];
        vi.spyOn(world.meteors, 'fire').mockImplementation((star) => {
            asked.push({ ...star });
            return 0;
        });
        for (let seed = 0; seed < 60; seed++) world.meteorShower(seed * 3, 6, seed);
    });

    afterAll(() => {
        world.dispose();
        vi.restoreAllMocks();
    });

    it('fills its slots in turn and comes round again', () => {
        const { part, arrays } = withArrays(() => createMeteors(uniforms()));
        const [start, run, tint] = arrays;
        expect(arrays).toHaveLength(3);
        for (const slots of arrays) expect(slots).toHaveLength(METEOR_SLOTS);
        expect(part.count).toBe(METEOR_SLOTS);
        expect(part.mesh.count).toBe(METEOR_SLOTS);
        expect(part.cursor).toBe(0);
        // At rest no slot is in the sky.
        expect(start.every((s) => s.w < 0)).toBe(true);
        expect(tint.every((s) => s.w === 0)).toBe(true);
        for (let i = 0; i < METEOR_SLOTS * 2 + 3; i++) {
            const slot = part.fire({
                azimuth: 0.2, elevation: 0.4, time: 10 + i, life: 0.8, rgb: [1, 0.9, 0.8], strength: 1.1,
            });
            expect(slot).toBe(i % METEOR_SLOTS);
            expect(part.cursor).toBe(i + 1);
            expect(start[slot].w).toBe(10 + i);
            expect(run[slot].w).toBe(0.8);
            expect(tint[slot].toArray()).toEqual([1, 0.9, 0.8, 1.1]);
        }
        // Reset: every slot back out of the sky, the next star in the first slot.
        part.reset();
        expect(part.cursor).toBe(0);
        expect(start.every((s) => s.w < 0)).toBe(true);
        expect(tint.every((s) => s.w === 0)).toBe(true);
        expect(part.fire({ azimuth: 0, elevation: 0.3, time: 1 })).toBe(0);
    });

    it('starts every star the world asks for above the horizon, and never runs one below it', () => {
        expect(asked.length).toBeGreaterThan(300);
        const { part, arrays } = withArrays(() => createMeteors(uniforms()));
        const [start, run] = arrays;
        const end = [0, 0, 0];
        for (const star of asked) {
            const slot = part.fire(star);
            const from = start[slot];
            const label = `azimuth ${star.azimuth.toFixed(2)}, elevation ${star.elevation.toFixed(2)}`;
            // A unit direction from the eye, up in the sky.
            expect(Math.hypot(from.x, from.y, from.z), label).toBeCloseTo(1, 9);
            expect(from.y, label).toBeGreaterThan(0);
            expect(from.z, label).toBeLessThan(0); // in front of the viewer
            expect(from.toArray().slice(0, 3)).toEqual(skyDirection(star.azimuth, star.elevation));
            // Where it burns out: start + run, a direction too, still above the horizon and lower than it began.
            end[0] = from.x + run[slot].x;
            end[1] = from.y + run[slot].y;
            end[2] = from.z + run[slot].z;
            expect(Math.hypot(...end), label).toBeCloseTo(1, 9);
            expect(end[1], label).toBeGreaterThan(0);
            expect(end[1], label).toBeLessThan(from.y);
            expect(run[slot].w, label).toBeGreaterThan(0); // a life
            expect(star.strength, label).toBeGreaterThan(0);
        }
        // Some fall to the left of the chrysalis and some to the right.
        expect(asked.some((star) => star.azimuth < 0)).toBe(true);
        expect(asked.some((star) => star.azimuth > 0)).toBe(true);
    });
});

describe('vesper chrysalis life: the blades home to the chrysalis', () => {
    /** A cleared row's two blades, out of the card's edges at height y. */
    const row = (y) => [
        { at: [-4, y, -20], via: [-17, y + 5, -34] },
        { at: [4, y, -20], via: [17, y + 5, -34] },
    ];

    it('sends each blade from its own slot, never two from one slot, and says when the last arrives', () => {
        const { part, arrays } = withArrays(() => createBlades(uniforms()));
        const [from, via, tints] = arrays;
        expect(part.count).toBe(BLADE_SLOTS * 2);
        expect(part.mesh.count).toBe(BLADE_SLOTS * 2);
        expect(arrays).toHaveLength(3);
        for (const slots of arrays) expect(slots).toHaveLength(part.count);
        const index = Array.from(part.geometry.getAttribute('aBlade').array);
        expect(index).toEqual(index.map((_, i) => i));
        // At rest every slot is spent.
        expect(from.every((s) => s.w < 0)).toBe(true);
        expect(via.every((s) => s.w === 0)).toBe(true);
        // Two rows: four blades, the second row's a moment after the first.
        const list = [...row(3), ...row(2)];
        const home = part.fire(list, [0.9, 0.5, 0.2], 10, 1.4, 1.2);
        const taken = [...part.taken];
        expect(taken).toHaveLength(4);
        expect(new Set(taken).size).toBe(4);
        taken.forEach((slot, k) => {
            expect(from[slot].toArray().slice(0, 3)).toEqual(list[k].at);
            expect(via[slot].toArray()).toEqual([...list[k].via, 1.4]);
            expect(tints[slot].toArray()).toEqual([0.9, 0.5, 0.2, 1.2]);
            expect(from[slot].w).toBeGreaterThanOrEqual(10);
        });
        expect(from[taken[2]].w).toBeGreaterThan(from[taken[0]].w);
        // It answers when the last of them reaches the chrysalis: the latest birth and a flight.
        expect(home).toBeCloseTo(Math.max(...taken.map((slot) => from[slot].w)) + 1.2, 12);
        // Its defaults are a whole blade and the blades' own flight.
        part.fire(row(5), [1, 1, 1], 20);
        expect(via[part.taken[0]].w).toBe(1);
        expect(tints[part.taken[0]].w).toBe(BLADE_FLIGHT);
        // Nothing to send: nothing taken, and nothing on its way.
        expect(part.fire([], [1, 1, 1], 30)).toBe(30);
        expect(part.taken).toEqual([]);
        // More blades than slots: each slot once, the rest left unsent.
        part.fire(Array.from({ length: part.count + 6 }, (_, i) => row(i)[i % 2]), [1, 1, 1], 40);
        expect(part.taken).toHaveLength(part.count);
        expect(new Set(part.taken).size).toBe(part.count);
        expect(BLADE_LIFE).toBeGreaterThan(BLADE_FLIGHT);
    });

    it('takes the slots with least left to give, never cutting short the blades still in flight', () => {
        const { part, arrays } = withArrays(() => createBlades(uniforms()));
        const [from] = arrays;
        const first = (part.fire([...row(3), ...row(2)], [1, 1, 1], 10), [...part.taken]);
        // A cascade's next wave a moment later: other slots, while spent ones are free.
        part.fire(row(1), [1, 1, 1], 10.2);
        const second = [...part.taken];
        expect(second.filter((slot) => first.includes(slot))).toEqual([]);
        // Every slot in flight: the next takes the ones that have the least left, the oldest.
        const rest = part.count - first.length - second.length;
        part.fire(Array.from({ length: rest }, (_, i) => row(i)[i % 2]), [1, 1, 1], 10.4);
        expect(from.every((s) => s.w >= 10)).toBe(true);
        part.fire(row(0), [1, 1, 1], 10.9);
        const oldest = first.slice(0, 2);
        expect([...part.taken].sort()).toEqual([...oldest].sort());
        // Reset spends them all: the next blades take the first slots again.
        part.reset();
        expect(from.every((s) => s.w < 0)).toBe(true);
        expect(arrays[1].every((s) => s.w === 0)).toBe(true);
        part.fire(row(2), [1, 1, 1], 50);
        expect(part.taken).toEqual([0, 1]);
    });
});

describe('vesper chrysalis life: the reeds', () => {
    it('plants reeds in both corners, reed-mace a few among the leaves, and none when a tier has none', () => {
        const part = createReeds(uniforms(), 150);
        expect(part.count).toBe(150);
        expect(part.mesh.count).toBe(150);
        const base = rowsOf(part.geometry.getAttribute('aReed')); // (x, z, height, seed)
        const kind = rowsOf(part.geometry.getAttribute('aReedKind')); // (0 leaf | 1 reed-mace, how far it bows)
        expect(base).toHaveLength(150);
        // Both corners, alike.
        const left = base.filter((b) => b[0] < 0).length;
        expect(left).toBe(75);
        expect(base.filter((b) => b[0] > 0)).toHaveLength(75);
        // Reed-mace are there, and a minority.
        const mace = kind.filter((k) => k[0] === 1).length;
        expect(mace).toBeGreaterThan(0);
        expect(mace).toBeLessThan(150 / 2);
        expect(kind.every((k) => k[0] === 0 || k[0] === 1)).toBe(true);
        // A reed-mace stands straight where a leaf bows over, and stands above the leaves round it.
        const bows = (which) => kind.filter((k) => k[0] === which).map((k) => k[1]);
        expect(Math.max(...bows(1))).toBeLessThan(Math.min(...bows(0)));
        const heights = (which) => base.filter((_, i) => kind[i][0] === which).map((b) => b[2]);
        const mean = (list) => list.reduce((sum, v) => sum + v, 0) / list.length;
        expect(mean(heights(1))).toBeGreaterThan(mean(heights(0)));
        base.forEach((b) => {
            expect(b[2]).toBeGreaterThan(0);
            expect(b[3]).toBeGreaterThanOrEqual(0);
            expect(b[3]).toBeLessThan(1);
        });
        // The same reeds every time.
        const again = createReeds(uniforms(), 150);
        expect(numbersOf(again, 'aReed')).toEqual(numbersOf(part, 'aReed'));
        // A tier without reeds draws nothing.
        const none = createReeds(uniforms(), 0);
        expect(none.count).toBe(0);
        expect(none.mesh.count).toBe(0);
    });
});
