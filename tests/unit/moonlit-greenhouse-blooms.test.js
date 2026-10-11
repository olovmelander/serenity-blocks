/**
 * Moonlit Greenhouse — the board's flowers: the night blooms' pool (add / release / lights / count /
 * reset, the capacity and an Infinity release), the closed-form opening and closing curves, the
 * parametric sheets the shaders shape (winding, counts per tier), the strip's analytic normal,
 * the Queen of the Night's pose, and that every part leaves nothing behind.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { MoonlitGreenhouseWorld } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-world.js';
import {
    BLOOM, BLOOM_PART, QUEEN, QUEEN_PART, bloomClosing, bloomDetail, bloomHeart, bloomOpenness, bloomPlace,
    bloomReach, buildBedBloomGeometry, buildQueenGeometry, buildWaterBloomGeometry, createBlooms, createQueen,
    queenCounts, queenPose, stripPoint,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-blooms.js';
import { EYE, FLOOR, TIMING } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-quality.js';
import { fovForAspect } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-composition.js';

const PINK = [1, 0.34, 0.6];
const GOLD = [1, 0.7, 0.34];

/** A world's uniforms and frame, and a stand-in for the world each frame. */
function makeContext(quality = 'Low') {
    const world = new MoonlitGreenhouseWorld({ scene: new THREE.Scene(), quality });
    return { tier: QUALITY[quality], U: world.U, world };
}

function frameAt(ctx, clock) {
    ctx.U.time.value = clock;
    return {
        clock, U: ctx.U, frame: ctx.world.frame, aspect: 16 / 9,
    };
}

const bed = (z, at, extra = {}) => ({
    x: -4.4, y: FLOOR.bed.soil, z, rgb: PINK, at, hard: false, onWater: false, seed: 0.3, ...extra,
});

/** Signed area of each triangle in the sheet's (s, c) parameter plane. */
function paramAreas(geometry) {
    const p = geometry.getAttribute('position');
    const idx = geometry.getIndex().array;
    const out = [];
    for (let i = 0; i < idx.length; i += 3) {
        const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
        const ax = p.getX(a);
        const ay = p.getY(a);
        out.push((p.getX(b) - ax) * (p.getY(c) - ay) - (p.getX(c) - ax) * (p.getY(b) - ay));
    }
    return out;
}

/** The distinct (part, index) pairs of a sheet, counted per part. */
function piecesPerPart(geometry) {
    const p = geometry.getAttribute('position');
    const part = geometry.getAttribute('aPart');
    const seen = new Map();
    for (let i = 0; i < p.count; i += 1) {
        const k = part.getX(i);
        if (!seen.has(k)) seen.set(k, new Set());
        seen.get(k).add(p.getZ(i));
    }
    return new Map([...seen].map(([k, set]) => [k, set.size]));
}

describe('moonlit greenhouse blooms — closed form', () => {
    it('opens over TIMING.bloomOpen from the landing, faster on a hard drop, and closes over bloomClose', () => {
        expect(bloomOpenness(-0.5)).toBe(0);
        expect(bloomOpenness(0)).toBe(0);
        let last = 0;
        for (let t = 0.05; t <= TIMING.bloomOpen; t += 0.05) {
            const o = bloomOpenness(t);
            expect(o).toBeGreaterThanOrEqual(last);
            last = o;
        }
        expect(bloomOpenness(TIMING.bloomOpen)).toBeCloseTo(1, 6);
        expect(bloomOpenness(TIMING.bloomOpen * 0.5, true)).toBeGreaterThan(bloomOpenness(TIMING.bloomOpen * 0.5));
        expect(bloomOpenness(TIMING.bloomOpen * BLOOM.hardPace, true)).toBeCloseTo(1, 6);
        expect(bloomClosing(-1)).toBe(0);
        expect(bloomClosing(TIMING.bloomClose * 0.5)).toBeCloseTo(0.5, 6);
        expect(bloomClosing(TIMING.bloomClose + 1)).toBe(1);
    });

    it('sizes a flower by its distance (≈3 % of the frame), larger on a hard drop', () => {
        const near = bloomReach(-4, FLOOR.bed.soil, -2);
        const far = bloomReach(-4, FLOOR.bed.soil, -14);
        expect(far).toBeGreaterThan(near);
        expect(bloomReach(-4, FLOOR.bed.soil, -2, true)).toBeCloseTo(near * BLOOM.hardSize, 6);
        // The open flower spans 2.5–4 % of a 16:9 frame's height at its distance.
        const d = Math.hypot(-4 - EYE.x, FLOOR.bed.soil - EYE.y, -8 - EYE.z);
        const frame = 2 * d * Math.tan((fovForAspect(16 / 9) * Math.PI) / 360);
        const span = (2 * bloomReach(-4, FLOOR.bed.soil, -8) * 0.9) / frame;
        expect(span).toBeGreaterThan(0.025);
        expect(span).toBeLessThan(0.04);
    });

    it('slides a deep landing along the eye\'s ray to the bed\'s front (the same place on screen)', () => {
        const p = bloomPlace(-6.2, -9, false);
        expect(Math.abs(p.x)).toBeCloseTo(BLOOM.bedFront, 6);
        // On the same line from the eye in plan.
        const a = Math.atan2(-6.2 - EYE.x, -9 - EYE.z);
        expect(Math.atan2(p.x - EYE.x, p.z - EYE.z)).toBeCloseTo(a, 6);
        const kept = bloomPlace(-3.8, -5, false);
        expect(kept.x).toBe(-3.8);
        expect(Math.abs(bloomPlace(-2.2, -4, true).x)).toBeCloseTo(BLOOM.canalOpen, 6);
    });

    it('puts a bed flower\'s heart up its stem, turned toward the eye; a lily\'s just over the water', () => {
        const k = bloomReach(-4, FLOOR.bed.soil, -4);
        const h = bloomHeart(-4, FLOOR.bed.soil, -4, k, false);
        expect(h.y).toBeGreaterThan(FLOOR.bed.soil + k * BLOOM.stem * 0.9);
        expect(h.z).toBeGreaterThan(-4); // bowed toward the eye
        const w = bloomHeart(-1, FLOOR.canal.water, -4, k, true);
        expect(w.y).toBeGreaterThan(FLOOR.canal.water);
        expect(w.y).toBeLessThan(FLOOR.canal.water + 0.2);
    });

    it('gives the strip an inner normal equal to cross(∂p/∂s, ∂p/∂c)', () => {
        const R = [Math.SQRT1_2, 0, Math.SQRT1_2];
        const A = [0, 1, 0];
        for (const [th0, th1, cup] of [[0.9, -0.2, 0.3], [1.4, 1.6, 0.5], [0.3, 0.3, 0.0], [1.2, 0.4, 0.4]]) {
            for (const s of [0.1, 0.5, 0.9]) {
                for (const c of [-0.6, 0, 0.7]) {
                    const e = 1e-4;
                    const f = (ss, cc) => stripPoint([0, 0, 0], R, A, th0, th1, 1, ss, cc, 0.2, cup).p;
                    const p0 = f(s, c);
                    const ds = f(s + e, c).map((v, i) => v - p0[i]);
                    const dc = f(s, c + e).map((v, i) => v - p0[i]);
                    const n = [
                        ds[1] * dc[2] - ds[2] * dc[1], ds[2] * dc[0] - ds[0] * dc[2], ds[0] * dc[1] - ds[1] * dc[0],
                    ];
                    const l = Math.hypot(...n);
                    const { n: analytic } = stripPoint([0, 0, 0], R, A, th0, th1, 1, s, c, 0.2, cup);
                    expect((n[0] * analytic[0] + n[1] * analytic[1] + n[2] * analytic[2]) / l).toBeGreaterThan(0.99);
                }
            }
        }
        // A petal flared out over its plane faces up (toward A), its inner side.
        expect(stripPoint([0, 0, 0], R, A, 0.3, 0.1, 1, 0.5, 0, 0.2, 0.3).n[1]).toBeGreaterThan(0.9);
    });
});

describe('moonlit greenhouse blooms — sheets', () => {
    it('lays every sheet counter-clockwise in (s, c), so it faces cross(∂p/∂s, ∂p/∂c)', () => {
        QUALITY_NAMES.forEach((name) => {
            const tier = QUALITY[name];
            for (const g of [buildBedBloomGeometry(tier), buildWaterBloomGeometry(tier), buildQueenGeometry(tier)]) {
                const areas = paramAreas(g);
                expect(areas.length).toBeGreaterThan(0);
                expect(areas.every((a) => a > 0)).toBe(true);
                expect(g.getAttribute('position').itemSize).toBe(3);
                expect(g.getAttribute('aPart').itemSize).toBe(2);
                g.dispose();
            }
        });
    });

    it('holds the tier\'s petals, two leaves and the sepals; the Queen her whorls, stamens and stigma', () => {
        QUALITY_NAMES.forEach((name) => {
            const tier = QUALITY[name];
            const d = bloomDetail(tier);
            const bedParts = piecesPerPart(buildBedBloomGeometry(tier));
            expect(bedParts.get(BLOOM_PART.petal)).toBe(tier.petals);
            expect(bedParts.get(BLOOM_PART.leaf)).toBe(2);
            expect(bedParts.get(BLOOM_PART.sepal)).toBe(d.sepals);
            expect(bedParts.get(BLOOM_PART.stem)).toBe(1);
            expect(bedParts.get(BLOOM_PART.stamen) ?? 0).toBe(d.stamens);
            const lily = piecesPerPart(buildWaterBloomGeometry(tier));
            expect(lily.get(BLOOM_PART.pad)).toBe(1);
            expect(lily.get(BLOOM_PART.outer)).toBe(tier.petals + 1);
            expect(lily.get(BLOOM_PART.inner)).toBe(tier.petals + 1);
            const n = queenCounts(tier);
            expect(n.inner + n.outer).toBe(tier.queenPetals);
            const queen = piecesPerPart(buildQueenGeometry(tier));
            expect(queen.get(QUEEN_PART.outer)).toBe(n.outer);
            expect(queen.get(QUEEN_PART.inner)).toBe(n.inner);
            expect(queen.get(QUEEN_PART.second)).toBe(n.second);
            expect(queen.get(QUEEN_PART.stamen)).toBe(n.stamens);
            expect(queen.get(QUEEN_PART.stigma)).toBe(n.stigma);
            expect(queen.get(QUEEN_PART.heart)).toBe(1);
        });
        // Finer tiers never draw a flower with fewer vertices.
        const verts = QUALITY_NAMES.map((name) => buildBedBloomGeometry(QUALITY[name]).getAttribute('position').count);
        for (let i = 1; i < verts.length; i += 1) expect(verts[i]).toBeGreaterThanOrEqual(verts[i - 1]);
    });
});

describe('moonlit greenhouse blooms — the pool', () => {
    it('opens a bloom at its time: no light while the seed flies, then rising light at its heart', () => {
        const ctx = makeContext();
        const blooms = createBlooms(ctx);
        const record = blooms.add(bed(-4, 1.0));
        expect(record).toBeTruthy();
        expect(blooms.count()).toBe(1);
        expect(blooms.lights(0.9)).toHaveLength(0);
        const early = blooms.lights(1.0 + TIMING.bloomOpen * 0.3)[0].strength;
        const open = blooms.lights(1.0 + TIMING.bloomOpen + 0.1);
        expect(open).toHaveLength(1);
        expect(open[0].strength).toBeGreaterThan(early);
        expect(open[0].y).toBeGreaterThan(FLOOR.bed.soil + 0.1);
        expect(open[0].rgb).toEqual(PINK);
        expect(open[0].radius).toBeGreaterThan(1);
        // A hard drop's flower is larger, and lights more.
        const hard = blooms.add(bed(-6, 1.0, { hard: true, rgb: GOLD }));
        expect(hard.k).toBeGreaterThan(record.k);
        blooms.dispose();
    });

    it('keeps at most tier.blooms open: the oldest closes as a new one opens', () => {
        const ctx = makeContext();
        const blooms = createBlooms(ctx);
        const cap = ctx.tier.blooms;
        const first = [];
        for (let i = 0; i < cap; i += 1) first.push(blooms.add(bed(-1 - i * 0.5, 1 + i * 0.1)));
        expect(blooms.count()).toBe(cap);
        const late = blooms.add(bed(-30, 20));
        expect(late).toBeTruthy();
        expect(blooms.count()).toBe(cap);
        expect(first[0].closeAt).toBe(20);
        expect(first[1].closeAt).toBeGreaterThan(1e5);
        // A whole second round of blooms still finds slots (the closed ones are reused).
        for (let i = 0; i < cap * 2; i += 1) {
            const at = 30 + i * (TIMING.bloomClose + 0.5);
            blooms.update(frameAt(ctx, at - 0.9));
            expect(blooms.add(bed(-2 - (i % 9), at))).toBeTruthy();
        }
        expect(blooms.count()).toBe(cap);
        blooms.dispose();
    });

    it('releases the oldest open blooms (Infinity: all), closing them over bloomClose, and frees them', () => {
        const ctx = makeContext();
        const blooms = createBlooms(ctx);
        for (let i = 0; i < 6; i += 1) blooms.add(bed(-2 - i, 1 + i * 0.2, { rgb: i === 0 ? GOLD : PINK }));
        const out = [];
        expect(blooms.release(2, 5, out)).toBe(out);
        expect(out).toHaveLength(2);
        expect(out[0].rgb).toEqual(GOLD);
        expect(out[0]).toMatchObject({ at: 5 });
        ['x', 'y', 'z'].forEach((key) => expect(Number.isFinite(out[0][key])).toBe(true));
        expect(out[0].y).toBeGreaterThan(FLOOR.bed.soil);
        expect(blooms.count()).toBe(4);
        // Closing: their light falls while the others stay lit.
        const lit = (t) => blooms.lights(t).length;
        expect(lit(4.9)).toBe(6);
        const strength = (t) => blooms.lights(t).reduce((sum, l) => sum + l.strength, 0);
        expect(strength(5 + TIMING.bloomClose * 0.6)).toBeLessThan(strength(4.9));
        blooms.update(frameAt(ctx, 5 + TIMING.bloomClose + 0.1));
        expect(lit(5 + TIMING.bloomClose + 0.1)).toBe(4);
        // Four lines release every bloom.
        const all = blooms.release(Infinity, 9, []);
        expect(all).toHaveLength(4);
        expect(blooms.count()).toBe(0);
        expect(blooms.release(3, 10, [])).toHaveLength(0);
        blooms.dispose();
    });

    it('resets to nothing open and nothing lit, and ignores a bloom with no place', () => {
        const ctx = makeContext();
        const blooms = createBlooms(ctx);
        for (let i = 0; i < 4; i += 1) blooms.add(bed(-3 - i, 1));
        blooms.reset();
        expect(blooms.count()).toBe(0);
        expect(blooms.lights(10)).toHaveLength(0);
        expect(blooms.add({ x: Number.NaN, z: 0, at: 1 })).toBeNull();
        expect(blooms.add(null)).toBeNull();
        blooms.dispose();
    });

    it('adds the Queen of the Night\'s light while she is open', () => {
        const ctx = makeContext();
        const blooms = createBlooms(ctx);
        blooms.update(frameAt(ctx, 1));
        expect(blooms.lights(1)).toHaveLength(0);
        ctx.U.queen.value.set(1, 1, 0, 0);
        const lights = blooms.lights(1);
        expect(lights).toHaveLength(1);
        expect(lights[0].z).toBeLessThan(-5);
        expect(lights[0].radius).toBeGreaterThan(2);
        blooms.dispose();
    });
});

describe('moonlit greenhouse queen of the night', () => {
    it('stands on the resting central ray facing the eye, 1.5× the card\'s half-height on a wide screen', () => {
        const wide = queenPose({ pitch: EYE.pitch, tall: 0 }, 16 / 9);
        const toCentre = wide.centre.map((v, i) => v - [EYE.x, EYE.y, EYE.z][i]);
        const d = Math.hypot(...toCentre);
        expect(d).toBeCloseTo(QUEEN.distance, 1);
        expect(toCentre[1] / d).toBeCloseTo(Math.sin((EYE.pitch * Math.PI) / 180), 2);
        expect(-toCentre.reduce((s, v, i) => s + v * wide.axis[i], 0) / d).toBeGreaterThan(0.95);
        const half = Math.tan((fovForAspect(16 / 9) * Math.PI) / 360) * QUEEN.distance;
        expect(wide.radius / half).toBeCloseTo(QUEEN.reachWide, 6);
        // The frame is right-handed: right × up = axis.
        const [r, u, a] = [wide.right, wide.up, wide.axis];
        const cross = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]];
        cross.forEach((v, i) => expect(v).toBeCloseTo(a[i], 6));
        // An upright phone lifts her with the lens and keeps the card framed.
        const tall = queenPose({ pitch: EYE.pitch + 6, tall: 1 }, 430 / 932);
        expect(tall.centre[1]).toBeGreaterThan(wide.centre[1]);
        expect(tall.radius).toBeGreaterThan(wide.radius);
    });

    it('builds, follows the frame, and leaves nothing behind', () => {
        const ctx = makeContext('Minimal');
        const queen = createQueen(ctx);
        const parent = new THREE.Group();
        parent.add(queen.mesh);
        queen.update(frameAt(ctx, 3));
        let disposed = 0;
        queen.mesh.traverse((o) => {
            if (o.isMesh) {
                expect(o.frustumCulled).toBe(false);
                o.geometry.addEventListener('dispose', () => { disposed += 1; });
                o.material.addEventListener('dispose', () => { disposed += 1; });
            }
        });
        queen.dispose();
        expect(parent.children).toHaveLength(0);
        expect(disposed).toBe(4);
    });
});

describe('moonlit greenhouse blooms — in the world', () => {
    it('is built by the world at every tier with its meshes always drawn, and disposes cleanly', () => {
        QUALITY_NAMES.forEach((quality) => {
            const scene = new THREE.Scene();
            const world = new MoonlitGreenhouseWorld({ scene, quality }).build();
            const { blooms } = world.parts;
            expect(blooms.capacity).toBe(QUALITY[quality].blooms);
            expect(blooms.slots).toBeGreaterThan(blooms.capacity);
            const meshes = [];
            blooms.mesh.traverse((o) => { if (o.isMesh) meshes.push(o); });
            expect(meshes).toHaveLength(3);
            meshes.forEach((m) => {
                expect(m.isInstancedMesh).toBe(true);
                expect(m.count).toBe(blooms.slots);
                expect(m.frustumCulled).toBe(false);
                // position + aPart + the two interleaved buffers: well inside WebGPU's eight.
                const buffers = new Set(Object.values(m.geometry.attributes).map((a) => a.data || a));
                expect(buffers.size).toBeLessThanOrEqual(4);
            });
            let disposed = 0;
            meshes.forEach((m) => m.geometry.addEventListener('dispose', () => { disposed += 1; }));
            world.dispose();
            expect(disposed).toBe(3);
            expect(scene.children).toHaveLength(0);
        });
    }, 60000);
});
