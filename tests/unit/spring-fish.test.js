/**
 * Spring — fish in the river (spring-fish.js): salmon leaping at the fall and up the ledges, trout
 * jumping in the calmer runs. The Blender-made hulls (scripts/blender/spring_fish.py ->
 * spring-fish-hulls.js) are what they claim: one fish long, each kind's build, closed bodies wound
 * outward and mirror-symmetric, fins and eyes in place. The leaps by the clock are a pure function
 * of the time, every leap
 * leaves and falls back into the river where the lens sees it beside the board, the material
 * and the rings of foam where they break the water build clean to WGSL and GLSL, nothing is uploaded
 * while no fish is in the air, the heat of play brings the salmon run, and the world splashes each
 * leap.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { DEG } from '../../src/themes/spring/spring-core.js';
import { createUniforms } from '../../src/themes/spring/spring-tsl.js';
import { QUALITY } from '../../src/themes/spring/spring-quality.js';
import {
    EYE, RIG, S_LIP, S_POOL, bearingOf, courseAt, levelAt,
} from '../../src/themes/spring/spring-plan.js';
import {
    FISH, FISH_STRIDE, Fish, GRAVITY, HULL_NAMES, LANES, LANE_INDEX, LONGEST, REGION, RING, RING_STRIDE,
    decodeFishHull, firstLeapAfter, fishGeometry, leapAt, leapPose,
} from '../../src/themes/spring/spring-fish.js';
import { SPRING_FISH_HULLS } from '../../src/themes/spring/spring-fish-hulls.js';
import {
    HEAT, REST_RIG, SpringWorld, fovForAspect, valleyGround,
} from '../../src/themes/spring/spring-world.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

/**
 * The landscape lens's half-width (deg), less a little so no fish leaps half out of the frame, and
 * the board card's (it hides the middle of the frame).
 */
const HALF = Math.atan(Math.tan((RIG.landscape.fov * DEG) / 2) * (16 / 9)) / DEG - 1.5;
const CARD = 10;

describe('spring fish: the body', () => {
    /** A hull's vertices as {x, y, z, s, d, flex, region}. */
    const pointsOf = (h) => Array.from({ length: h.vertexCount }, (_, i) => ({
        x: h.positions[i * 3],
        y: h.positions[i * 3 + 1],
        z: h.positions[i * 3 + 2],
        s: h.parts[i * 4],
        d: h.parts[i * 4 + 1],
        flex: h.parts[i * 4 + 2],
        region: h.parts[i * 4 + 3] - h.hull * 4,
    }));
    /** The body's depth (top to belly) through the band z0 … z1. */
    const depthOver = (points, z0, z1) => {
        const band = points.filter((p) => p.region === REGION.body && p.z >= z0 && p.z <= z1);
        return Math.max(...band.map((p) => p.y)) - Math.min(...band.map((p) => p.y));
    };

    it('has the arrays it claims, triangles matched to its size in the frame', () => {
        expect(SPRING_FISH_HULLS.noseZ).toBe(0.5);
        expect(SPRING_FISH_HULLS.tailZ).toBe(-0.5);
        HULL_NAMES.forEach((name, kind) => {
            const h = decodeFishHull(name);
            expect(h.hull).toBe(kind);
            expect(h.positions).toHaveLength(h.vertexCount * 3);
            expect(h.normals).toHaveLength(h.vertexCount * 3);
            expect(h.parts).toHaveLength(h.vertexCount * 4);
            expect(h.index).toHaveLength(h.triangleCount * 3);
            expect(Math.max(...h.index)).toBeLessThan(h.vertexCount);
            // Enough for the outline at 40 px and through a long lens; more would not show.
            expect(h.bodyTriangleCount).toBeGreaterThanOrEqual(240);
            expect(h.triangleCount).toBeLessThan(500);
        });
        expect(FISH.salmon.id).toBe(HULL_NAMES.indexOf('salmon'));
        expect(FISH.trout.id).toBe(HULL_NAMES.indexOf('trout'));
    });

    it('is one fish long, nose forward, a salmon slim with a slender wrist and a trout deep and thick-set', () => {
        const [salmon, trout] = HULL_NAMES.map((name) => pointsOf(decodeFishHull(name)));
        for (const points of [salmon, trout]) {
            expect(Math.max(...points.map((p) => p.z))).toBeCloseTo(0.5, 3);
            expect(Math.min(...points.map((p) => p.z))).toBeCloseTo(-0.5, 2);
            // The nose is the body's.
            const nose = points.reduce((a, b) => (b.z > a.z ? b : a));
            expect(nose.region).toBe(REGION.body);
        }
        const deep = (points) => depthOver(points, -0.1, 0.25);
        const wrist = (points) => depthOver(points, -0.33, -0.3);
        // A salmon about a fifth as deep as it is long, a trout near a quarter.
        expect(deep(salmon)).toBeGreaterThan(0.19);
        expect(deep(salmon)).toBeLessThan(0.23);
        expect(deep(trout)).toBeGreaterThan(0.22);
        expect(deep(trout)).toBeLessThan(0.26);
        expect(wrist(trout)).toBeGreaterThan(wrist(salmon) * 1.25);
        expect(wrist(salmon) / deep(salmon)).toBeLessThan(0.4);
        // Half as broad as deep, or a little more.
        const broad = (points) => 2 * Math.max(
            ...points.filter((p) => p.region === REGION.body).map((p) => Math.abs(p.x)),
        );
        expect(broad(salmon) / deep(salmon)).toBeGreaterThan(0.45);
        expect(broad(salmon) / deep(salmon)).toBeLessThan(0.7);
        expect(broad(trout)).toBeGreaterThan(broad(salmon));
        // The salmon's tail forked, the trout's square-cut: how far the fork reaches in from the tips.
        const fork = (points) => {
            const tail = points.filter((p) => p.region === REGION.fin && p.z < -0.42);
            const notch = tail.filter((p) => Math.abs(p.y) < 1e-3).reduce((a, b) => (b.z < a.z ? b : a));
            return notch.z - Math.min(...tail.map((p) => p.z));
        };
        expect(fork(salmon)).toBeGreaterThan(0.03);
        expect(fork(trout)).toBeLessThan(0.015);
    });

    it('has closed bodies, wound outward, mirror-symmetric', () => {
        for (const name of HULL_NAMES) {
            const h = decodeFishHull(name);
            const edges = new Map();
            let volume = 0;
            for (let t = 0; t < h.bodyTriangleCount; t++) {
                const [a, b, c] = [h.index[t * 3], h.index[t * 3 + 1], h.index[t * 3 + 2]];
                for (const [p, q] of [[a, b], [b, c], [c, a]]) {
                    const key = `${Math.min(p, q)},${Math.max(p, q)}`;
                    edges.set(key, (edges.get(key) || 0) + 1);
                }
                const v = (i) => new THREE.Vector3(h.positions[i * 3], h.positions[i * 3 + 1], h.positions[i * 3 + 2]);
                volume += v(a).dot(v(b).cross(v(c))) / 6;
            }
            // Every edge shared by two triangles: no holes, no flaps.
            expect([...edges.values()].every((n) => n === 2)).toBe(true);
            expect(volume).toBeGreaterThan(0);
            const body = pointsOf(h).filter((p) => p.region === REGION.body);
            for (const p of body) {
                const twin = body.some((q) => Math.abs(q.x + p.x) < 1e-4 && Math.abs(q.y - p.y) < 1e-4
                    && Math.abs(q.z - p.z) < 1e-4);
                expect(twin).toBe(true);
            }
        }
    });

    it('bakes unit normals and every part in range', () => {
        for (const name of HULL_NAMES) {
            const h = decodeFishHull(name);
            for (let i = 0; i < h.vertexCount; i++) {
                expect(Math.hypot(h.normals[i * 3], h.normals[i * 3 + 1], h.normals[i * 3 + 2])).toBeCloseTo(1, 3);
            }
            const points = pointsOf(h);
            for (const p of points) {
                for (const k of ['s', 'd', 'flex']) {
                    expect(p[k]).toBeGreaterThanOrEqual(0);
                    expect(p[k]).toBeLessThanOrEqual(1);
                }
                expect(Object.values(REGION)).toContain(p.region);
                // How far along is from the nose to the tail's tips.
                expect(p.s).toBeCloseTo(Math.min(1, Math.max(0, 0.5 - p.z)), 3);
            }
            // The body's back is its top, its belly its bottom.
            const body = points.filter((p) => p.region === REGION.body && p.z > -0.2 && p.z < 0.3);
            const top = body.reduce((a, b) => (b.y > a.y ? b : a));
            const bottom = body.reduce((a, b) => (b.y < a.y ? b : a));
            expect(top.d).toBeGreaterThan(0.95);
            expect(bottom.d).toBeLessThan(0.05);
            expect(points.filter((p) => p.region === REGION.body).every((p) => p.flex === 0)).toBe(true);
        }
    });

    it('stands its fins where a salmonid\'s are, roots fixed and edges free, and an eye each side', () => {
        for (const name of HULL_NAMES) {
            const points = pointsOf(decodeFishHull(name));
            const fins = points.filter((p) => p.region === REGION.fin || p.region === REGION.paleFin);
            expect(fins.some((p) => p.flex === 0)).toBe(true);
            expect(fins.some((p) => p.flex === 1)).toBe(true);
            // On the back: the dorsal over the middle and the small adipose behind it.
            const onBack = points.filter((p) => p.region === REGION.fin && p.x === 0 && p.y > 0.06 && p.z > -0.36);
            expect(onBack.some((p) => p.z > 0.05 && p.z < 0.15)).toBe(true);
            expect(onBack.some((p) => p.z < -0.2 && p.z > -0.3)).toBe(true);
            expect(onBack.some((p) => p.z < -0.05 && p.z > -0.2)).toBe(false);
            // Pale fins under it: the anal on the midline, the paired fins either side.
            const pale = points.filter((p) => p.region === REGION.paleFin);
            expect(pale.some((p) => p.x === 0 && p.y < -0.05 && p.z < -0.15)).toBe(true);
            expect(pale.some((p) => p.x > 0.02)).toBe(true);
            expect(pale.some((p) => p.x < -0.02)).toBe(true);
            // The eyes, small discs on the head, one each side.
            const eyes = points.filter((p) => p.region === REGION.eye);
            expect(eyes.length).toBeGreaterThanOrEqual(12);
            expect(eyes.every((p) => p.z > 0.42 && p.y > 0)).toBe(true);
            expect(eyes.some((p) => p.x > 0.01) && eyes.some((p) => p.x < -0.01)).toBe(true);
        }
    });

    it('merges both hulls into one geometry with their indices offset', () => {
        const [salmon, trout] = HULL_NAMES.map((name) => decodeFishHull(name));
        const geometry = fishGeometry();
        expect(geometry.getAttribute('position').count).toBe(salmon.vertexCount + trout.vertexCount);
        expect(geometry.index.count).toBe((salmon.triangleCount + trout.triangleCount) * 3);
        expect(geometry.index.array[salmon.triangleCount * 3]).toBe(trout.index[0] + salmon.vertexCount);
        const part = geometry.getAttribute('aFishPart');
        expect(part.getW(0)).toBeLessThan(4);
        expect(part.getW(salmon.vertexCount)).toBeGreaterThanOrEqual(4);
        geometry.dispose();
    });

    it('draws a salmon longer than a trout, and both larger than life, within reason', () => {
        expect(FISH.salmon.length[0]).toBeGreaterThan(FISH.trout.length[1]);
        for (const kind of Object.values(FISH)) {
            expect(kind.drawn).toBeGreaterThanOrEqual(1);
            expect(kind.drawn).toBeLessThanOrEqual(1.7);
        }
        // Drawn, the largest salmon is still under two metres; the largest trout under a salmon's least.
        expect(FISH.salmon.length[1] * FISH.salmon.drawn).toBeLessThan(2);
        expect(FISH.trout.length[1] * FISH.trout.drawn).toBeLessThan(FISH.salmon.length[0] * FISH.salmon.drawn);
    });

    it.each(BACKENDS)('builds the fish and their rings to %s', (name, Builder) => {
        const fish = new Fish(createUniforms());
        for (const mesh of fish.meshes) {
            const built = build(Builder, mesh);
            expect(built.thrown, String(built.thrown?.stack || built.thrown)).toBeUndefined();
            expect(built.heard).toEqual([]);
            expect(`${built.vertex}${built.fragment}`).not.toMatch(/NaN|\[object Object\]/);
            if (name === 'WGSL') expect(unassignedReads(built.fragment)).toEqual([]);
        }
        fish.dispose();
    });

    it('adds the rings as light on the water, after the fish', () => {
        const fish = new Fish(createUniforms());
        const { material } = fish.rings;
        expect(material.blending).toBe(THREE.AdditiveBlending);
        expect(material.premultipliedAlpha).toBe(true);
        expect(material.depthWrite).toBe(false);
        expect(fish.rings.renderOrder).toBeGreaterThan(fish.mesh.renderOrder);
        expect(fish.meshes).toEqual([fish.mesh, fish.rings]);
        fish.dispose();
    });

    it('reads its instances from one interleaved buffer (the eight-buffer limit)', () => {
        const fish = new Fish(createUniforms(), { count: 5 });
        const buffers = new Set();
        for (const attr of Object.values(fish.geometry.attributes)) {
            buffers.add(attr.isInterleavedBufferAttribute ? attr.data : attr);
        }
        expect(buffers.size).toBeLessThanOrEqual(4);
        expect(fish.data).toHaveLength(5 * FISH_STRIDE);
        expect(fish.geometry.instanceCount).toBe(5);
        fish.dispose();
    });
});

describe('spring fish: the leaps by the clock', () => {
    it('is a pure function of the lane and the leap number', () => {
        for (let lane = 0; lane < LANES.length; lane++) {
            const a = leapAt(lane, 12);
            const b = leapAt(lane, 12);
            expect(b.at).toBe(a.at);
            expect(b.s0).toBe(a.s0);
            expect(b.n0).toBe(a.n0);
            expect(b.seed).toBe(a.seed);
            // Each in its turn, after the last one is back in the water.
            for (let k = 0; k < 60; k++) {
                const leap = leapAt(lane, k);
                expect(leap.at).toBeGreaterThan(0);
                expect(leapAt(lane, k + 1).at).toBeGreaterThan(leap.at + leap.T);
            }
        }
    });

    it('flies each leap at real gravity, nose first out of the water and back in', () => {
        const pose = {};
        for (let lane = 0; lane < LANES.length; lane++) {
            for (let k = 0; k < 40; k++) {
                const leap = leapAt(lane, k);
                const { height, speed } = LANES[lane];
                expect(leap.height).toBeGreaterThanOrEqual(height[0]);
                expect(leap.height).toBeLessThanOrEqual(height[1]);
                expect(leap.speed).toBeGreaterThanOrEqual(speed[0]);
                expect(leap.T).toBeCloseTo(Math.sqrt((8 * leap.height) / GRAVITY), 9);
                expect(leap.T).toBeLessThanOrEqual(LONGEST + 1e-9);
                // It leaves and falls back with its middle under the surface, its nose just out.
                for (const [age, level] of [[0, leap.level0], [leap.T, leap.level1]]) {
                    leapPose(leap, age, 0, pose);
                    expect(pose.y).toBeLessThan(level);
                    const noseY = pose.y + pose.fy * 0.5 * leap.length * (age === 0 ? 1 : -1);
                    expect(Math.abs(noseY - level)).toBeLessThan(0.1);
                }
                // Nose up leaving, down falling back; its middle `height` over the water at the top.
                expect(leapPose(leap, 0, 0, pose).fy).toBeGreaterThan(0.5);
                expect(leapPose(leap, leap.T, 0, pose).fy).toBeLessThan(-0.5);
                const top = leapPose(leap, leap.T / 2, 0, pose).y + leap.sink;
                expect(top - (leap.level0 + leap.level1) / 2).toBeCloseTo(leap.height, 6);
                // Its heading and its back stand square to each other.
                expect(Math.hypot(pose.fx, pose.fy, pose.fz)).toBeCloseTo(1, 6);
                expect(Math.hypot(pose.ux, pose.uy, pose.uz)).toBeCloseTo(1, 6);
                expect(pose.fx * pose.ux + pose.fy * pose.uy + pose.fz * pose.uz).toBeCloseTo(0, 6);
            }
        }
    });

    it('leaps in the river where the lens sees it, beside the board', () => {
        const c = {};
        for (let lane = 0; lane < LANES.length; lane++) {
            for (let k = 0; k < 120; k++) {
                const leap = leapAt(lane, k);
                for (const [s, n] of [[leap.s0, leap.n0], [leap.s1, leap.n1]]) {
                    courseAt(s, c);
                    // In the water, below the fall's lip.
                    expect(s).toBeGreaterThan(S_LIP);
                    expect(Math.abs(n)).toBeLessThan(c.halfWidth * 0.8);
                    const bearing = bearingOf(c.x - c.tz * n, c.z + c.tx * n);
                    expect(Math.abs(bearing)).toBeGreaterThan(CARD);
                    expect(Math.abs(bearing)).toBeLessThan(HALF);
                }
            }
        }
        // Salmon at the fall leap toward it from its foot, and never in behind the falling water.
        for (let k = 0; k < 60; k++) {
            const leap = leapAt(LANE_INDEX.fall, k);
            expect(leap.kind).toBe(FISH.salmon.id);
            expect(leap.s1).toBeLessThan(leap.s0);
            expect(leap.s1).toBeGreaterThan(S_POOL - 0.5);
            expect(levelAt(leap.s0)).toBe(levelAt(S_POOL));
        }
        // Salmon up the ledges leap upstream, up onto higher water.
        for (let k = 0; k < 60; k++) {
            const leap = leapAt(LANE_INDEX.ledges, k);
            expect(leap.s1).toBeLessThan(leap.s0);
            expect(leap.level1).toBeGreaterThanOrEqual(leap.level0);
        }
        expect(leapAt(LANE_INDEX.runs, 3).kind).toBe(FISH.trout.id);
    });

    it('finds the first leap still in the air after a seek', () => {
        for (let lane = 0; lane < LANES.length; lane++) {
            for (const time of [0, 33.3, 400, 5000]) {
                const k = firstLeapAfter(lane, time);
                const leap = leapAt(lane, k);
                expect(leap.at + leap.T).toBeGreaterThan(time);
                if (k > 0) {
                    const before = leapAt(lane, k - 1);
                    expect(before.at + before.T).toBeLessThanOrEqual(time);
                }
            }
        }
    });
});

describe('spring fish: in the air', () => {
    /** A moment `share` through lane's k-th leap. */
    const during = (lane, k, share = 0.5) => {
        const leap = leapAt(lane, k);
        return leap.at + leap.T * share;
    };
    /** Whether any lane has a fish in the air at t (by the clock). */
    const flyingAt = (t) => LANES.some((_, lane) => leapAt(lane, firstLeapAfter(lane, t)).at <= t);
    /** The fish's rows at i. */
    const rowsOf = (data, count, stride) => Array.from(
        { length: count },
        (_, i) => data.subarray(i * stride, (i + 1) * stride),
    );

    it('draws the fish in the air where its leap has carried it', () => {
        const leaps = [];
        const fish = new Fish(createUniforms(), { count: 6, onLeap: (leap) => leaps.push(leap) });
        const t = during(LANE_INDEX.fall, 3);
        fish.reset(t - 0.05);
        fish.update(t - 0.05);
        fish.update(t);
        expect(fish.airborne).toBeGreaterThanOrEqual(1);
        // Its splash was called for once, as it left the water (caught mid-flight by the seek).
        expect(leaps.filter((leap) => leap.lane === LANE_INDEX.fall && leap.k === 3)).toHaveLength(1);
        const leap = leapAt(LANE_INDEX.fall, 3);
        const row = rowsOf(fish.data, fish.airborne, FISH_STRIDE)
            .find((r) => r[11] === FISH.salmon.id && Math.abs(r[7] - leap.length) < 1e-6);
        expect(row).toBeTruthy();
        const pose = leapPose(leap, t - leap.at, 0, {});
        expect(row[0]).toBeCloseTo(pose.x, 4);
        expect(row[1]).toBeCloseTo(pose.y, 4);
        expect(row[2]).toBeCloseTo(pose.z, 4);
        fish.dispose();
    });

    it('writes nothing while no fish is in the air', () => {
        // A second of the clock with no fish in the air.
        let from = 120;
        for (let t = from; t < 600; t += 0.05) {
            if (flyingAt(t)) from = t + 0.05;
            else if (t - from >= 1) break;
        }
        expect(flyingAt(from)).toBe(false);
        const fish = new Fish(createUniforms());
        fish.reset(from);
        // One frame clears the rows; after it nothing is uploaded until a fish leaves the water.
        fish.update(from);
        const fishVersion = fish.buffer.version;
        const ringVersion = fish.ringBuffer.version;
        for (let t = from; t < from + 0.95; t += 0.05) fish.update(t);
        expect(fish.airborne).toBe(0);
        expect(fish.buffer.version).toBe(fishVersion);
        expect(fish.ringBuffer.version).toBe(ringVersion);
        fish.dispose();
    });

    it('rings the water where a fish leaves it and where it falls back, drifting off downstream', () => {
        const fish = new Fish(createUniforms(), { count: 3 });
        const leap = leapAt(LANE_INDEX.runs, 6);
        fish.reset(leap.at - 0.1);
        fish.update(leap.at - 0.1);
        const quiet = fish.ringBuffer.version;
        fish.update(leap.at - 0.05);
        expect(fish.ringBuffer.version).toBe(quiet);
        fish.update(leap.at + 0.01);
        expect(fish.ringBuffer.version).toBeGreaterThan(quiet);
        // (Another lane's leap may be in the air too: these are this one's, by when they are born.)
        const rows = rowsOf(fish.ringData, fish.ringCount, RING_STRIDE);
        const leaving = rows.find((row) => Math.abs(row[3] - leap.at) < 1e-4);
        const back = rows.find((row) => Math.abs(row[3] - (leap.at + leap.T)) < 1e-4);
        expect(leaving).toBeTruthy();
        expect(back).toBeTruthy();
        expect(leaving[3]).toBeCloseTo(leap.at, 3);
        expect(back[3]).toBeCloseTo(leap.at + leap.T, 3);
        // The fall back throws the wider ring; each lies on the water and drifts downstream.
        expect(back[6]).toBeGreaterThan(leaving[6]);
        expect(leaving[6]).toBeGreaterThanOrEqual(RING.least);
        expect(leaving[1]).toBeCloseTo(leap.level0 + RING.lift, 4);
        const c = leapPose(leap, 0, 0, {}).course;
        expect(leaving[4] * c.tx + leaving[5] * c.tz).toBeGreaterThan(0);
        fish.dispose();
    });

    it('brings the salmon run on with the heat of play, never more than it can draw', () => {
        const leaps = [];
        const fish = new Fish(createUniforms(), { count: 4, onLeap: (leap) => leaps.push(leap) });
        fish.reset(0);
        for (let t = 0; t < 2; t += 0.1) fish.update(t, 0, 0, 0.1);
        const calm = leaps.filter((leap) => !leap.clock).length;
        expect(calm).toBe(0);
        for (let t = 2; t < 12; t += 0.1) fish.update(t, 0, HEAT.leaps + HEAT.leapsFever, 0.1);
        const run = leaps.filter((leap) => !leap.clock);
        expect(run.length).toBeGreaterThanOrEqual(2);
        for (const leap of run) expect(leap.kind).toBe(FISH.salmon.id);
        expect(fish.runs.length).toBeLessThanOrEqual(4);
        expect(fish.airborne).toBeLessThanOrEqual(4);
        fish.dispose();
    });
});

describe('spring fish: in the world', () => {
    const makeWorld = (quality = 'Minimal') => {
        const scene = new THREE.Scene();
        const aspect = 16 / 9;
        const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        const world = new SpringWorld({
            scene, quality, capture: true, prepared: { quality, ground: valleyGround(), assets: null },
        }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, aspect);
        const at = (t) => {
            world.updateCamera(camera, { time: t, delta: 1 / 30 });
            world.update({ time: t, delta: 1 / 30 }, camera);
        };
        return { world, at };
    };

    it('sizes the fish by the tier, and draws them with the effects after the river', () => {
        for (const tier of Object.values(QUALITY)) expect(tier.fish).toBeGreaterThanOrEqual(3);
        const { world } = makeWorld();
        expect(world.parts.fx.meshes).toContain(world.fish.mesh);
        expect(world.parts.fx.meshes).toContain(world.fish.rings);
        expect(world.fish.count).toBe(QUALITY.Minimal.fish);
        expect(world.fish.mesh.renderOrder).toBeGreaterThan(world.parts.river.mesh.renderOrder);
        world.dispose();
    });

    it('splashes as a fish leaves the water and as it falls back', () => {
        const { world, at } = makeWorld();
        const leap = leapAt(LANE_INDEX.ledges, 2);
        world.seek(leap.at - 0.2);
        at(leap.at - 0.1);
        const born = () => Array.from({ length: world.motes.count }, (_, i) => world.motes.start[i * 4 + 3])
            .filter((b) => b > -1e5);
        const before = born().length;
        at(leap.at + 0.05);
        const drops = born();
        expect(drops.length).toBeGreaterThan(before);
        // The fall back's crown is thrown now and lands when the fish does.
        expect(drops.some((b) => b >= leap.at + leap.T - 1e-6)).toBe(true);
        at(leap.at + leap.T * 0.5);
        expect(world.getState().fish).toBeGreaterThanOrEqual(1);
        world.dispose();
    });

    it('shows the same fish at a moment after a seek', () => {
        const { world, at } = makeWorld();
        const leap = leapAt(LANE_INDEX.runs, 5);
        const t = leap.at + leap.T * 0.4;
        world.seek(t);
        at(t);
        const first = Array.from(world.fish.data);
        world.seek(t - 30);
        at(t - 30);
        world.seek(t);
        at(t);
        expect(Array.from(world.fish.data)).toEqual(first);
        world.dispose();
    });

    it('keeps the run back under reduced motion, but the clock\'s fish still leap', () => {
        const { world, at } = makeWorld();
        world.setReducedMotion(true);
        world.heat.level = 1;
        const launch = world.fish.launch.bind(world.fish);
        let launched = 0;
        world.fish.launch = (...args) => {
            launched += 1;
            return launch(...args);
        };
        for (let t = 0; t < 20; t += 1 / 30) at(t);
        expect(launched).toBe(0);
        world.dispose();
    });

    it('stands the heat\'s salmon run beside the clock\'s', () => {
        expect(HEAT.leaps).toBeGreaterThan(0);
        expect(HEAT.leapsFever).toBeGreaterThan(HEAT.leaps);
        expect(EYE.y).toBeGreaterThan(levelAt(S_POOL));
    });
});
