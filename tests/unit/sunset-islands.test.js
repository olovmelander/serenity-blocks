/**
 * Sunset — the islands: the shapes as Blender wrote them, where they stand round the two gates,
 * the skyline the sea mirrors, the lamp points, and the part in the world.
 */
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    GATE_CLEAR, ISLAND_GROUPS, ISLAND_LAYOUT, SKYLINE, bakeIslandGrain, createIslands, islandModels, placeIslands,
    skylineRow,
} from '../../src/themes/sunset/sunset-islands.js';
import { SUNSET_ISLANDS } from '../../src/themes/sunset/sunset-islands-model.js';
import { DEG, EYE_HEIGHT } from '../../src/themes/sunset/sunset-core.js';
import { SUNSET_PARTS, SunsetWorld } from '../../src/themes/sunset/sunset-world.js';
import { QUALITY_NAMES } from '../../src/themes/sunset/sunset-quality.js';
import { fallbackLayout, frameFor } from '../../src/themes/sunset/sunset-composition.js';

const W = 1600;
const H = 900;
const MODEL_FILE = fileURLToPath(new URL('../../src/themes/sunset/sunset-islands-model.js', import.meta.url));

const bearing = (x, z) => Math.atan2(x, -z) / DEG;

/** What a shape measures: its box, and six times the volume its faces enclose. */
function measure(model) {
    const p = model.positions;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
        for (let c = 0; c < 3; c += 1) {
            lo[c] = Math.min(lo[c], p[i + c]);
            hi[c] = Math.max(hi[c], p[i + c]);
        }
    }
    let volume = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < model.index.length; i += 3) {
        a.fromArray(p, model.index[i] * 3);
        b.fromArray(p, model.index[i + 1] * 3);
        c.fromArray(p, model.index[i + 2] * 3);
        volume += a.dot(b.cross(c));
    }
    return { lo, hi, volume };
}

/** A world on the solo layout, stepped until the gates have settled. */
function makeWorld(options = {}) {
    const scene = new THREE.Scene();
    const world = new SunsetWorld({ scene, quality: 'Low', ...options }).build();
    const w = options.width ?? W;
    const h = options.height ?? H;
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.25, 40000);
    world.bindCamera(camera);
    world.setLayout(options.noBoard ? null : fallbackLayout(w, h), w / h);
    world.setViewport(w, h, w / h);
    world.seek(10);
    let t = world.clock;
    const step = (seconds, dt = 1 / 30) => {
        for (let i = 0; i < Math.round(seconds / dt); i += 1) {
            t += dt;
            const sim = {
                time: t, delta: dt, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        }
    };
    step(0.5);
    return {
        world, camera, scene, step,
    };
}

describe('sunset islands: the shapes', () => {
    const models = islandModels();

    it('are the four Blender wrote, within the game budget', () => {
        expect(SUNSET_ISLANDS.shapes.map((s) => s.name)).toEqual(['tower', 'ridge', 'stack', 'islet']);
        let triangles = 0;
        SUNSET_ISLANDS.shapes.forEach((shape) => {
            const m = models[shape.name];
            expect(m.positions, shape.name).toHaveLength(shape.vertexCount * 3);
            expect(m.index, shape.name).toHaveLength(shape.triangleCount * 3);
            expect(m.colours, shape.name).toHaveLength(shape.vertexCount * 4);
            expect(Math.max(...m.index), shape.name).toBe(shape.vertexCount - 1);
            triangles += shape.triangleCount;
        });
        // All four together: at most about 9,000 triangles, a module of at most about 160 KB.
        expect(triangles).toBeLessThanOrEqual(9000);
        expect(triangles).toBeGreaterThan(6000);
        expect(statSync(MODEL_FILE).size).toBeLessThanOrEqual(160 * 1024);
    });

    it('are real size, no two alike: a tall tower, a long ridge, a needle and a low islet', () => {
        const size = Object.fromEntries(Object.keys(models).map((name) => {
            const { lo, hi } = measure(models[name]);
            return [name, { height: hi[1], long: hi[0] - lo[0], wide: hi[2] - lo[2] }];
        }));
        // The tower: about 130 m high, 110 to 150 m across, taller than it is wide from its end.
        expect(size.tower.height).toBeGreaterThan(118);
        expect(size.tower.height).toBeLessThan(142);
        expect(size.tower.long).toBeGreaterThan(110);
        expect(size.tower.long).toBeLessThan(155);
        expect(size.tower.height).toBeGreaterThan(size.tower.wide * 1.2);
        // The ridge: about 80 m high, 400 to 500 m long, five times longer than it is high.
        expect(size.ridge.height).toBeGreaterThan(70);
        expect(size.ridge.height).toBeLessThan(92);
        expect(size.ridge.long).toBeGreaterThan(400);
        expect(size.ridge.long).toBeLessThan(500);
        // The needle: about 40 m, taller than its foot is long.
        expect(size.stack.height).toBeGreaterThan(34);
        expect(size.stack.height).toBeLessThan(48);
        expect(size.stack.height).toBeGreaterThan(size.stack.wide * 1.4);
        // The islet: about 25 m high and 120 m long.
        expect(size.islet.height).toBeGreaterThan(19);
        expect(size.islet.height).toBeLessThan(31);
        expect(size.islet.long).toBeGreaterThan(100);
        expect(size.islet.long).toBeLessThan(140);
        Object.keys(models).forEach((name) => {
            expect(SUNSET_ISLANDS.shapes.find((s) => s.name === name).height).toBeCloseTo(size[name].height, 1);
        });
    });

    it('stand in the sea: a few metres deeper than the water, cut clean at the waterline', () => {
        Object.keys(models).forEach((name) => {
            const m = models[name];
            const { lo } = measure(m);
            expect(lo[1], name).toBeLessThan(-2.5);
            expect(lo[1], name).toBeGreaterThan(-8);
            // Rock all the way round at the waterline: vertices just under it in every quarter.
            const quarters = new Set();
            for (let i = 0; i < m.positions.length; i += 3) {
                const y = m.positions[i + 1];
                const round = Math.atan2(m.positions[i + 2], m.positions[i]) + Math.PI;
                if (y < 0 && y > -5) quarters.add(Math.floor(round / (Math.PI / 2)) % 4);
            }
            expect(quarters.size, name).toBe(4);
        });
    });

    it('face outward, so the light falls on the side the eye sees', () => {
        Object.keys(models).forEach((name) => {
            const m = models[name];
            // The faces enclose a positive volume, of about the size of the island.
            const { volume, lo, hi } = measure(m);
            const box = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
            expect(volume / 6, name).toBeGreaterThan(box * 0.12);
            expect(volume / 6, name).toBeLessThan(box);
        });
        // The tower's walls half way up look away from its axis.
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(models.tower.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(models.tower.index, 1));
        geometry.computeVertexNormals();
        const pos = geometry.getAttribute('position');
        const nor = geometry.getAttribute('normal');
        let checked = 0;
        let outward = 0;
        for (let i = 0; i < pos.count; i += 1) {
            const y = pos.getY(i);
            const out = Math.hypot(pos.getX(i), pos.getZ(i));
            if (y < 15 || y > 60 || out < 45) continue;
            checked += 1;
            if (nor.getX(i) * pos.getX(i) + nor.getZ(i) * pos.getZ(i) > 0) outward += 1;
        }
        expect(checked).toBeGreaterThan(60);
        expect(outward / checked).toBeGreaterThan(0.9);
        geometry.dispose();
    });

    it('are painted: jungle on top, bare rock at the water, a dark notch under the walls', () => {
        Object.keys(models).forEach((name) => {
            const m = models[name];
            const { hi } = measure(m);
            const high = { jungle: 0, n: 0 };
            const low = { jungle: 0, n: 0, light: 0 };
            const wall = { light: 0, n: 0 };
            for (let i = 0; i < m.vertexCount; i += 1) {
                const y = m.positions[i * 3 + 1];
                const jungle = m.colours[i * 4 + 3] / 255;
                const lightness = (m.colours[i * 4] + m.colours[i * 4 + 1] + m.colours[i * 4 + 2]) / 765;
                if (y > hi[1] * 0.8) {
                    high.jungle += jungle;
                    high.n += 1;
                } else if (y > 0 && y < 2.5) {
                    low.jungle += jungle;
                    low.light += lightness;
                    low.n += 1;
                } else if (y > hi[1] * 0.3 && y < hi[1] * 0.6 && jungle < 0.1) {
                    wall.light += lightness;
                    wall.n += 1;
                }
            }
            expect(high.n, name).toBeGreaterThan(5);
            expect(low.n, name).toBeGreaterThan(5);
            expect(high.jungle / high.n, name).toBeGreaterThan(0.5);
            expect(low.jungle / low.n, name).toBeLessThan(0.05);
            // The wet foot is much darker than the wall over it.
            if (wall.n > 5) expect(low.light / low.n, name).toBeLessThan((wall.light / wall.n) * 0.5);
        });
    });

    it('carry lamp points round the foot, just over the water', () => {
        SUNSET_ISLANDS.shapes.forEach((shape) => {
            expect(shape.lamps.length, shape.name).toBeGreaterThanOrEqual(8);
            shape.lamps.forEach(([x, y, z]) => {
                expect(y, shape.name).toBeGreaterThan(1.5);
                expect(y, shape.name).toBeLessThan(7);
                expect(Math.hypot(x, z), shape.name).toBeLessThan(shape.radius + 4);
            });
        });
    });
});

describe('sunset islands: where they stand', () => {
    const placed = Object.fromEntries(ISLAND_GROUPS.map((group) => [group, placeIslands(group)]));

    it('keeps both gates open sea, whatever way an island is turned', () => {
        ISLAND_GROUPS.forEach((group) => {
            const { positions, islands } = placed[group];
            // Every vertex of every island, at the yaw the layout gives it.
            for (let i = 0; i < positions.length; i += 3) {
                expect(Math.abs(bearing(positions[i], positions[i + 2]))).toBeGreaterThanOrEqual(GATE_CLEAR);
            }
            islands.forEach((island) => {
                expect(Math.min(Math.abs(island.from), Math.abs(island.to)), `${group} ${island.shape}`)
                    .toBeGreaterThanOrEqual(GATE_CLEAR);
                // On one side of the gate, never astride it.
                expect(island.from * island.to, `${group} ${island.shape}`).toBeGreaterThan(0);
            });
        });
        // And at any other yaw: the near islands' whole turning circles stay clear of the gate
        // (the long ridges are placed by their sheer end and are checked as they stand above).
        const models = islandModels();
        ISLAND_GROUPS.forEach((group) => {
            ISLAND_LAYOUT[group].filter((island) => island.shape !== 'ridge').forEach((island) => {
                const reach = Math.asin((models[island.shape].radius * island.scale) / island.range) / DEG;
                expect(Math.abs(island.at) - reach, `${group} ${island.shape} at ${island.at}`)
                    .toBeGreaterThanOrEqual(GATE_CLEAR);
            });
        });
    });

    it('stands them at scenery range, under eight degrees tall, inside the skyline', () => {
        ISLAND_GROUPS.forEach((group) => {
            placed[group].islands.forEach((island) => {
                const label = `${group} ${island.shape} at ${island.at}`;
                expect(island.range, label).toBeGreaterThanOrEqual(1200);
                expect(island.range, label).toBeLessThanOrEqual(8000);
                expect(island.tall, label).toBeLessThan(8);
                expect(island.tall, label).toBeGreaterThan(0.3);
                expect(island.from, label).toBeGreaterThan(-SKYLINE.half);
                expect(island.to, label).toBeLessThan(SKYLINE.half);
            });
        });
    });

    it('composes the picture: a hero pair and a ridge at the set, a tower and a ridge at the rise', () => {
        const near = (group) => placed[group].islands.filter((island) => island.range < 4000);
        const far = (group) => placed[group].islands.filter((island) => island.range >= 4000);
        // The set: the tower (80 to 120 px tall at 20 px a degree) and the needle on the card's
        // side, the long ridge on the far side.
        const tower = near('set').find((island) => island.shape === 'tower');
        const stack = near('set').find((island) => island.shape === 'stack');
        const ridge = near('set').find((island) => island.shape === 'ridge');
        expect(tower.tall * 20).toBeGreaterThan(80);
        expect(tower.tall * 20).toBeLessThan(120);
        expect(tower.from).toBeGreaterThan(GATE_CLEAR);
        expect(tower.to).toBeLessThan(15.5);
        expect(stack.from).toBeGreaterThan(GATE_CLEAR);
        expect(stack.to).toBeLessThan(tower.to);
        expect(tower.range).toBeGreaterThanOrEqual(1300);
        expect(tower.range).toBeLessThanOrEqual(1800);
        expect(ridge.to).toBeLessThan(-GATE_CLEAR);
        expect(ridge.from).toBeGreaterThan(-22);
        expect(ridge.range).toBeGreaterThanOrEqual(2200);
        expect(ridge.range).toBeLessThanOrEqual(3000);
        // The rise: a tower between the stats bar and the gate, a ridge beyond the gate.
        const mid = near('rise').find((island) => island.shape === 'tower');
        const beyond = near('rise').find((island) => island.shape === 'ridge');
        expect(mid.from).toBeGreaterThan(-11.5);
        expect(mid.to).toBeLessThan(-GATE_CLEAR);
        expect(mid.range).toBeGreaterThanOrEqual(2500);
        expect(mid.range).toBeLessThanOrEqual(3500);
        expect(beyond.from).toBeGreaterThan(GATE_CLEAR);
        expect(beyond.range).toBeGreaterThanOrEqual(1600);
        expect(beyond.range).toBeLessThanOrEqual(2400);
        // Far islets either side of each gate, for depth.
        ISLAND_GROUPS.forEach((group) => {
            expect(far(group).length, group).toBeGreaterThanOrEqual(3);
            expect(far(group).some((island) => island.to < 0), group).toBe(true);
            expect(far(group).some((island) => island.from > 0), group).toBe(true);
        });
    });

    it('uses each shape more than once, turned, scaled and mirrored', () => {
        const all = [...ISLAND_LAYOUT.set, ...ISLAND_LAYOUT.rise];
        expect(all.length).toBeGreaterThanOrEqual(12);
        ['tower', 'ridge'].forEach((shape) => {
            const uses = all.filter((island) => island.shape === shape);
            expect(uses.length, shape).toBeGreaterThanOrEqual(3);
            expect(new Set(uses.map((island) => `${island.yaw}/${island.scale}/${island.mirror}`)).size, shape)
                .toBe(uses.length);
            expect(uses.some((island) => island.mirror), shape).toBe(true);
        });
    });

    it('keeps a mirrored island facing outward', () => {
        ISLAND_GROUPS.forEach((group) => {
            const { positions, index, islands } = placed[group];
            let start = 0;
            const a = new THREE.Vector3();
            const b = new THREE.Vector3();
            const c = new THREE.Vector3();
            islands.forEach((island) => {
                // Its volume about its own middle is positive, mirrored or not.
                const centre = new THREE.Vector3(
                    island.range * Math.sin(island.at * DEG),
                    0,
                    -island.range * Math.cos(island.at * DEG),
                );
                let volume = 0;
                for (let i = start; i < island.indexEnd; i += 3) {
                    a.fromArray(positions, index[i] * 3).sub(centre);
                    b.fromArray(positions, index[i + 1] * 3).sub(centre);
                    c.fromArray(positions, index[i + 2] * 3).sub(centre);
                    volume += a.dot(b.cross(c));
                }
                expect(volume, `${group} ${island.shape} at ${island.at}`).toBeGreaterThan(0);
                start = island.indexEnd;
            });
            expect(start).toBe(index.length);
        });
    });
});

describe('sunset islands: the skyline', () => {
    /**
     * The land's top along one bearing, found the slow way: every triangle cut by the upright
     * plane through the eye at that bearing. Returns { tan, range } (0 where there is no land
     * above the eye's height).
     */
    function cutAt(placed, offset) {
        const { positions, index } = placed;
        const nx = Math.cos(offset * DEG);
        const nz = Math.sin(offset * DEG);
        const side = (i) => positions[i * 3] * nx + positions[i * 3 + 2] * nz;
        let tan = 0;
        let range = 0;
        const meet = (a, b) => {
            const da = side(a);
            const db = side(b);
            if ((da < 0) === (db < 0)) return;
            const t = da / (da - db);
            const x = positions[a * 3] + (positions[b * 3] - positions[a * 3]) * t;
            const y = positions[a * 3 + 1] + (positions[b * 3 + 1] - positions[a * 3 + 1]) * t;
            const z = positions[a * 3 + 2] + (positions[b * 3 + 2] - positions[a * 3 + 2]) * t;
            const far = Math.hypot(x, z);
            // (In front of the eye: the plane also cuts the sea behind it.)
            if (-z * Math.cos(offset * DEG) + x * Math.sin(offset * DEG) <= 0) return;
            if ((y - EYE_HEIGHT) / far > tan) {
                tan = (y - EYE_HEIGHT) / far;
                range = far;
            }
        };
        for (let i = 0; i < index.length; i += 3) {
            meet(index[i], index[i + 1]);
            meet(index[i + 1], index[i + 2]);
            meet(index[i + 2], index[i]);
        }
        return { tan, range };
    }

    it('agrees with the placed meshes, cut bearing by bearing', () => {
        ISLAND_GROUPS.forEach((group) => {
            const placed = placeIslands(group);
            const { tan, range } = skylineRow(placed);
            const { width, half, tanMax } = SKYLINE;
            const centre = (c) => ((c + 0.5) / width) * 2 * half - half;
            const tallest = Math.max(...placed.islands.map((i) => Math.tan(i.tall * DEG)));
            let land = 0;
            for (let c = 0; c < width; c += 1) {
                const cut = cutAt(placed, centre(c));
                // The same top, the same land (or the same open water), at every column.
                expect(tan[c], `${group} column ${c}`).toBeCloseTo(cut.tan, 4);
                expect(tan[c] > 0, `${group} column ${c}`).toBe(cut.tan > 0);
                if (tan[c] > 0) {
                    land += 1;
                    expect(Math.abs(range[c] - cut.range), `${group} column ${c}`).toBeLessThan(2);
                    expect(tan[c], `${group} column ${c}`).toBeLessThan(tanMax);
                    expect(tan[c], `${group} column ${c}`).toBeLessThanOrEqual(tallest + 1e-6);
                    // It is inside the span of an island that stands at that range.
                    const home = placed.islands.find((i) => centre(c) > i.from - 0.2 && centre(c) < i.to + 0.2
                        && Math.abs(range[c] - i.range) < 400);
                    expect(home, `${group} column ${c}`).toBeTruthy();
                }
                // One mass with no rock off it: no hole anywhere inside its span.
                const solid = placed.islands.some((i) => (i.shape === 'tower' || i.shape === 'islet')
                    && centre(c) > i.from + 0.2 && centre(c) < i.to - 0.2);
                if (solid) expect(tan[c], `${group} column ${c}`).toBeGreaterThan(0);
                // Outside every island, and in the gate itself, open sea.
                const outside = placed.islands.every((i) => centre(c) < i.from - 0.2 || centre(c) > i.to + 0.2);
                if (outside || Math.abs(centre(c)) < GATE_CLEAR - 0.2) expect(tan[c], `${group} column ${c}`).toBe(0);
            }
            expect(land, group).toBeGreaterThan(60);
        });
    });

    it('is a 512 x 2 texture the sea can read: height, range and a land mask', () => {
        const world = new SunsetWorld({ scene: new THREE.Scene(), quality: 'Low' });
        const islands = createIslands({ U: world.U });
        const {
            texture, half, tanMax, far,
        } = islands.skyline;
        expect([half, tanMax, far]).toEqual([40, 0.2, 9000]);
        expect(texture.image.width).toBe(512);
        expect(texture.image.height).toBe(2);
        expect(texture.magFilter).toBe(THREE.LinearFilter);
        expect(texture.minFilter).toBe(THREE.LinearFilter);
        expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.generateMipmaps).toBe(false);
        const { data } = texture.image;
        ISLAND_GROUPS.forEach((group, row) => {
            const { tan, range } = skylineRow(placeIslands(group));
            let land = 0;
            for (let c = 0; c < 512; c += 1) {
                const at = (row * 512 + c) * 4;
                if (tan[c] > 0) {
                    land += 1;
                    expect(data[at + 2]).toBe(255);
                    expect(data[at] / 255).toBeCloseTo(tan[c] / tanMax, 1);
                    expect(Math.abs((data[at] / 255) * tanMax - tan[c])).toBeLessThan(tanMax / 255);
                    expect(Math.abs((data[at + 1] / 255) * far - range[c])).toBeLessThan(far / 255);
                } else {
                    expect([data[at], data[at + 1], data[at + 2]]).toEqual([0, 0, 0]);
                }
            }
            expect(land, group).toBeGreaterThan(60);
        });
        islands.dispose();
    });
});

describe('sunset islands: the part', () => {
    it('is two draws of one material, after the sea and before the sky', () => {
        const world = new SunsetWorld({ scene: new THREE.Scene(), quality: 'Low' });
        const islands = createIslands({ U: world.U });
        expect(islands.mesh.isGroup).toBe(true);
        const meshes = islands.mesh.getObjectsByProperty('isMesh', true);
        expect(meshes).toHaveLength(2);
        expect(meshes.length).toBeLessThanOrEqual(3);
        meshes.forEach((mesh) => {
            expect(mesh.material).toBe(islands.material);
            expect(mesh.material.isNodeMaterial).toBe(true);
            expect(mesh.material.transparent).toBe(false);
            expect(mesh.material.depthWrite).toBe(true);
            expect(mesh.renderOrder).toBeGreaterThan(0);
            expect(mesh.renderOrder).toBeLessThan(40);
            expect(mesh.parent.isGroup).toBe(true);
            expect(mesh.geometry.getAttribute('color').itemSize).toBe(4);
        });
        const state = islands.getState();
        expect(state.islands.set + state.islands.rise).toBe(ISLAND_LAYOUT.set.length + ISLAND_LAYOUT.rise.length);
        expect(state.triangles).toBeGreaterThan(20000);
        expect(state.triangles).toBeLessThan(60000);
        islands.dispose();
    });

    it('turns each group to its gate, and does nothing while the gates stand still', () => {
        const world = new SunsetWorld({ scene: new THREE.Scene(), quality: 'Low' });
        const islands = createIslands({ U: world.U });
        islands.update(0, { setAz: -25, riseAz: 32 });
        const [setMesh, riseMesh] = islands.mesh.getObjectsByProperty('isMesh', true);
        islands.mesh.updateMatrixWorld(true);
        const hero = placeIslands('set').islands.find((i) => i.shape === 'tower' && i.range < 4000);
        // A point of the hero tower's bearing, turned with its group: 25 degrees left of where
        // the group's own frame has it.
        const local = new THREE.Vector3(
            hero.range * Math.sin(hero.at * DEG),
            0,
            -hero.range * Math.cos(hero.at * DEG),
        );
        const seen = local.clone().applyMatrix4(setMesh.matrixWorld);
        expect(bearing(seen.x, seen.z)).toBeCloseTo(-25 + hero.at, 4);
        expect(Math.hypot(seen.x, seen.z)).toBeCloseTo(hero.range, 3);
        const lampsBefore = islands.lights().map((p) => ({ ...p }));
        const { version } = islands.skyline.texture;
        // The same gates again: nothing is touched.
        islands.update(5, { setAz: -25, riseAz: 32 });
        expect(islands.lights().map((p) => ({ ...p }))).toEqual(lampsBefore);
        expect(islands.skyline.texture.version).toBe(version);
        // The gates move (a layout change): both groups follow, the skyline stays as it was
        // (it is in each group's own frame).
        islands.update(6, { setAz: -18, riseAz: 21 });
        islands.mesh.updateMatrixWorld(true);
        const moved = local.clone().applyMatrix4(setMesh.matrixWorld);
        expect(bearing(moved.x, moved.z)).toBeCloseTo(-18 + hero.at, 4);
        const riseLocal = new THREE.Vector3(0, 0, -3000).applyMatrix4(riseMesh.matrixWorld);
        expect(bearing(riseLocal.x, riseLocal.z)).toBeCloseTo(21, 4);
        expect(islands.skyline.texture.version).toBe(version);
        expect(islands.getState().drawn).toEqual({ set: ISLAND_LAYOUT.set.length, rise: ISLAND_LAYOUT.rise.length });
        islands.dispose();
    });

    it('leaves out the islands that would stand in the other gate when the gates come close', () => {
        const world = new SunsetWorld({ scene: new THREE.Scene(), quality: 'Low' });
        const islands = createIslands({ U: world.U });
        // A narrow window with no board: the gates 19 degrees apart.
        islands.update(0, { setAz: -9.1, riseAz: 10 });
        const state = islands.getState();
        expect(state.drawn.set).toBeLessThan(ISLAND_LAYOUT.set.length);
        expect(state.drawn.rise).toBeLessThan(ISLAND_LAYOUT.rise.length);
        expect(state.drawn.set).toBeGreaterThan(0);
        expect(state.drawn.rise).toBeGreaterThan(0);
        // What is drawn of each group stays clear of the other gate; the skyline shows only that.
        ISLAND_GROUPS.forEach((group, row) => {
            const placed = placeIslands(group);
            const other = group === 'set' ? 19.1 : -19.1;
            placed.islands.slice(0, state.drawn[group]).forEach((island) => {
                const gap = Math.min(Math.abs(island.from - other), Math.abs(island.to - other));
                expect(gap, `${group} ${island.shape} at ${island.at}`).toBeGreaterThanOrEqual(GATE_CLEAR);
                expect((island.from - other) * (island.to - other)).toBeGreaterThan(0);
            });
            const { data } = islands.skyline.texture.image;
            for (let c = 0; c < SKYLINE.width; c += 1) {
                const offset = ((c + 0.5) / SKYLINE.width) * 2 * SKYLINE.half - SKYLINE.half;
                const mask = data[(row * SKYLINE.width + c) * 4 + 2];
                if (Math.abs(offset - other) < GATE_CLEAR - 0.2) expect(mask).toBe(0);
            }
        });
        // The lamps are those of the islands still drawn.
        expect(islands.lights().length).toBeLessThan(12);
        // The gates part again: everything is back.
        islands.update(1, { setAz: -25, riseAz: 32 });
        expect(islands.getState().drawn).toEqual({ set: ISLAND_LAYOUT.set.length, rise: ISLAND_LAYOUT.rise.length });
        islands.dispose();
    });

    it('gives lamp points round the near islands, on the side the eye sees, just over the water', () => {
        const world = new SunsetWorld({ scene: new THREE.Scene(), quality: 'Low' });
        const islands = createIslands({ U: world.U });
        islands.update(0, { setAz: -25, riseAz: 32 });
        const lamps = islands.lights();
        expect(lamps.length).toBeGreaterThanOrEqual(8);
        expect(lamps.length).toBeLessThanOrEqual(16);
        const near = [...ISLAND_LAYOUT.set, ...ISLAND_LAYOUT.rise].filter((island) => island.lamps > 0);
        expect(near.every((island) => island.range < 4000)).toBe(true);
        const models = islandModels();
        lamps.forEach((lamp) => {
            expect(lamp.y).toBeGreaterThan(1.5);
            expect(lamp.y).toBeLessThan(7);
            const gate = lamp.group === 'set' ? -25 : 32;
            const at = bearing(lamp.x, lamp.z) - gate;
            const far = Math.hypot(lamp.x, lamp.z);
            // It belongs to a near island of its group, and stands on the eye's side of its middle.
            const home = ISLAND_LAYOUT[lamp.group].filter((island) => island.lamps > 0).find((island) => {
                const reach = (models[island.shape].radius * island.scale + 6) / island.range / DEG;
                return Math.abs(at - island.at) < reach;
            });
            expect(home, `lamp at ${at.toFixed(1)} of ${lamp.group}`).toBeTruthy();
            expect(far).toBeLessThan(home.range + models[home.shape].radius * 0.4);
            expect(lamp.range).toBe(home.range);
        });
        islands.dispose();
    });

    it('bakes a grain that tiles and is the same every time', () => {
        const a = bakeIslandGrain(64, 7);
        const b = bakeIslandGrain(64, 7);
        expect(a).toEqual(b);
        expect(a).toHaveLength(64 * 64 * 4);
        let lo = 255;
        let hi = 0;
        for (let i = 0; i < a.length; i += 4) {
            lo = Math.min(lo, a[i]);
            hi = Math.max(hi, a[i]);
        }
        expect(hi - lo).toBeGreaterThan(120);
        expect(bakeIslandGrain(64, 8)).not.toEqual(a);
    });
});

describe('sunset islands: in the world', () => {
    it('is a part at every tier, on the horizon either side of both gates', () => {
        expect(SUNSET_PARTS).toContain('islands');
        QUALITY_NAMES.forEach((quality) => {
            const { world, camera } = makeWorld({ quality });
            const part = world.parts.islands;
            expect(part, quality).toBeTruthy();
            expect(world.group.children).toContain(part.mesh);
            const state = world.getState().islands;
            expect(state.shown, quality).toBe(true);
            expect(state.drawn, quality).toEqual({ set: ISLAND_LAYOUT.set.length, rise: ISLAND_LAYOUT.rise.length });
            // The world's own gates.
            const frame = frameFor(W / H, fallbackLayout(W, H));
            expect(state.setAz, quality).toBeCloseTo(frame.setAz, 3);
            expect(state.riseAz, quality).toBeCloseTo(frame.riseAz, 3);
            // The hero tower stands in the picture left of the card, on the horizon.
            part.mesh.updateMatrixWorld(true);
            const hero = placeIslands('set').islands.find((i) => i.shape === 'tower' && i.range < 4000);
            const [setMesh] = part.meshes;
            const foot = new THREE.Vector3(
                hero.range * Math.sin(hero.at * DEG),
                0,
                -hero.range * Math.cos(hero.at * DEG),
            ).applyMatrix4(setMesh.matrixWorld).project(camera);
            const x = foot.x * 0.5 + 0.5;
            const y = 0.5 - foot.y * 0.5;
            const card = fallbackLayout(W, H).cards[0];
            expect(x, quality).toBeGreaterThan(frame.setX + 0.05);
            expect(x, quality).toBeLessThan(card.x0);
            expect(y, quality).toBeGreaterThan(world.frame.horizon - 0.005);
            expect(y, quality).toBeLessThan(world.frame.horizon + 0.02);
            world.dispose();
        });
    });

    it('keeps the sun and the moon clear of every island as they set and rise', () => {
        const { world } = makeWorld();
        const tops = Object.fromEntries(ISLAND_GROUPS.map((group) => [group, skylineRow(placeIslands(group))]));
        const landAt = (group, offset) => {
            const c = Math.round(((offset + SKYLINE.half) / (2 * SKYLINE.half)) * SKYLINE.width - 0.5);
            return c >= 0 && c < SKYLINE.width ? Math.atan(tops[group].tan[c]) / DEG : 0;
        };
        const { setAz, riseAz } = world.getState();
        // Walk the low sun and the low moon through the day: where a disc is within reach of the
        // islands' height, no land stands within its width of it.
        for (let hour = 0; hour < 24; hour += 0.05) {
            world.day.pin = hour;
            world.applyHour();
            [[world.sunArc, 1.6], [world.moonArc, 1.5]].forEach(([body, radius]) => {
                if (body.el < -radius || body.el > 8) return;
                for (let d = -radius; d <= radius; d += 0.4) {
                    expect(landAt('set', body.az + d - setAz), `hour ${hour.toFixed(2)}`).toBe(0);
                    expect(landAt('rise', body.az + d - riseAz), `hour ${hour.toFixed(2)}`).toBe(0);
                }
            });
        }
        world.dispose();
    });

    it('is left out by a capture of other parts, and shown again when asked for', () => {
        const { world, step } = makeWorld();
        const part = world.parts.islands;
        expect(part.mesh.visible).toBe(true);
        world.showOnlyParts(['sky', 'sea']);
        step(0.2);
        expect(part.mesh.visible).toBe(false);
        expect(world.getState().islands.shown).toBe(false);
        world.showOnlyParts(['sky', 'sea', 'islands']);
        step(0.2);
        expect(part.mesh.visible).toBe(true);
        world.dispose();
    });

    it('follows the gates when the layout changes, and goes with the world', () => {
        const { world, scene, step } = makeWorld();
        const before = world.getState().islands;
        // The board goes (a menu): both gates come in toward the thirds of the frame.
        world.setLayout(null, W / H);
        step(8);
        const after = world.getState().islands;
        expect(after.setAz).toBeGreaterThan(before.setAz + 3);
        expect(after.riseAz).toBeLessThan(before.riseAz - 3);
        const frame = frameFor(W / H, null);
        expect(after.setAz).toBeCloseTo(frame.setAz, 1);
        expect(world.parts.islands.mesh.children[0].rotation.y).toBeCloseTo(-after.setAz * DEG, 6);
        expect(world.parts.islands.mesh.children[1].rotation.y).toBeCloseTo(-after.riseAz * DEG, 6);
        world.dispose();
        expect(scene.children).toHaveLength(0);
    });

    it('stands in a tall frame too, with nothing astride a gate', () => {
        const { world } = makeWorld({ width: 430, height: 932 });
        const state = world.getState().islands;
        expect(state.riseAz - state.setAz).toBeGreaterThan(20);
        expect(state.drawn.set).toBeGreaterThan(0);
        expect(state.drawn.rise).toBeGreaterThan(0);
        ISLAND_GROUPS.forEach((group) => {
            const other = group === 'set' ? state.riseAz - state.setAz : state.setAz - state.riseAz;
            placeIslands(group).islands.slice(0, state.drawn[group]).forEach((island) => {
                const gap = Math.min(Math.abs(island.from - other), Math.abs(island.to - other));
                expect(gap, `${group} ${island.shape} at ${island.at}`).toBeGreaterThanOrEqual(GATE_CLEAR - 1e-6);
            });
        });
        world.dispose();
    });
});
