import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    cameraPosition, float, uniform, vec3, vec4,
} from 'three/tsl';

import { build, unassignedReads } from '../../../../tests/unit/helpers/tsl-node-build.js';
import {
    CLOUD_SHAPES, CLOUD_VOLUMES, cloudGrids, cloudShapeIndex, unpackPlane, unpackVolumes,
} from './odyssey-cloud-data.js';
import {
    CLOUD_SHADOWS, cloudFootprint, createCloudShadows, footprintBounds,
} from './odyssey-cloud-shadows.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import {
    CLOUD_CAP, CLOUD_LANES, CLOUD_WALL, CloudState, SKY_CLOUDS, cloudAt, cloudExtent,
} from './odyssey-cloud-composition.js';
import { CLOUD_INSTANCE, createCloudGeometry, createCloudMaterial } from './odyssey-cloud-material.js';
import { CLOUD_TIERS, cloudTier, createOdysseyClouds } from './odyssey-clouds.js';
import { createHighClouds } from './odyssey-high-clouds.js';
import { seaFloorAt } from './odyssey-cloud-sea.js';
import { WATER_CLOUD_SLOTS, selectWaterClouds, waterCloudProxy } from './odyssey-water-clouds.js';
import { ODYSSEY_MASSIFS, ODYSSEY_SEA_LEVEL, odysseyWorldHeight } from './odyssey-world-height.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

/**
 * THE CLOUDS (2026-11-24): the sculpted volumes, the composition, the tracer and what reads them.
 */

const asset = (name) => readFileSync(new URL(`../assets/clouds/${name}`, import.meta.url));
const hero = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
const SUMMIT = Object.freeze({ x: hero.x, y: hero.footY + hero.height, z: hero.z });
/** The evening as the rail meets it: how much of the floor and the cap has come. */
const eveningOf = (p) => ({
    summit: SUMMIT,
    cap: p > 0.38 ? 1 : 0,
    floorAt: (x, z, r) => seaFloorAt(x, z, r, Math.max(0, Math.min(1, (p - 0.35) / 0.235))),
});
const TIMES = Array.from({ length: 60 }, (_, i) => i * 131);

/** The file unpacked, as the game does it. */
const VOLUMES = (() => {
    const work = unpackVolumes(new Uint8Array(gunzipSync(asset('clouds.dat'))));
    for (;;) {
        const step = work.next();
        if (step.done) return step.value;
    }
})();

describe('the volumes', () => {
    it('are what their index says: every plane there, every byte, and small', () => {
        const raw = gunzipSync(asset('clouds.dat'));
        expect(raw.length).toBe(CLOUD_VOLUMES.bytes);
        const grids = cloudGrids();
        const planes = CLOUD_VOLUMES.planes.reduce((n, [name, kept]) => n + ((grids[name][0] * grids[name][1] * grids[name][2]) * kept), 0);
        expect(planes).toBe(raw.length);
        // Within what every WebGL2 and WebGPU device holds in one 3D texture.
        Object.entries(grids).forEach(([name, [x, y, z]]) => expect(Math.max(x, y, z), name).toBeLessThanOrEqual(2048));
        // Every cloud of the sky, the high sky and the floor: what a player downloads.
        const total = ['clouds.dat', 'high.png', 'sea.png'].reduce((n, f) => n + asset(f).length, 0);
        expect(total).toBeLessThan(5 * 1024 * 1024);
    });

    it('unpack as they were packed: the predictor undone, the levels spread, a wrong length refused', () => {
        // A small plane packed by hand: a ramp along each axis.
        const size = [3, 2, 2];
        const at = (x, y, z) => x + (2 * y) + (3 * z);
        const packed = new Uint8Array(12);
        for (let z = 0; z < 2; z += 1) {
            for (let y = 0; y < 2; y += 1) {
                for (let x = 0; x < 3; x += 1) {
                    let r = 0;
                    for (let k = 0; k < 8; k += 1) {
                        const [dx, dy, dz] = [k & 1, (k >> 1) & 1, (k >> 2) & 1];
                        if (x - dx < 0 || y - dy < 0 || z - dz < 0) continue;
                        r += ((dx + dy + dz) % 2 ? -1 : 1) * at(x - dx, y - dy, z - dz);
                    }
                    packed[(((z * 2) + y) * 3) + x] = r & 255;
                }
            }
        }
        const out = new Uint8Array(24);
        Array.from(unpackPlane(packed, 0, size, 9, out, 1, 2));
        for (let z = 0; z < 2; z += 1) {
            for (let y = 0; y < 2; y += 1) {
                for (let x = 0; x < 3; x += 1) {
                    const k = (((z * 2) + y) * 3) + x;
                    expect(out[(k * 2) + 1]).toBe(Math.round((at(x, y, z) * 255) / 8));
                    expect(out[k * 2]).toBe(0);
                }
            }
        }
        expect(() => unpackVolumes(new Uint8Array(10)).next()).toThrow(/10 bytes/);
    });

    it('hold each cloud whole: none is cut by its box, and its base is down in it', () => {
        const [nx, ny, nz] = CLOUD_VOLUMES.sdf;
        const total = ny * CLOUD_SHAPES.length;
        CLOUD_SHAPES.forEach((s, i) => {
            let open = 0;
            let solid = 0;
            for (let z = 0; z < nz; z += 1) {
                for (let y = 0; y < ny; y += 1) {
                    for (let x = 0; x < nx; x += 1) {
                        const inside = VOLUMES.sdf[(((z * total) + (i * ny) + y) * nx) + x] < 128;
                        solid += inside ? 1 : 0;
                        const edge = x === 0 || x === nx - 1 || z === 0 || z === nz - 1 || y === 0 || y === ny - 1;
                        open += inside && edge ? 1 : 0;
                    }
                }
            }
            expect(open, `${s.id} runs out of its box`).toBe(0);
            expect(solid / (nx * ny * nz), s.id).toBeCloseTo(s.fill, 2);
            expect(s.hi[1] - s.lo[1], s.id).toBeGreaterThan(0.5);
        });
    });

    it('are lit: each cloud has a bright side and a dark one, for every turn of it', () => {
        const [nx, ny, nz] = CLOUD_VOLUMES.light;
        const total = ny * CLOUD_SHAPES.length;
        CLOUD_SHAPES.forEach((s, i) => {
            for (let q = 0; q < 4; q += 1) {
                let lo = 255;
                let hi = 0;
                for (let z = 0; z < nz; z += 1) {
                    for (let y = 0; y < ny; y += 1) {
                        for (let x = 0; x < nx; x += 1) {
                            const k = (((z * total) + (i * ny) + y) * nx) + x;
                            if (VOLUMES.air[(k * 4) + 2] < 60) continue;
                            lo = Math.min(lo, VOLUMES.sun[(k * 4) + q]);
                            hi = Math.max(hi, VOLUMES.sun[(k * 4) + q]);
                        }
                    }
                }
                expect(hi, `${s.id} turn ${q}`).toBeGreaterThan(190);
                expect(lo, `${s.id} turn ${q}`).toBeLessThan(120);
            }
        });
    });
});

describe('the clouds\' shadows', () => {
    const C = CLOUD_SHADOWS;
    const len = Math.hypot(...ODYSSEY_WORLD_SUN);
    const sun = ODYSSEY_WORLD_SUN.map((v) => v / len);
    const heap = (extra = {}) => Object.assign(new CloudState(), {
        shape: cloudShapeIndex('heap-a'), x: -2000, y: 920, z: 300, w: 900, tall: 1, yaw: 0.7, eaten: 0.05, cover: 1, role: 'fair', ...extra,
    });
    const centroid = (data) => {
        let n = 0;
        let cx = 0;
        let cz = 0;
        for (let j = 0; j < C.res; j += 1) {
            for (let i = 0; i < C.res; i += 1) {
                const v = data[(j * C.res) + i];
                n += v;
                cx += v * (C.x - (C.extent / 2) + (((i + 0.5) / C.res) * C.extent));
                cz += v * (C.z - (C.extent / 2) + (((j + 0.5) / C.res) * C.extent));
            }
        }
        return { n, x: cx / n, z: cz / n };
    };

    it('fall where the sun lays them: away from it, as far out as the cloud is high', () => {
        const shadows = createCloudShadows({ field: () => VOLUMES.sdf });
        const s = heap();
        expect(shadows.update([s], 1)).toBe(true);
        const got = centroid(shadows.data);
        // From the middle of its body along the sun to the ground.
        const body = s.y + (0.22 * s.w);
        const run = (body - C.level) / sun[1];
        expect(Math.hypot(got.x - (s.x - (sun[0] * run)), got.z - (s.z - (sun[2] * run)))).toBeLessThan(s.w * 0.45);
        shadows.dispose();
    });

    it('are the shape\'s own: a tower\'s is longer than a puff\'s, and each facing its own outline', () => {
        const area = (id, turn) => cloudFootprint(cloudShapeIndex(id), turn, VOLUMES.sdf).reduce((n, v) => n + v, 0);
        const b = (id) => footprintBounds(cloudShapeIndex(id));
        expect(b('tower-a').to - b('tower-a').from).toBeGreaterThan((b('puff-c').to - b('puff-c').from) * 1.3);
        expect(area('heap-a', 0)).toBeGreaterThan(20);
        const a = cloudFootprint(cloudShapeIndex('heap-a'), 0, VOLUMES.sdf);
        const q = cloudFootprint(cloudShapeIndex('heap-a'), 6, VOLUMES.sdf);
        expect(a.some((v, k) => Math.abs(v - q[k]) > 0.3)).toBe(true);
        [a, q].forEach((f) => f.forEach((v) => { if (!(v >= 0 && v <= 1)) throw new Error(`footprint ${v}`); }));
    });

    it('slide with their cloud, never a step, and thin as it thins', () => {
        const shadows = createCloudShadows({ field: () => VOLUMES.sdf });
        shadows.update([heap()], 1);
        const before = Uint8Array.from(shadows.data);
        const a = centroid(shadows.data);
        shadows.update([heap({ x: -2002 })], 2);
        const b = centroid(shadows.data);
        expect(b.x - a.x).toBeLessThan(-1);
        expect(b.x - a.x).toBeGreaterThan(-3);
        let worst = 0;
        shadows.data.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - before[k])); });
        expect(worst).toBeLessThan(12);
        shadows.update([heap({ eaten: 0.6 })], 3);
        expect(centroid(shadows.data).n).toBeLessThan(a.n * 0.6);
        shadows.update([heap({ cover: 0 })], 4);
        expect(shadows.data.every((v) => v === 0)).toBe(true);
        shadows.dispose();
    });

    it('cost little: redrawn a few times a second, in a couple of milliseconds', () => {
        const shadows = createCloudShadows({ field: () => VOLUMES.sdf });
        const states = SKY_CLOUDS.map((c) => cloudAt(c, 500, new CloudState(), eveningOf(0.2)));
        expect(shadows.update(states, 10)).toBe(true);
        expect(shadows.update(states, 10 + (C.every / 2))).toBe(false);
        expect(shadows.update(states, 10 + (C.every * 1.01))).toBe(true);
        const t0 = performance.now();
        for (let k = 0; k < 10; k += 1) shadows.update(states, 20 + k);
        expect((performance.now() - t0) / 10).toBeLessThan(30);
        shadows.dispose();
    });

    it('cross the island: over two hours most of the meadow\'s minutes hold some, and none is all shade', () => {
        const shadows = createCloudShadows({ field: () => VOLUMES.sdf });
        const states = SKY_CLOUDS.map(() => new CloudState());
        let shaded = 0;
        let seen = 0;
        for (let t = 0; t < 7200; t += 60) {
            SKY_CLOUDS.forEach((c, k) => cloudAt(c, t, states[k], eveningOf(0.2)));
            shadows.update(states, t);
            let here = 0;
            let n = 0;
            for (let x = -700; x <= 400; x += 50) {
                for (let z = -600; z <= -220; z += 50) {
                    const i = Math.floor(((x - (C.x - (C.extent / 2))) / C.extent) * C.res);
                    const j = Math.floor(((z - (C.z - (C.extent / 2))) / C.extent) * C.res);
                    here += shadows.data[(j * C.res) + i] > 60 ? 1 : 0;
                    n += 1;
                }
            }
            seen += 1;
            shaded += here > n * 0.04 ? 1 : 0;
        }
        expect(shaded / seen).toBeGreaterThan(0.4);
        expect(shaded / seen).toBeLessThan(1);
        shadows.dispose();
    });
});

describe('the composition', () => {
    const s = new CloudState();

    it('is storeys: giants, the day\'s heaps, the floor, the wall and the cap, of many shapes', () => {
        const roles = {};
        SKY_CLOUDS.forEach((c) => { const r = cloudAt(c, 0, s, eveningOf(0.6)).role; roles[r] = (roles[r] ?? 0) + 1; });
        expect(Object.keys(roles).sort()).toEqual(['cap', 'fair', 'floor', 'giant', 'wall']);
        expect(roles.giant).toBeGreaterThanOrEqual(7);
        expect(roles.wall).toBe(CLOUD_WALL.length);
        expect(roles.cap).toBe(CLOUD_CAP.length);
        const used = new Set(CLOUD_LANES.flatMap((l) => l.shapes).concat(CLOUD_WALL.map((b) => b[4])));
        expect(used.size).toBeGreaterThanOrEqual(13);
        used.forEach((id) => expect(cloudShapeIndex(id), id).toBeGreaterThanOrEqual(0));
        expect(CLOUD_SHAPES.length).toBeLessThanOrEqual(32);
    });

    it('stands at different heights, the far ones the highest', () => {
        const tops = { fair: [], giant: [] };
        SKY_CLOUDS.filter((c) => c.lane).forEach((c) => TIMES.slice(0, 8).forEach((t) => {
            cloudAt(c, t, s);
            tops[s.role]?.push(s.y + cloudExtent(s).up);
        }));
        const mean = (l) => l.reduce((a, b) => a + b, 0) / l.length;
        expect(mean(tops.giant)).toBeGreaterThan(mean(tops.fair) + 500);
    });

    it('never comes near the rail: the eye is never in a cloud', () => {
        for (let p = 0.14; p < 0.70; p += 0.02) {
            const eye = getOdysseyPathPointAt(p);
            const world = eveningOf(p);
            TIMES.forEach((t) => SKY_CLOUDS.forEach((c) => {
                cloudAt(c, t, s, world);
                if (s.cover < 0.02) return;
                const e = cloudExtent(s);
                const flat = Math.max(0, Math.hypot(s.x - eye.x, s.z - eye.z) - e.across);
                const up = Math.max(0, s.y - eye.y, eye.y - (s.y + e.up));
                const d = Math.hypot(flat, up);
                if (d < 190) throw new Error(`${s.role} ${c.lane?.id ?? c.k} ${d.toFixed(0)} u from the rail at ${p.toFixed(2)}, t ${t}`);
            }));
        }
    });

    it('leaves the mountain its sky: no heap or giant over the summit, none down on the land', () => {
        TIMES.forEach((t) => SKY_CLOUDS.forEach((c) => {
            cloudAt(c, t, s, eveningOf(0.6));
            if (s.cover < 0.02) return;
            if (s.role === 'fair' || s.role === 'giant') {
                const d = Math.hypot(s.x - SUMMIT.x, s.z - SUMMIT.z) - cloudExtent(s).across;
                if (d < 120) throw new Error(`${s.role} ${c.lane.id} over the summit at t ${t}`);
            }
            // (Hills stand out of a sea of clouds; nothing else has land in it.)
            if (s.role !== 'floor' && s.y < odysseyWorldHeight(s.x, s.z) + 90) throw new Error(`${s.role} on the ground at (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`);
            expect(s.y).toBeGreaterThan(ODYSSEY_SEA_LEVEL + 120);
        }));
    });

    it('drifts down the wind, gently, and is never seen to appear or to go', () => {
        const a = new CloudState();
        const b = new CloudState();
        SKY_CLOUDS.filter((c) => c.lane).forEach((c) => {
            for (let t = 0; t < 4000; t += 7.3) {
                cloudAt(c, t, a, eveningOf(0.6));
                cloudAt(c, t + 0.25, b, eveningOf(0.6));
                const moved = Math.hypot(b.x - a.x, b.z - a.z);
                // A new one takes its place only where neither is there to be seen.
                if (moved > 40) {
                    expect(Math.max(a.cover, b.cover), `${c.lane.id} at ${t}`).toBeLessThan(0.02);
                } else {
                    expect(moved / 0.25, c.lane.id).toBeLessThan(c.lane.speed * 1.05);
                    expect(Math.abs(b.cover - a.cover), c.lane.id).toBeLessThan(0.02);
                    expect(Math.abs(b.eaten - a.eaten), c.lane.id).toBeLessThan(0.02);
                    expect(Math.abs(b.w - a.w), c.lane.id).toBeLessThan(a.w * 0.01);
                }
            }
        });
    });

    it('never repeats itself: a lane\'s place wears another cloud each time round', () => {
        const c = SKY_CLOUDS.find((q) => q.lane?.id === 'fair-w2');
        const round = (2 * c.lane.half) / c.lane.speed;
        const seen = new Set();
        for (let k = 0; k < 12; k += 1) {
            cloudAt(c, (k + 0.5) * round, s);
            seen.add(`${s.shape}|${s.yaw.toFixed(2)}|${s.w.toFixed(0)}`);
        }
        expect(seen.size).toBe(12);
    });

    it('lets the wall go as the climb leaves it: from very high a ring would be a ring', () => {
        SKY_CLOUDS.filter((c) => c.wall).forEach((c) => {
            expect(cloudAt(c, 300, s, { ...eveningOf(0.6), climb: 1 }).cover).toBe(1);
            expect(cloudAt(c, 300, s, { ...eveningOf(0.7), climb: 3 }).cover).toBe(0);
        });
        expect(new Set(CLOUD_WALL.map((b) => b[1])).size).toBe(CLOUD_WALL.length);
    });

    it('brings the floor and the cap only with the evening', () => {
        SKY_CLOUDS.filter((c) => c.lane?.role === 'floor' || c.cap).forEach((c) => {
            cloudAt(c, 300, s, eveningOf(0.2));
            expect(s.cover).toBe(0);
        });
        const there = SKY_CLOUDS.filter((c) => c.lane?.role === 'floor').filter((c) => cloudAt(c, 300, s, eveningOf(0.62)).cover > 0.5);
        expect(there.length).toBeGreaterThan(12);
        // The cap stands in the lee, over the summit, and is forming or thinning, never all one thing.
        const covers = TIMES.map((t) => SKY_CLOUDS.filter((c) => c.cap).reduce((n, c) => n + cloudAt(c, t, s, eveningOf(0.6)).cover, 0));
        expect(Math.max(...covers)).toBeGreaterThan(1.2);
        expect(Math.min(...covers)).toBeLessThan(0.9);
    });
});

describe('the tracer', () => {
    const uSun = uniform(new THREE.Color(1, 0.9, 0.8));
    const textures = () => ['sdf', 'sun', 'air', 'billow'].reduce((o, k) => ({ ...o, [k]: new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1) }), {});
    const material = (fineOn) => createCloudMaterial({
        volumes: textures(),
        uOn: uniform(1),
        steps: 40,
        fineOn,
        cameraPosition,
        uTime: uniform(0),
        uSunDir: uniform(new THREE.Vector3(0, 1, 0)),
        prepare: (rd) => ({ up: rd.y.toVar() }),
        light: (k, q) => uSun.mul(q.sun.add(q.sky.mul(k.up)).add(q.ground).add(q.relief.mul(q.lit)).add(q.body.mul(q.h))
            .mul(q.dens)
            .mul(float(1).sub(q.eaten))),
        air: (rgb, alpha, rd, p, dist, wall) => vec4(rgb.add(vec3(p.y.mul(0.0001), dist.mul(0.0001), wall).mul(alpha)).mul(rd.y.abs().add(1)), alpha),
    });
    [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([label, Builder]) => {
        [true, false].forEach((fineOn) => {
            it(`builds clean (${label}, fine billows ${fineOn ? 'on' : 'off'})`, () => {
                const { geometry } = createCloudGeometry(4);
                const out = build(Builder, new THREE.Mesh(geometry, material(fineOn)));
                expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard).toEqual([]);
                ['vertex', 'fragment'].forEach((stage) => expect(out[stage]).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/));
                if (label === 'WGSL') expect(unassignedReads(out.fragment)).toEqual([]);
            });
        });
    });

    it('blends premultiplied, writes no depth, and hides behind what stands before it', () => {
        const mat = material(true);
        expect(mat.transparent && mat.premultipliedAlpha).toBe(true);
        expect(mat.depthWrite).toBe(false);
        expect(mat.depthTest).toBe(true);
        expect(mat.side).toBe(THREE.FrontSide);
    });

    it('draws what the eye can see, furthest first, and nothing under water', () => {
        const sky = createOdysseyClouds({
            tier: 'High',
            load: false,
            summit: SUMMIT,
            ctx: {
                cameraPosition,
                uTime: uniform(0),
                uSunDir: uniform(new THREE.Vector3(0, 1, 0)),
                prepare: () => ({}),
                light: () => vec3(1),
                air: (rgb, alpha) => vec4(rgb, alpha),
            },
        });
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 9000);
        camera.position.set(-76, 339, -111);
        camera.lookAt(-800, 700, -2500);
        camera.updateMatrixWorld(true);
        camera.updateProjectionMatrix();
        // Until the volumes land none is drawn, though where they are is known (their shadows, the water).
        sky.update(100, camera, true);
        expect(sky.mesh.visible).toBe(false);
        expect(sky.drawn).toBeGreaterThan(8);
        expect(sky.drawn).toBeLessThan(sky.clouds.length);
        const { array } = sky.mesh.geometry.getAttribute('aAt').data;
        const distances = Array.from({ length: sky.drawn }, (_, k) => {
            const o = k * CLOUD_INSTANCE.stride;
            return Math.hypot(array[o] + 76, array[o + 1] - 339, array[o + 2] + 111);
        });
        distances.slice(1).forEach((d, k) => expect(d).toBeLessThan(distances[k] + 1400));
        expect(distances[0]).toBeGreaterThan(distances.at(-1));
        // Under water there is no asking.
        sky.update(200, camera, false);
        expect(sky.mesh.visible).toBe(false);
        sky.dispose();
        expect(CLOUD_INSTANCE.layout.length * 4).toBe(CLOUD_INSTANCE.stride);
    });

    it('steps down with the tier', () => {
        const names = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
        names.slice(1).forEach((n, i) => expect(CLOUD_TIERS[n].steps).toBeGreaterThan(CLOUD_TIERS[names[i]].steps));
        expect(cloudTier('nonsense')).toBe(CLOUD_TIERS.High);
        expect(CLOUD_TIERS.Medium.fine).toBe(false);
    });
});

describe('the high sky', () => {
    it('has its sheet, a square of data, and lays it over the dome on both backends', () => {
        const png = asset('high.png');
        expect([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]]).toEqual([1024, 1024, 8, 6]);
        const high = createHighClouds({ load: false });
        const mat = new THREE.MeshBasicNodeMaterial();
        mat.colorNode = high.over({
            base: vec3(0.4, 0.6, 0.9),
            dir: vec3(0, 0.4, -0.9),
            eye: cameraPosition,
            time: uniform(0),
            sunDir: uniform(new THREE.Vector3(-0.9, 0.3, 0.4)),
            sunColour: uniform(new THREE.Color(1, 0.9, 0.8)),
            shade: vec3(0.6, 0.65, 0.8),
            hour: (c) => c,
            coverOf: (c) => c,
            keep: uniform(1),
        });
        [THREE.WGSLNodeBuilder, THREE.GLSLNodeBuilder].forEach((Builder) => {
            const out = build(Builder, new THREE.Mesh(new THREE.SphereGeometry(1), mat));
            expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(out.heard).toEqual([]);
        });
        high.dispose();
    });
});

describe('the clouds in the water', () => {
    const rowsOf = () => Array.from({ length: WATER_CLOUD_SLOTS * 3 }, () => new THREE.Vector4());
    const states = (t) => SKY_CLOUDS.map((c) => cloudAt(c, t, new CloudState(), eveningOf(0.2)));

    it('are where the clouds are: an ellipsoid round each, turned as it is', () => {
        states(400).filter((s) => s.role === 'fair' && s.cover > 0.5).forEach((s) => {
            const p = waterCloudProxy(s, {});
            expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeLessThan(s.w * 0.12);
            expect(p.y).toBeGreaterThan(s.y);
            expect(p.y).toBeLessThan(s.y + cloudExtent(s).up);
            expect(p.cos).toBeCloseTo(Math.cos(s.yaw), 6);
        });
    });

    it('are the nearest and largest whose mirror image is in view, and only whole ones', () => {
        const rows = rowsOf();
        const eye = { x: -76, y: 339, z: -111 };
        const n = selectWaterClouds(states(400), eye, () => true, [ODYSSEY_SEA_LEVEL], rows);
        expect(n).toBe(WATER_CLOUD_SLOTS);
        rows.slice(0, n * 3).forEach((r) => expect([r.x, r.y, r.z, r.w].every(Number.isFinite)).toBe(true));
        expect(selectWaterClouds(states(400), eye, () => false, [ODYSSEY_SEA_LEVEL], rows)).toBe(0);
        // Under the plane there is no mirror.
        expect(selectWaterClouds(states(400), { ...eye, y: 100 }, () => true, [ODYSSEY_SEA_LEVEL], rows)).toBe(0);
        expect(selectWaterClouds([], eye, () => true, [ODYSSEY_SEA_LEVEL], rows)).toBe(0);
    });
});
