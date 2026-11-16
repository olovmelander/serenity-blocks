/**
 * Halcyon Apex — the skyfarers: the hulls modelled in Blender, how they fly (paths, formations,
 * bearing), the three streams of traffic, the routes as the rest camera sees them, the world's
 * handling of them, and their three materials built through both node builders.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { HalcyonApexWorld, REST_RIG } from '../../src/themes/halcyon-apex/halcyon-apex-world.js';
import {
    PYRAMID_TOP, SITE, compositionFor, tierHalf, worldToSite,
} from '../../src/themes/halcyon-apex/halcyon-apex-core.js';
import { fallbackLayout } from '../../src/themes/halcyon-apex/halcyon-apex-composition.js';
import {
    LAMP_POOL,
    RIBBONS,
    SURFACE,
    VISITOR_KIND,
    VISITOR_KINDS,
    VISITOR_LAMPS,
    buildHulls,
    trailOrigin,
} from '../../src/themes/halcyon-apex/halcyon-apex-visitor-plan.js';
import {
    FIRST_VISIT,
    Flight,
    SHIP_SLOTS,
    SORTIE_NAMES,
    STREAMS,
    formation,
    makeSortie,
    quatTurn,
    slotSortie,
    sortiesAt,
    streamNames,
    visitAt,
} from '../../src/themes/halcyon-apex/halcyon-apex-flight.js';
import { VISITOR_WARM_FRAMES } from '../../src/themes/halcyon-apex/halcyon-apex-visitors.js';

vi.setConfig({ testTimeout: 120000 });

function makeWorld(quality = 'Minimal', width = 1600, height = 900) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new HalcyonApexWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    world.setLayout(fallbackLayout(width, height), width / height);
    world.seek(0);
    return { scene, camera, world };
}

function step(world, camera, time, delta = 1 / 60) {
    const sim = { time, delta };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

/** The frame the world hands the skyfarers (as world.update builds it). */
function frameOf(world) {
    const comp = compositionFor(world.aspect);
    return {
        yaw: comp.yaw,
        upright: 1 - comp.wide,
        eye: REST_RIG.height,
        halcyonTop: [world.halcyon[0], world.halcyon[1] + SITE.halcyon.half, world.halcyon[2]],
        halcyon: [...world.halcyon],
        apex: [...world.plan.apex],
    };
}

const SEEDS = [1, 2, 3, 4, 5, 6];
const SCHEDULED = [...new Set(Object.values(STREAMS).flatMap((s) => s.names))];

/** Whether a world point lies inside the pyramid's masonry (its tiers as boxes). */
function insidePyramid(p) {
    const y = p[1];
    if (y < 0 || y > PYRAMID_TOP) return false;
    const tier = Math.max(0, Math.min(SITE.pyramid.tiers - 1, Math.floor((y - SITE.pyramid.plinth) / SITE.pyramid.tierHeight)));
    const half = tierHalf(tier).foot;
    const s = worldToSite(p[0], p[2]);
    return Math.abs(s[0]) < half && Math.abs(s[1]) < half;
}

describe('the hulls', () => {
    const hulls = buildHulls();

    it('lie in one buffer, one contiguous range per kind, covering it exactly', () => {
        expect(VISITOR_KINDS).toEqual(['saucer', 'swift', 'manta', 'barge', 'ark', 'hoop', 'capsule', 'orb']);
        let vertex = 0;
        let index = 0;
        VISITOR_KINDS.forEach((name, kind) => {
            const range = hulls.ranges[kind];
            expect(range.vertex[0], name).toBe(vertex);
            expect(range.index[0], name).toBe(index);
            expect(range.vertex[1], name).toBeGreaterThan(100);
            expect(range.index[1] % 3, name).toBe(0);
            vertex += range.vertex[1];
            index += range.index[1];
            for (let i = range.vertex[0]; i < vertex; i++) expect(hulls.part[i * 4 + 2]).toBe(kind);
            for (let i = range.index[0]; i < index; i++) {
                const v = hulls.index[i];
                if (v < range.vertex[0] || v >= vertex) throw new Error(`${name}: index ${i} points at vertex ${v}, outside its hull`);
            }
        });
        expect(vertex).toBe(hulls.vertexCount);
        expect(index).toBe(hulls.indexCount);
        expect(hulls.position.length).toBe(vertex * 3);
        // One draw of every hull is a few thousand triangles: two dozen instances stay cheap.
        expect(hulls.indexCount / 3).toBeLessThan(9000);
    });

    it('face outward: every triangle winds the way its normals point, and the normals are unit length', () => {
        const { position, normal, index } = hulls;
        let against = 0;
        let counted = 0;
        for (let t = 0; t < index.length; t += 3) {
            const a = index[t] * 3;
            const b = index[t + 1] * 3;
            const c = index[t + 2] * 3;
            const ux = position[b] - position[a];
            const uy = position[b + 1] - position[a + 1];
            const uz = position[b + 2] - position[a + 2];
            const vx = position[c] - position[a];
            const vy = position[c + 1] - position[a + 1];
            const vz = position[c + 2] - position[a + 2];
            const fx = uy * vz - uz * vy;
            const fy = uz * vx - ux * vz;
            const fz = ux * vy - uy * vx;
            const area = Math.hypot(fx, fy, fz);
            if (area < 1e-5) continue;
            const nx = normal[a] + normal[b] + normal[c];
            const ny = normal[a + 1] + normal[b + 1] + normal[c + 1];
            const nz = normal[a + 2] + normal[b + 2] + normal[c + 2];
            counted += 1;
            if (fx * nx + fy * ny + fz * nz <= 0) against += 1;
        }
        expect(counted).toBeGreaterThan(5000);
        expect(against, 'triangles wound against their normals').toBe(0);
        for (let i = 0; i < normal.length; i += 3) {
            const l = Math.hypot(normal[i], normal[i + 1], normal[i + 2]);
            if (Math.abs(l - 1) > 0.02) throw new Error(`normal ${i / 3} has length ${l}`);
        }
    });

    it('are the sizes they are meant to be (metres: x the nose, y up, z starboard)', () => {
        const size = (name) => {
            const { min, max } = hulls.sizes[VISITOR_KIND[name]];
            return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
        };
        const near = (value, want, tol) => expect(Math.abs(value - want), `${value} vs ${want}`).toBeLessThan(tol);
        near(size('saucer')[0], 15, 0.2);
        near(size('saucer')[2], 15, 0.2);
        near(size('swift')[0], 21.4, 0.5);
        near(size('swift')[2], 15.6, 0.5);
        near(size('manta')[2], 44, 0.5);
        near(size('barge')[0], 34.2, 0.6);
        expect(size('ark')[0]).toBeGreaterThan(225);
        near(size('hoop')[1], 21.3, 0.6);
        near(size('capsule')[0], 13, 0.2);
        near(size('orb')[1], 2.2, 0.05);
        // A hull's nose is at +x: the swift's point is ahead of its wings, the ark's prow ahead of its stern.
        expect(hulls.sizes[VISITOR_KIND.swift].max[0]).toBeGreaterThan(8);
        expect(hulls.sizes[VISITOR_KIND.ark].max[0]).toBeGreaterThan(-hulls.sizes[VISITOR_KIND.ark].min[0]);
    });

    it('name what every vertex is made of, with its occlusion baked', () => {
        const known = new Set(Object.values(SURFACE));
        const used = new Set();
        let shaded = 0;
        for (let i = 0; i < hulls.vertexCount; i++) {
            const surface = hulls.part[i * 4];
            expect(known.has(surface)).toBe(true);
            used.add(surface);
            const param = hulls.part[i * 4 + 1];
            const ao = hulls.part[i * 4 + 3];
            if (param < 0 || param > 1 || ao < 0 || ao > 1) throw new Error(`vertex ${i}: param ${param}, occlusion ${ao}`);
            if (ao < 0.8) shaded += 1;
        }
        // Every surface the shader knows is flown by some hull, and the hulls shade themselves somewhere.
        expect(used.size).toBe(known.size);
        expect(shaded).toBeGreaterThan(hulls.vertexCount * 0.08);
        expect(shaded).toBeLessThan(hulls.vertexCount * 0.8);
    });

    it('carry their lamps on the hull, and a trail leaves every hull that has engines', () => {
        VISITOR_KINDS.forEach((name) => {
            const { min, max } = hulls.sizes[VISITOR_KIND[name]];
            VISITOR_LAMPS[name].forEach((lamp) => {
                for (let c = 0; c < 3; c++) {
                    expect(lamp.at[c], `${name} ${lamp.group}`).toBeGreaterThan(min[c] - 2.5);
                    expect(lamp.at[c], `${name} ${lamp.group}`).toBeLessThan(max[c] + 2.5);
                }
                expect(lamp.size).toBeGreaterThan(0);
            });
        });
        expect(VISITOR_LAMPS.saucer.filter((l) => l.group === 'rim')).toHaveLength(12);
        expect(VISITOR_LAMPS.barge.filter((l) => l.group === 'cargo')).toHaveLength(6);
        expect(VISITOR_LAMPS.manta.find((l) => l.group === 'core').at[1]).toBeLessThan(-1);
        ['swift', 'manta', 'barge', 'ark', 'orb'].forEach((name) => expect(trailOrigin(name), name).toBeTruthy());
        // The swift's trail leaves between its two engines, behind it.
        expect(trailOrigin('swift')[0]).toBeLessThan(-6);
        expect(Math.abs(trailOrigin('swift')[2])).toBeLessThan(0.01);
        expect(trailOrigin('saucer')).toBeNull();
    });
});

describe('the traffic', () => {
    it('opens with swifts skimming the lagoon some fifteen seconds in, the slow manta under reduced motion', () => {
        expect(slotSortie('hero', 0)).toMatchObject({ start: FIRST_VISIT });
        expect(slotSortie('hero', 0).sortie.name).toBe('skim');
        expect(slotSortie('hero', 0, true).sortie.name).toBe('ray');
        expect(visitAt(FIRST_VISIT - 0.01)).toBeNull();
        expect(visitAt(FIRST_VISIT + 1).route.name).toBe('skim');
    });

    it('keeps the sky alive without crowding it: a sortie or two at a time, never more hulls than it can draw', () => {
        let sum = 0;
        let empty = 0;
        let most = 0;
        let mostHeroes = 0;
        const seen = new Set();
        const span = 7200;
        for (let t = 0; t < span; t += 1) {
            const now = sortiesAt(t);
            sum += now.length;
            if (!now.length) empty += 1;
            most = Math.max(most, now.reduce((n, s) => n + s.sortie.ships.length, 0));
            mostHeroes = Math.max(mostHeroes, now.filter((s) => s.stream === 'hero').length);
            now.forEach((s) => seen.add(s.sortie.name));
        }
        expect(sum / span).toBeGreaterThan(0.8);
        expect(sum / span).toBeLessThan(2.4);
        // Something is in the sky most of the time, and it is never crowded.
        expect(empty / span).toBeLessThan(0.4);
        expect(most).toBeLessThanOrEqual(SHIP_SLOTS - 7); // room left for a salute of seven
        expect(mostHeroes).toBe(1);
        SCHEDULED.forEach((name) => expect(seen.has(name), name).toBe(true));
    });

    it('is a function of the clock alone', () => {
        for (let t = 0; t < 900; t += 13.7) {
            const a = sortiesAt(t).map((s) => [s.sortie.name, s.start, s.age]);
            const b = sortiesAt(t).map((s) => [s.sortie.name, s.start, s.age]);
            expect(a).toEqual(b);
        }
        expect(slotSortie('mid', 7)).toBe(slotSortie('mid', 7));
        expect(makeSortie('flyby', 42).keys).toEqual(makeSortie('flyby', 42).keys);
    });

    it('never flies the same pass twice: a stream turns through its sorties, each drawn afresh', () => {
        Object.keys(STREAMS).forEach((stream) => {
            let last = null;
            let repeats = 0;
            const byName = {};
            for (let k = 0; k < 120; k++) {
                const plan = slotSortie(stream, k);
                // (An empty slot between two of the same name is half a minute of other sky.)
                if (!plan) {
                    last = null;
                    continue;
                }
                if (last === plan.sortie.name) repeats += 1;
                last = plan.sortie.name;
                (byName[last] ||= []).push(plan.sortie);
            }
            // The far stream's couriers are meant to come often; no other name runs twice in a row.
            if (stream !== 'far') expect(repeats, stream).toBe(0);
            Object.keys(byName).forEach((name) => {
                const drawn = new Set(byName[name].map((s) => JSON.stringify([s.keys, s.ships.length])));
                // The four the sanctuary has always had fly as they always did.
                const fixed = ['saucer', 'halcyon', 'orbs', 'capsule', 'hang', 'dock'].includes(name);
                if (!fixed) expect(drawn.size, `${stream}/${name}`).toBe(byName[name].length);
            });
        });
        // The same name with another seed is another flight: side, height, numbers, formation.
        const counts = new Set(SEEDS.map((seed) => makeSortie('flyby', seed).ships.length));
        expect(counts.size).toBeGreaterThan(1);
    });

    it('flies only the slow sorties under reduced motion', () => {
        Object.keys(STREAMS).forEach((stream) => {
            const names = streamNames(stream, true);
            expect(names.length, stream).toBeGreaterThan(0);
            names.forEach((name) => expect(makeSortie(name, 1).calm, name).toBe(true));
            for (let k = 0; k < 40; k++) {
                const plan = slotSortie(stream, k, true);
                if (plan) expect(plan.sortie.calm, plan.sortie.name).toBe(true);
            }
        });
        expect(streamNames('hero', true)).toEqual(expect.arrayContaining(['ray', 'hang', 'rite', 'dock']));
    });
});

describe('how they fly', () => {
    const frame = { yaw: 0, eye: REST_RIG.height, upright: 0 };

    it('every sortie holds its hulls over the water, out of the masonry, on a finite bearing', () => {
        SORTIE_NAMES.forEach((name) => {
            SEEDS.forEach((seed) => {
                const sortie = makeSortie(name, seed);
                const flight = new Flight(sortie, frame);
                for (let age = 0; age <= sortie.duration; age += 0.1) {
                    for (let i = 0; i < sortie.ships.length; i++) {
                        const pose = flight.pose(i, age);
                        const label = `${name}#${seed} ship ${i} at ${age.toFixed(1)}`;
                        if (![...pose.p, ...pose.q, pose.speed, pose.throttle].every(Number.isFinite)) throw new Error(`${label}: not finite`);
                        const length = Math.hypot(...pose.q);
                        if (Math.abs(length - 1) > 1e-3) throw new Error(`${label}: bearing of length ${length}`);
                        if (pose.presence > 0.05) {
                            if (pose.p[1] < 1.6) throw new Error(`${label}: ${pose.p[1].toFixed(2)} m over the water`);
                            if (insidePyramid(pose.p)) throw new Error(`${label}: inside the pyramid at ${pose.p.map((v) => v.toFixed(0))}`);
                        }
                    }
                }
            });
        });
    });

    it('flies smoothly: no jump between frames except where a hull leaves in a blink or a break throws it', () => {
        SORTIE_NAMES.forEach((name) => {
            const sortie = makeSortie(name, 2);
            const flight = new Flight(sortie, frame);
            const until = Math.min(sortie.warp ?? Infinity, sortie.breakAt ?? Infinity, sortie.duration);
            for (let i = 0; i < sortie.ships.length; i++) {
                let last = [...flight.shipPoint(i, 0)];
                for (let age = 1 / 120; age < until; age += 1 / 120) {
                    const p = flight.shipPoint(i, age);
                    const moved = Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]);
                    // 1/120 s at the fastest anything moves (the capsule's hops, the salute overhead).
                    if (moved > 4.5) throw new Error(`${name} ship ${i} at ${age.toFixed(2)}: moved ${moved.toFixed(1)} m in a frame`);
                    last = [...p];
                }
            }
        });
    });

    it('points a swift along its flight, banks it into a turn and flies a loop upside down over the top', () => {
        const nose = [0, 0, 0];
        const up = [0, 0, 0];
        // Along its flight: the nose (hull +x) lies on the velocity.
        const lane = makeSortie('lane', 3);
        const laneFlight = new Flight(lane, frame);
        const mid = lane.duration * 0.5;
        const a = [...laneFlight.shipPoint(0, mid - 0.05)];
        const b = [...laneFlight.shipPoint(0, mid + 0.05)];
        const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const vl = Math.hypot(...v);
        quatTurn(laneFlight.pose(0, mid).q, [1, 0, 0], nose);
        expect((nose[0] * v[0] + nose[1] * v[1] + nose[2] * v[2]) / vl).toBeGreaterThan(0.999);
        // On a straight path it flies level: its up is the world's.
        quatTurn(laneFlight.pose(0, mid).q, [0, 1, 0], up);
        expect(up[1]).toBeGreaterThan(0.97);

        // Round the Apex it leans into the turn: its up tips toward the crystal.
        const orbit = makeSortie('orbit', 2);
        const orbitFlight = new Flight(orbit, { ...frame, apex: [-104, 104, -227] });
        const turning = orbit.keys[4].t;
        const pose = orbitFlight.pose(0, turning);
        quatTurn(pose.q, [0, 1, 0], up);
        const toApex = [-104 - pose.p[0], 0, -227 - pose.p[2]];
        const tl = Math.hypot(...toApex);
        expect((up[0] * toApex[0] + up[2] * toApex[2]) / tl).toBeGreaterThan(0.3);
        expect(up[1]).toBeLessThan(0.95);

        // Over the top of a loop its belly is to the sky.
        const loop = makeSortie('loop', 1);
        const loopFlight = new Flight(loop, frame);
        let highest = 0;
        let topAge = 0;
        for (let age = loop.keys[2].t; age <= loop.keys[10].t; age += 0.02) {
            const y = loopFlight.shipPoint(0, age)[1];
            if (y > highest) {
                highest = y;
                topAge = age;
            }
        }
        quatTurn(loopFlight.pose(0, topAge).q, [0, 1, 0], up);
        expect(up[1]).toBeLessThan(-0.7);
        // Half a loop more, a roll at the top, and it leaves the right way up, back the way it came.
        quatTurn(loopFlight.pose(0, loop.duration - 1.5).q, [0, 1, 0], up);
        expect(up[1]).toBeGreaterThan(0.5);
        const leaving = loopFlight.shipPoint(0, loop.duration - 0.5)[0] - loopFlight.shipPoint(0, loop.duration - 1.5)[0];
        expect(leaving).toBeLessThan(0);
    });

    it('keeps a formation together: wingmen hold their places off the leader through a turn', () => {
        expect(formation('vee', 5, 20)).toHaveLength(5);
        ['vee', 'echelon', 'abreast', 'astern', 'diamond', 'stack'].forEach((shape) => {
            const ships = formation(shape, 4, 20);
            expect(ships[0]).toEqual({ right: 0, up: 0, back: 0 });
            // No two ships share a place.
            for (let i = 0; i < ships.length; i++) {
                for (let j = i + 1; j < ships.length; j++) {
                    const d = Math.hypot(ships[i].right - ships[j].right, ships[i].up - ships[j].up, ships[i].back - ships[j].back);
                    expect(d, `${shape} ${i}/${j}`).toBeGreaterThan(8);
                }
            }
        });
        const flyby = { ...makeSortie('flyby', 2), breakAt: undefined, rolls: undefined };
        const flight = new Flight(flyby, frame);
        for (let i = 1; i < flyby.ships.length; i++) {
            const ship = flyby.ships[i];
            const want = Math.hypot(ship.right, ship.up, ship.back);
            for (let age = 0.5; age < flyby.duration - 0.5; age += 0.5) {
                const lead = [...flight.shipPoint(0, age)];
                const p = flight.shipPoint(i, age);
                const gap = Math.hypot(p[0] - lead[0], p[1] - lead[1], p[2] - lead[2]);
                expect(Math.abs(gap - want), `ship ${i} at ${age}`).toBeLessThan(want * 0.25 + 1);
            }
        }
    });

    it('fans a salute across the sky: every swift on its own bearing, clear of the card, trailing sunfire', () => {
        const salute = makeSortie('salute', 1);
        expect(salute.ships).toHaveLength(5);
        expect(salute.tint).toBe('sunfire');
        expect(makeSortie('salute', 1, { count: 7 }).ships).toHaveLength(7);
        const flight = new Flight(salute, frame);
        const bearings = salute.ships.map((_, i) => {
            const p = flight.shipPoint(i, 3.6);
            return Math.atan2(p[0], -p[2]) / (Math.PI / 180);
        });
        bearings.forEach((az) => expect(Math.abs(az)).toBeGreaterThan(11));
        expect(Math.min(...bearings)).toBeLessThan(-25);
        expect(Math.max(...bearings)).toBeGreaterThan(25);
        // They come from behind the viewer and end high over the horizon.
        expect(flight.shipPoint(0, 0)[2]).toBeGreaterThan(100);
        expect(flight.shipPoint(0, salute.duration)[1]).toBeGreaterThan(600);
    });

    it('hangs the ring-ship over the Halcyon and the saucer in its beam, face to the eye', () => {
        const halcyonTop = [70, 52, -135];
        const rite = makeSortie('rite', 4);
        const flight = new Flight(rite, { ...frame, halcyonTop });
        const pose = flight.pose(0, 10);
        expect(flight.beam(10)).toBeGreaterThan(0.99);
        expect(flight.beam(2)).toBe(0);
        expect(pose.p[1]).toBeGreaterThan(halcyonTop[1] + 14);
        expect(Math.hypot(pose.p[0] - halcyonTop[0], pose.p[2] - halcyonTop[2])).toBeLessThan(1.5);
        // Arriving, its ring (whose axis is the hull's z) faces the eye.
        const axis = quatTurn(flight.pose(0, 7.2).q, [0, 0, 1]);
        expect(Math.abs(axis[2])).toBeGreaterThan(0.9);
        const beam = makeSortie('halcyon', 1);
        expect(new Flight(beam, { ...frame, halcyonTop }).beam(8)).toBeGreaterThan(0.99);
    });
});

describe('the routes, as the rest camera sees them', () => {
    const { world } = makeWorld();
    const camera = world.restCamera();
    const layout = fallbackLayout(1600, 900);
    const card = layout.cards[0];
    const { hud } = layout;
    const frame = frameOf(world);
    const ndc = new THREE.Vector3();
    /** Where a world point shows (fractions, y down), or null off screen / behind. */
    const screen = (p, cam = camera) => {
        ndc.set(p[0], p[1], p[2]).project(cam);
        if (ndc.z > 1 || Math.abs(ndc.x) > 0.98 || Math.abs(ndc.y) > 0.98) return null;
        return { x: ndc.x * 0.5 + 0.5, y: 0.5 - ndc.y * 0.5 };
    };
    const inside = (s, r) => s.x > r.x0 && s.x < r.x1 && s.y > r.y0 && s.y < r.y1;
    /** Seconds some hull of the sortie is in view, clear of the card and the HUD. */
    const secondsSeen = (sortie, f, cam, rects) => {
        const flight = new Flight(sortie, f);
        let clear = 0;
        const dt = 0.05;
        for (let age = 0; age <= sortie.duration; age += dt) {
            let any = false;
            for (let i = 0; i < sortie.ships.length && !any; i++) {
                const pose = flight.pose(i, age);
                const s = screen(pose.p, cam);
                any = Boolean(s) && pose.presence > 0.5 && !rects.some((r) => r && inside(s, r));
            }
            if (any) clear += dt;
        }
        return clear;
    };

    it.each(SCHEDULED.map((name) => [name]))('%s is seen clear of the card and the HUD for a while, whatever its seed', (name) => {
        const least = {
            ark: 12, convoy: 9, lane: 4, glide: 3, haul: 3, ray: 4, hang: 9, dock: 12, rite: 6, loop: 4, spire: 4,
        }[name] ?? 2.4;
        SEEDS.forEach((seed) => {
            const seen = secondsSeen(makeSortie(name, seed), frame, camera, [card, hud]);
            expect(seen, `${name}#${seed}: ${seen.toFixed(1)} s in view`).toBeGreaterThan(least);
        });
    });

    it('rise into the sky over the card on an upright screen', () => {
        const { world: tall } = makeWorld('Minimal', 430, 850);
        const cam = tall.restCamera();
        const tallCard = fallbackLayout(430, 850).cards[0];
        const tallFrame = frameOf(tall);
        expect(tallFrame.upright).toBeGreaterThan(0.99);
        let shown = 0;
        const heroes = STREAMS.hero.names;
        heroes.forEach((name) => {
            const seen = secondsSeen(makeSortie(name, 1), tallFrame, cam, [tallCard]);
            if (seen > 2) shown += 1;
        });
        // The Halcyon is off the edge of an upright frame: most heroes still show, not all.
        expect(shown).toBeGreaterThanOrEqual(heroes.length - 4);
        tall.dispose();
    });

    it('keeps the near hulls out of the glare round the sun', () => {
        const { sun } = world.getState();
        const sunAz = Math.atan2(sun[0], -sun[2]);
        const sunEl = Math.asin(sun[1]);
        ['ray', 'trio', 'loop', 'spire', 'dock'].forEach((name) => {
            SEEDS.forEach((seed) => {
                const sortie = makeSortie(name, seed);
                const flight = new Flight(sortie, frame);
                for (let age = 0; age <= sortie.duration; age += 0.1) {
                    const pose = flight.pose(0, age);
                    const d = Math.hypot(pose.p[0], pose.p[2]);
                    if (pose.presence < 0.5 || d > 400) continue;
                    const az = Math.atan2(pose.p[0], -pose.p[2]);
                    const el = Math.atan2(pose.p[1] - REST_RIG.height, d);
                    const off = Math.hypot((az - sunAz) * Math.cos(sunEl), el - sunEl) / (Math.PI / 180);
                    if (off < 7) throw new Error(`${name}#${seed} at ${age.toFixed(1)}: ${off.toFixed(1)} degrees off the sun`);
                }
            });
        });
    });
});

describe('the world and its skyfarers', () => {
    it('builds the three parts on every tier, in the lagoon\'s mirror', () => {
        ['Minimal', 'High'].forEach((quality) => {
            const { world } = makeWorld(quality);
            ['visitors', 'visitorTrails', 'visitorLights'].forEach((name) => {
                expect(world.parts[name], `${quality} ${name}`).toBeTruthy();
                expect(world.parts[name].mesh.layers.mask).toBe(1);
                expect(world.parts[name].mesh.castShadow).toBe(false);
            });
            world.dispose();
        });
    });

    it('draws a hull out of sight while the pipelines are built, then nothing while the sky is empty', () => {
        const { world, camera } = makeWorld();
        world.setTraffic(false);
        const hulls = world.parts.visitors;
        step(world, camera, 1);
        expect(hulls.mesh.visible).toBe(true);
        expect(hulls.geometry.instanceCount).toBe(1);
        for (let i = 0; i < VISITOR_WARM_FRAMES + 5; i++) step(world, camera, 1 + i / 60);
        expect(hulls.mesh.visible).toBe(false);
        expect(world.parts.visitorLights.mesh.visible).toBe(false);
        expect(world.parts.visitorTrails.mesh.visible).toBe(false);
        expect(world.getState().visitor).toBeNull();
        world.dispose();
    });

    it('shows the scheduled sorties, one instance a hull, the same after a seek as after a run', () => {
        const { world, camera } = makeWorld();
        const t = FIRST_VISIT + 4.4;
        for (let time = 0; time <= t; time += 1 / 30) step(world, camera, time, 1 / 30);
        step(world, camera, t, 0);
        const state = world.getState().visitor;
        expect(state).toMatchObject({ route: 'skim', kind: 'swift' });
        expect(state.sorties).toContain('skim');
        const want = sortiesAt(t).reduce((n, s) => n + s.sortie.ships.length, 0);
        expect(state.ships).toBe(want);
        expect(world.parts.visitors.geometry.instanceCount).toBe(want);
        expect(state.lamps).toBeGreaterThan(0);
        expect(state.lamps).toBeLessThanOrEqual(LAMP_POOL);
        expect(state.ribbons).toBeGreaterThan(0);
        expect(state.ribbons).toBeLessThanOrEqual(RIBBONS);
        expect(world.parts.visitors.mesh.visible).toBe(true);
        const ran = [...state.at];

        world.seek(t);
        step(world, camera, t, 0);
        const again = world.getState().visitor;
        expect(again.at).toEqual(ran);
        expect(again.ships).toBe(want);
        world.dispose();
    });

    it('flies a called sortie beside the schedule, and a seek forgets it', () => {
        const { world, camera } = makeWorld();
        world.setTraffic(false);
        expect(world.callVisitor('nobody', 30)).toBe(false);
        expect(world.callVisitor('ark', 30, 3)).toBe(true);
        // The same call twice is one flight.
        expect(world.callVisitor('ark', 30, 3)).toBe(true);
        step(world, camera, 44);
        const state = world.getState().visitor;
        expect(state).toMatchObject({ route: 'ark', kind: 'ark' });
        expect(state.ships).toBe(makeSortie('ark', 3).ships.length);
        world.seek(44);
        step(world, camera, 44);
        expect(world.getState().visitor).toBeNull();
        world.dispose();
    });

    it('never draws more hulls, lamps or ribbons than it has, however much is called', () => {
        const { world, camera } = makeWorld();
        ['ark', 'convoy', 'flyby', 'trio', 'string', 'salute'].forEach((name, i) => world.callVisitor(name, 20 + i * 0.01, 2 + i, name === 'salute' ? { count: 7 } : undefined));
        for (let time = 20; time < 30; time += 0.25) {
            step(world, camera, time, 0.25);
            const state = world.getState().visitor;
            if (!state) continue;
            expect(state.ships).toBeLessThanOrEqual(SHIP_SLOTS);
            expect(state.lamps).toBeLessThanOrEqual(LAMP_POOL);
            expect(state.ribbons).toBeLessThanOrEqual(RIBBONS);
            expect(world.parts.visitors.geometry.instanceCount).toBe(state.ships);
        }
        world.dispose();
    });

    it('lets a craft touch the sanctuary: spray under a skim, cargo poured into the causeway, a beam the Halcyon keeps', () => {
        const { world, camera } = makeWorld('Low');
        world.setTraffic(false);
        // A skim throws spray where it runs low.
        const sparks = world.parts.sparks.geometry.getAttribute('aBirth').array;
        const live = () => {
            let n = 0;
            for (let i = 3; i < sparks.length; i += 4) if (sparks[i] > 0) n += 1;
            return n;
        };
        world.callVisitor('skim', 10, 1);
        for (let time = 10; time < 18; time += 1 / 30) step(world, camera, time, 1 / 30);
        expect(live()).toBeGreaterThan(20);

        // A barge's cargo runs the causeway's ley line into the Apex.
        world.seek(40);
        world.setTraffic(false);
        world.callVisitor('dock', 40, 1);
        const before = world.getState().counts.pulses;
        for (let time = 40; time < 62; time += 1 / 20) step(world, camera, time, 1 / 20);
        expect(world.getState().counts.pulses - before).toBe(6);
        expect(world.getState().held[0]).toBeGreaterThan(1);

        // The ring-ship's beam fills the Halcyon.
        world.seek(100);
        world.callVisitor('rite', 100, 1);
        for (let time = 100; time < 116; time += 1 / 20) step(world, camera, time, 1 / 20);
        expect(world.getState().held[1]).toBeGreaterThan(1);
        world.dispose();
    });
});

// ── The three materials through both node builders ──────────────────────────────

function stubRenderer() {
    return {
        contextNode: context(),
        lighting: { enabled: false },
        backend: {
            device: null,
            capabilities: { getUniformBufferLimit: () => 65536 },
            extensions: { has: () => false },
            utils: { getTextureSampleData: () => ({ samples: 1, primarySamples: 1, isMSAA: false }) },
            compatibilityMode: false,
        },
        getRenderTarget: () => null,
        getMRT: () => null,
        shadowMap: { enabled: false, type: 0 },
        capabilities: {},
        library: { fromMaterial: (m) => m },
        nodes: {},
        getOutputRenderTarget: () => null,
        currentColorSpace: 'srgb',
        outputColorSpace: 'srgb',
        toneMapping: 0,
        xr: { enabled: false },
        debug: { checkShaderErrors: false, diagnostics: { keywords: true } },
        getUniformBufferLimit: () => 65536,
        hasFeature: () => false,
        isOutputTarget: false,
        logarithmicDepthBuffer: false,
        reverseDepth: false,
        highPrecision: false,
    };
}

function build(Builder, object) {
    const builder = new Builder(object, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = object.material;
    builder.material = object.material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

/** Reads of a var (or a normal builtin) where no assignment to it has certainly run. */
function unassignedReads(wgsl) {
    const NAMES = /\b(nodeVar\d+|normalViewGeometry|normalView|normalWorld)\b/g;
    const found = [];
    let stack = null;
    let header = false;
    wgsl.split('\n').forEach((raw, index) => {
        const line = raw.trim();
        if (!stack) {
            if (/^fn \w+\s*\(/.test(line)) header = true;
            if (header && /\{$/.test(line)) {
                header = false;
                stack = [{ kind: 'fn', set: new Set() }];
            }
            return;
        }
        const check = (text) => {
            (text.match(NAMES) || []).forEach((name) => {
                if (stack.some((block) => block.set.has(name))) return;
                found.push(`${name}, line ${index + 1}: ${line.slice(0, 120)}`);
            });
        };
        if (/^if\s*\(.*\)\s*\{$/.test(line)) {
            check(line);
            stack.push({ kind: 'if', set: new Set() });
        } else if (/^\}\s*else\s*\{$/.test(line)) {
            const branch = stack.pop();
            stack.push({ kind: 'else', set: new Set(), ifSet: branch.set });
        } else if (/^(for\s*\(.*\)|loop)\s*\{$/.test(line)) {
            check(line);
            stack.push({ kind: 'loop', set: new Set() });
        } else if (line === '}') {
            const block = stack.pop();
            if (block.kind === 'fn') stack = null;
            else if (block.kind === 'else') {
                block.set.forEach((name) => {
                    if (block.ifSet.has(name)) stack[stack.length - 1].set.add(name);
                });
            }
        } else if (!/^var\s+\w+\s*:[^=]*;$/.test(line)) {
            const assignment = line.match(/^(?:var\s+)?(nodeVar\d+|normalViewGeometry|normalView|normalWorld)\s*(?::[^=]*)?=(?!=)\s*(.*)$/);
            if (assignment) {
                check(assignment[2]);
                stack[stack.length - 1].set.add(assignment[1]);
            } else check(line);
        }
    });
    return found;
}

describe('the skyfarers\' materials', () => {
    const { world } = makeWorld('High');
    const parts = ['visitors', 'visitorTrails', 'visitorLights'].map((name) => [name, world.parts[name].mesh]);

    it.each(parts)('%s builds on WGSL and GLSL without a word, NaN, equal edges or an unassigned read', (name, mesh) => {
        [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([label, Builder]) => {
            const heard = [];
            const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 300));
            const warn = vi.spyOn(console, 'warn').mockImplementation(listen);
            const error = vi.spyOn(console, 'error').mockImplementation(listen);
            let out;
            try {
                out = build(Builder, mesh);
            } finally {
                warn.mockRestore();
                error.mockRestore();
            }
            expect(heard, `${name} ${label}`).toEqual([]);
            ['vertex', 'fragment'].forEach((stage) => {
                const code = out[stage];
                expect(code.length, `${name} ${label} ${stage}`).toBeGreaterThan(200);
                expect(Buffer.byteLength(code), `${name} ${label} ${stage} size`).toBeLessThan(48 * 1024);
                expect(code, `${name} ${label} ${stage}`).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                const equal = [...code.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)].filter((m) => Number(m[1]) === Number(m[2]));
                expect(equal, `${name} ${label} ${stage}`).toEqual([]);
            });
            if (label === 'WGSL') expect(unassignedReads(out.fragment), name).toEqual([]);
        });
    });

    it('draws the whole fleet with one hull pipeline: a table of rows, a vertex of another kind thrown out', () => {
        const { vertex } = build(THREE.WGSLNodeBuilder, world.parts.visitors.mesh);
        // The instance's rows are read by its index, and the clip position is a mix with a point outside the volume.
        expect(vertex).toMatch(/instanceIndex|instance_index/);
        expect(vertex).toMatch(/vec4<f32>\(\s*0(\.0)?\s*,\s*0(\.0)?\s*,\s*2(\.0)?\s*,\s*1(\.0)?\s*\)/);
        world.dispose();
    });
});
