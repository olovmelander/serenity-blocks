/**
 * Spring — fish in the river (spring-fish.js): salmon leaping at the fall and up the ledges, trout
 * jumping in the calmer runs. The leaps by the clock are a pure function of the time, every leap
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
    FISH, FISH_STRIDE, Fish, GRAVITY, LANES, LANE_INDEX, LONGEST, RING, RING_STRIDE, firstLeapAfter, fishGeometry,
    leapAt, leapPose,
} from '../../src/themes/spring/spring-fish.js';
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
    it('models a fish one long, nose forward, with a forked tail and fins on its midline', () => {
        const geometry = fishGeometry();
        const position = geometry.getAttribute('position');
        const body = geometry.getAttribute('aFishBody');
        let nose = -Infinity;
        let tail = Infinity;
        let deepest = 0;
        let fins = 0;
        for (let i = 0; i < position.count; i++) {
            nose = Math.max(nose, position.getZ(i));
            tail = Math.min(tail, position.getZ(i));
            if (body.getY(i) === 1) {
                fins += 1;
                expect(position.getX(i)).toBe(0);
            } else deepest = Math.max(deepest, Math.abs(position.getY(i)));
            // How far back from the nose, 0 … 1.
            expect(body.getX(i)).toBeCloseTo(Math.min(1, Math.max(0, 0.5 - position.getZ(i))), 6);
        }
        expect(nose).toBeCloseTo(0.5, 5);
        expect(tail).toBeCloseTo(-0.5, 5);
        // About a fifth as deep as it is long.
        expect(deepest * 2).toBeGreaterThan(0.18);
        expect(deepest * 2).toBeLessThan(0.26);
        expect(fins).toBeGreaterThanOrEqual(12);
        expect(geometry.index.count / 3).toBeGreaterThan(150);
        expect(geometry.index.count / 3).toBeLessThan(400);
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
