/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — the living tarn: the night's weather and visitors, what the bigger moments of play
 * set off, and the two's lights on the water, driven through the real world without a GPU.
 *
 * (The world's own long test file pins play with the weather held still. This one pins what
 * turns by itself and what the two do across the water; the figures are read from their real
 * files, as there.)
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, StillwaterWorld, WAITING_PARTS, fovForAspect,
} from '../../src/themes/stillwater/stillwater-world.js';
import {
    DEG, HOURS, HUSH_HOLD, METEOR_SLOTS, PULSE_SPEED, SPIRIT, TROLL,
} from '../../src/themes/stillwater/stillwater-core.js';
import { fallbackLayout } from '../../src/themes/stillwater/stillwater-composition.js';
import {
    AIRS, AIR_NAMES, AIR_SECONDS, VISITOR_SPAN, airOfSlot, visitorsBetween,
} from '../../src/themes/stillwater/stillwater-night.js';
import {
    FLIGHT, PILLAR, PILLARS, duckAt,
} from '../../src/themes/stillwater/stillwater-air.js';
import {
    MOOSE, MOOSE_BEATS, MOOSE_SPAN, mooseAt,
} from '../../src/themes/stillwater/stillwater-moose.js';
import { BIRDS, birdGeometry, foldWing } from '../../src/themes/stillwater/stillwater-birds.js';
import { PLACES } from '../../src/themes/stillwater/stillwater-life.js';
import { shoreDistance } from '../../src/themes/stillwater/stillwater-plan.js';

vi.setConfig({ testTimeout: 60000 });

const sculpt = vi.hoisted(() => ({ bytes: {} }));
vi.mock('three/addons/loaders/GLTFLoader.js', async (importOriginal) => {
    const actual = await importOriginal();
    const { readFileSync } = await import('node:fs');
    return {
        GLTFLoader: class {
            loadAsync(url) {
                const name = String(url).match(/(?:troll|spirit)-lod\d\.glb|moose\.glb/)?.[0];
                if (!name) return Promise.reject(new Error(`no figure file at ${url}`));
                if (!sculpt.bytes[name]) {
                    const bytes = readFileSync(new URL(`../../src/themes/stillwater/assets/${name}`, import.meta.url));
                    sculpt.bytes[name] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                }
                return new Promise((resolve, reject) => {
                    new actual.GLTFLoader().parse(sculpt.bytes[name], '', resolve, reject);
                });
            }
        },
    };
});

function frame(world, camera, time, delta) {
    const sim = { time, delta };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

/** A world at rest at `start`; `night` lets the weather turn and the visitors come by the clock. */
function makeWorld(quality = 'Low', {
    width = 1600, height = 900, start = 10, drift = false, night = false,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new StillwaterWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setHourDrift(drift);
    if (!night) {
        world.setAirHold('still');
        world.setVisitors(false);
    }
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    world.seek(start);
    frame(world, camera, start, 0);
    return { camera, world };
}

async function makeFiguredWorld(quality = 'Low', options = {}) {
    const made = makeWorld(quality, options);
    await expect(made.world.prepare()).resolves.toBe(true);
    const start = options.start ?? 10;
    made.world.seek(start);
    frame(made.world, made.camera, start, 0);
    return made;
}

function run(world, camera, seconds, fps = 30, each = null) {
    const steps = Math.max(1, Math.round(seconds * fps));
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        frame(world, camera, t0 + i / fps, 1 / fps);
        if (each) each(i);
    }
}

function recordRings(world) {
    const rings = [];
    const original = world.ring.bind(world);
    world.ring = (x, z, time, strength, rgb, reach) => {
        rings.push({
            x, z, time, strength, edge: shoreDistance(x / world.squeeze, z),
        });
        return original(x, z, time, strength, rgb, reach);
    };
    return rings;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('stillwater tarn: the night\'s own weather', () => {
    it('lays each air on the hour: how thick the mist, how many stars, what crosses the moon, the rain', () => {
        const { camera, world } = makeWorld('High');
        const { u } = world;
        const rest = { mist: u.mist.value, stars: u.stars.value, wind: u.wind.value };
        for (const name of AIR_NAMES) {
            world.setAirHold(name);
            frame(world, camera, world.time + 1 / 60, 1 / 60);
            expect(u.mist.value, name).toBeCloseTo(rest.mist * AIRS[name].mist, 6);
            expect(u.stars.value, name).toBeCloseTo(Math.max(0, rest.stars + AIRS[name].stars), 6);
            expect(u.cloud.value, name).toBe(AIRS[name].cloud);
            expect(u.rain.value, name).toBe(AIRS[name].rain);
            expect(u.wind.value, name).toBeCloseTo(rest.wind + AIRS[name].wind, 6);
            // The rain's streaks are drawn only while it rains.
            expect(world.parts.rain.mesh.visible, name).toBe(AIRS[name].rain > 0);
            expect(world.getState()).toMatchObject({ air: name, airTo: name, airMelt: 0 });
        }
        // The still air is the hour's own picture.
        world.setAirHold('still');
        frame(world, camera, world.time + 1 / 60, 1 / 60);
        expect(u.mist.value).toBe(rest.mist);
        expect(u.stars.value).toBe(rest.stars);
        // A tier with no streaks still rains (the rings are the water's own).
        const low = makeWorld('Minimal');
        expect(low.world.parts.rain).toBeUndefined();
        low.world.setAirHold('rain');
        expect(() => run(low.world, low.camera, 1)).not.toThrow();
        expect(low.world.u.rain.value).toBe(1);
        low.world.dispose();
        world.dispose();
    });

    it('turns by its own clock when left to, the same in two worlds, and a seek lands on the same air', () => {
        const first = makeWorld('Low', { night: true });
        expect(first.world.getState().air).toBe('still');
        const second = makeWorld('Low', { night: true, start: AIR_SECONDS * 2.3 });
        expect(second.world.getState().air).toBe(airOfSlot(2));
        first.world.seek(AIR_SECONDS * 2.3);
        frame(first.world, first.camera, AIR_SECONDS * 2.3, 0);
        for (const key of ['mist', 'stars', 'cloud', 'rain']) {
            expect(first.world.u[key].value, key).toBe(second.world.u[key].value);
        }
        first.world.dispose();
        second.world.dispose();
    });

    it('moves the moon with the hour: low and large at moonrise, high and small at midnight', () => {
        const { camera, world } = makeWorld('Low');
        const seen = [];
        for (let level = 1; level <= HOURS.length; level++) {
            world.levelUp(level, { silent: true });
            frame(world, camera, world.time + 1 / 60, 1 / 60);
            const hour = HOURS[level - 1];
            const elevation = Math.asin(world.u.moonDir.value.y) / DEG;
            expect(elevation, hour.name).toBeCloseTo(hour.moonEl, 6);
            expect(world.u.moonSize.value, hour.name).toBe(hour.moonSize);
            expect(world.getState().moonEl, hour.name).toBeCloseTo(hour.moonEl, 6);
            seen.push({ elevation, y: world.getPostState().moon.y, size: hour.moonSize });
        }
        // The first hour is the picture the theme is known by.
        expect(seen[0].elevation).toBeCloseTo(10.5, 6);
        expect(seen[0].size).toBe(1);
        // Higher in the sky is higher on the screen, and the post is told where it stands THIS frame.
        const byHeight = [...seen].sort((a, b) => a.elevation - b.elevation);
        for (let i = 1; i < byHeight.length; i++) expect(byHeight[i].y).toBeLessThan(byHeight[i - 1].y);
        // It stays in the strip of sky the frame shows over the far wood, and looks larger the lower it stands.
        seen.forEach((s) => {
            expect(s.elevation).toBeGreaterThan(7);
            expect(s.elevation).toBeLessThan(15);
            expect(s.y).toBeGreaterThan(0.02);
        });
        expect(byHeight[0].size).toBeGreaterThan(byHeight.at(-1).size);
        world.dispose();
        // A narrow frame still lifts it into the sky over the card.
        const tall = makeWorld('Low', { width: 390, height: 844 });
        expect(Math.asin(tall.world.u.moonDir.value.y) / DEG).toBeGreaterThan(20);
        tall.world.dispose();
    });
});

describe('stillwater tarn: who comes by', () => {
    it('hides everything that waits for its moment, and costs a rest frame nothing of them', () => {
        const { camera, world } = makeWorld('High');
        run(world, camera, 2);
        WAITING_PARTS.forEach((name) => expect(world.parts[name].mesh.visible, name).toBe(false));
        expect(world.u.counts.value.w).toBe(0);
        world.dispose();
    });

    it('brings the moose out of the mist, has him drink and look at her, and takes him home again', async () => {
        const { camera, world } = await makeFiguredWorld('High');
        const rings = recordRings(world);
        const t0 = world.time + 0.1;
        world.visitor('elk', t0, 0.3);
        // The two see him come, and again as he drinks.
        const looks = world.story.looks.filter((look) => look.key === 'elk');
        expect(looks.map((look) => look.who).sort()).toEqual(['spirit', 'spirit', 'troll', 'troll']);
        expect(Math.min(...looks.map((look) => look.from))).toBeGreaterThan(t0 + MOOSE_BEATS.arrive - 5);
        const moose = world.parts.elk.mesh;
        const seen = [];
        run(world, camera, MOOSE_SPAN + 2, 20, () => {
            seen.push({
                t: world.time - t0, visible: moose.visible, x: moose.position.x, y: moose.position.y, z: moose.position.z,
            });
        });
        const during = seen.filter((s) => s.t > 0.2 && s.t < MOOSE_SPAN - 0.2);
        expect(during.every((s) => s.visible)).toBe(true);
        expect(seen.filter((s) => s.t > MOOSE_SPAN + 0.5).every((s) => !s.visible)).toBe(true);
        // He stands where he drinks, in the far shallows on her side of the board, wading no deeper than his knees.
        const standing = seen.filter((s) => s.t > MOOSE_BEATS.squared && s.t < MOOSE_BEATS.turn);
        standing.forEach((s) => {
            expect(s.x).toBeCloseTo(MOOSE.at[0] * world.squeeze, 6);
            expect(s.z).toBeCloseTo(MOOSE.at[1], 6);
            expect(s.y).toBeGreaterThanOrEqual(-MOOSE.wade - 1e-9);
        });
        expect(shoreDistance(MOOSE.at[0], MOOSE.at[1])).toBeLessThan(-1);
        expect(MOOSE.at[0]).toBeLessThan(SPIRIT.reach[0]);
        // Every step of his path is on open water, and he comes and goes out on the far water.
        for (let a = 0; a <= MOOSE_SPAN; a += 0.5) {
            const p = mooseAt(a);
            expect(shoreDistance(p.x, p.z), `at ${a.toFixed(1)} s`).toBeLessThan(0);
        }
        expect(mooseAt(0).z).toBeLessThan(MOOSE.at[1] - 10);
        expect(mooseAt(MOOSE_SPAN).z).toBeLessThan(MOOSE.at[1] - 10);
        // His hooves ring the water as he walks; his muzzle rings it while he drinks, and at no other time.
        const near = (r, m) => Math.hypot(r.x - m[0] * world.squeeze, r.z - m[1]) < 4;
        const sips = rings.filter((r) => near(r, MOOSE.at) && r.time - t0 > MOOSE_BEATS.drink && r.time - t0 < MOOSE_BEATS.lift);
        expect(sips.length).toBeGreaterThan(3);
        expect(rings.filter((r) => near(r, MOOSE.at)).every((r) => r.edge < 0)).toBe(true);
        const steps = rings.filter((r) => r.time - t0 < MOOSE_BEATS.arrive);
        expect(steps.length).toBeGreaterThan(6);
        world.dispose();
    });

    it('poses the moose: walking with his legs, head down to drink, head turned to her, never a jump', () => {
        let before = mooseAt(0);
        for (let a = 0.05; a <= MOOSE_SPAN; a += 0.05) {
            const p = mooseAt(a);
            expect(Math.hypot(p.x - before.x, p.z - before.z), `at ${a.toFixed(2)} s`).toBeLessThan(MOOSE.pace * 0.06 + 1e-6);
            const turned = Math.abs(Math.atan2(Math.sin(p.heading - before.heading), Math.cos(p.heading - before.heading)));
            expect(turned, `at ${a.toFixed(2)} s`).toBeLessThan(0.08);
            expect(Math.abs(p.neck - before.neck), `at ${a.toFixed(2)} s`).toBeLessThan(0.08);
            before = p;
        }
        const drinking = mooseAt((MOOSE_BEATS.drink + MOOSE_BEATS.lift) / 2);
        expect(drinking.neck).toBeGreaterThan(0.8);
        expect(drinking.walking).toBe(0);
        expect(Math.abs(mooseAt((MOOSE_BEATS.regard + MOOSE_BEATS.turn) / 2).look)).toBeGreaterThan(0.6);
        expect(mooseAt(MOOSE_BEATS.arrive / 2).walking).toBe(1);
        // Broadside as he drinks.
        expect(drinking.heading).toBeCloseTo(MOOSE.broadside, 6);
        // The night keeps a slot as long as his visit for him (a second never cuts him short).
        expect(MOOSE_SPAN).toBeLessThanOrEqual(VISITOR_SPAN.elk);
    });

    it('sends wings across the sky for the owl, and a flight out of the far wood as the hour turns', () => {
        const { camera, world } = makeWorld('High');
        const t0 = world.time + 0.1;
        world.visitor('owl', t0, 0.7);
        run(world, camera, 1);
        expect(world.parts.birds.mesh.visible).toBe(true);
        expect(world.parts.birds.owl.visible).toBe(true);
        expect(world.parts.birds.ducks.visible).toBe(false);
        expect(world.u.flight.value.toArray().slice(0, 3)).toEqual([t0, 0, 0.7]);
        run(world, camera, FLIGHT.owlSpan);
        expect(world.parts.birds.mesh.visible).toBe(false);
        // The hour turning starts the flock (and a ring of light out from the moon).
        const turned = world.time;
        world.levelUp(2);
        run(world, camera, 1);
        expect(world.u.flight.value.y).toBe(1);
        expect(world.u.flight.value.x).toBeGreaterThan(turned);
        expect(world.u.flight.value.x).toBeLessThan(turned + 1);
        expect(world.parts.birds.mesh.visible).toBe(true);
        expect(world.parts.birds.ducks.visible).toBe(true);
        expect(world.parts.birds.owl.visible).toBe(false);
        expect(world.u.moonRing.value.x).toBeGreaterThan(turned);
        expect(world.u.moonRing.value.y).toBeGreaterThan(0.3);
        run(world, camera, FLIGHT.flockSpan + 3);
        expect(world.parts.birds.mesh.visible).toBe(false);
        // A level set in silence (a rebuild mid-run) starts nothing.
        const quiet = world.u.flight.value.x;
        world.levelUp(3, { silent: true });
        run(world, camera, 1);
        expect(world.u.flight.value.x).toBe(quiet);
        world.dispose();
    });

    it('lets a star fall down the strip of sky the frame shows, and a shower of them for a perfect clear', () => {
        const { camera, world } = makeWorld('High');
        const { u } = world;
        for (const seed of [0.05, 0.31, 0.62, 0.93]) world.visitor('star', world.time + 0.05, seed);
        run(world, camera, 0.2);
        expect(u.counts.value.w).toBe(4);
        const top = Math.tan((fovForAspect(1600 / 900) / 2 + 3) * DEG);
        for (let i = 0; i < 4; i++) {
            const a = u.meteorRows[i * 2];
            const b = u.meteorRows[i * 2 + 1];
            // It begins under the frame's top edge and over the far wood, and falls.
            expect(a.y).toBeLessThan(top);
            expect(a.y).toBeGreaterThan(0.2);
            expect(b.y).toBeLessThan(0);
            expect(a.y + b.y * a.w).toBeGreaterThan(0.08);
            expect(Math.abs(a.x)).toBeGreaterThan(0.15);
            expect(a.w).toBeGreaterThan(0.5);
        }
        run(world, camera, 2);
        expect(u.counts.value.w).toBe(0);
        // A perfect clear: the four lines, and the crown that settles on them.
        world.onClear({ lines: 4 });
        run(world, camera, 0.36);
        world.onClear({ crown: true });
        let most = 0;
        run(world, camera, 4, 30, () => {
            most = Math.max(most, u.counts.value.w);
        });
        expect(most).toBeGreaterThanOrEqual(3);
        expect(most).toBeLessThanOrEqual(METEOR_SLOTS);
        expect(world.meteors.length).toBeLessThanOrEqual(METEOR_SLOTS);
        world.dispose();
    });

    it('raises a fish on open water beside the board, on either side', () => {
        const { camera, world } = makeWorld('Low');
        const rings = recordRings(world);
        world.visitor('fish', world.time, 0.2);
        world.visitor('fish', world.time, 0.8);
        run(world, camera, 0.5);
        expect(rings.length).toBe(4);
        expect(rings.some((ring) => ring.x < 0)).toBe(true);
        expect(rings.some((ring) => ring.x > 0)).toBe(true);
        rings.forEach((ring) => expect(ring.edge).toBeLessThan(-0.3));
        world.dispose();
    });

    it('brings the clock\'s visitors once each, whatever the frame rate, and none when asked for none', () => {
        const kinds = (fps) => {
            const { camera, world } = makeWorld('Low', { night: true, start: 0 });
            const came = [];
            const original = world.visitor.bind(world);
            world.visitor = (kind, time, seed) => {
                came.push(`${kind}@${time.toFixed(3)}`);
                return original(kind, time, seed);
            };
            run(world, camera, 130, fps);
            world.dispose();
            return came;
        };
        const slow = kinds(10);
        expect(slow).toEqual(kinds(30));
        // (All of the clock's own, but an owl or an elk that would cut short one still there.)
        const clock = visitorsBetween(0, 130, []).map((v) => `${v.kind}@${v.time.toFixed(3)}`);
        expect(slow.length).toBeGreaterThan(2);
        slow.forEach((v) => expect(clock).toContain(v));
        const { camera, world } = makeWorld('Low', { start: 0 });
        const spy = vi.spyOn(world, 'visitor');
        run(world, camera, 130, 10);
        expect(spy).not.toHaveBeenCalled();
        world.dispose();
    });
});

describe('stillwater tarn: the birds', () => {
    it('builds each bird with two wings that fold at the shoulder and the wrist and stay joined', () => {
        for (const kind of ['owl', 'duck']) {
            const g = birdGeometry(kind);
            const pos = g.getAttribute('position');
            const wing = g.getAttribute('aWing');
            let left = 0;
            let right = 0;
            let span = 0;
            for (let i = 0; i < pos.count; i++) {
                const side = wing.getX(i);
                if (side > 0) left += 1;
                if (side < 0) right += 1;
                // Each wing lies on its own side, and the body carries no fold.
                if (side !== 0) expect(Math.sign(pos.getX(i)), `${kind} ${i}`).toBe(side);
                else expect([wing.getY(i), wing.getZ(i)]).toEqual([0, 0]);
                span = Math.max(span, Math.abs(pos.getX(i)) * 2);
            }
            expect(left, kind).toBe(right);
            expect(span, kind).toBeGreaterThan(BIRDS[kind].span * 0.9);
            expect(span, kind).toBeLessThan(BIRDS[kind].span * 1.1);
            // Folded, every vertex at the shoulder stays at the shoulder (the wing never tears off the body).
            for (const angles of [[0.7, 0.5], [-0.5, -0.4], [0.1, -0.06]]) {
                for (let i = 0; i < pos.count; i++) {
                    if (wing.getX(i) === 0 || wing.getY(i) > 0) continue;
                    const p = foldWing(kind, [pos.getX(i), pos.getY(i), pos.getZ(i)], [wing.getX(i), wing.getY(i), wing.getZ(i)], angles);
                    expect(p[0]).toBeCloseTo(pos.getX(i), 9);
                    expect(p[1]).toBeCloseTo(pos.getY(i), 9);
                }
            }
            // Raised, both wings go up together.
            let up = 0;
            for (let i = 0; i < pos.count; i++) {
                if (wing.getW(i) < 0.95) continue;
                const p = foldWing(kind, [pos.getX(i), pos.getY(i), pos.getZ(i)], [wing.getX(i), wing.getY(i), wing.getZ(i)], [0.6, 0.3]);
                expect(p[1]).toBeGreaterThan(pos.getY(i));
                up += 1;
            }
            expect(up, kind).toBeGreaterThan(4);
            g.dispose();
        }
    });

    it('flies the ducks up off the far water and out over the wood, one after another', () => {
        for (const side of [-1, 1]) {
            for (let i = 0; i < 6; i++) {
                const start = duckAt(i, 0, side);
                expect(shoreDistance(start[0], start[2])).toBeLessThan(-1);
                expect(start[1]).toBeLessThan(0.5);
                const late = duckAt(i, FLIGHT.flockSpan, side);
                // High over the far wood by the end, and gone off to their side.
                expect(late[1]).toBeGreaterThan(9);
                expect(Math.sign(late[0] - start[0])).toBe(side);
            }
        }
    });
});

describe('stillwater tarn: what the bigger moments set off', () => {
    it('answers two lines with the lilies, and three with the wood\'s eyes and the moon\'s shafts as well', () => {
        const seen = {};
        for (const lines of [1, 2, 3]) {
            const { camera, world } = makeWorld('High');
            const rest = world.getPostState().shafts;
            world.onClear({ lines });
            let lilies = 0;
            let eyes = 0;
            let shafts = 0;
            run(world, camera, 1.6, 60, () => {
                lilies = Math.max(lilies, world.u.lilies.value.y);
                eyes = Math.max(eyes, world.u.eyes.value.y);
                shafts = Math.max(shafts, world.getPostState().shafts - rest);
            });
            seen[lines] = { lilies, eyes, shafts };
            world.dispose();
        }
        expect(seen[1].lilies).toBeLessThan(0.05);
        expect(seen[2].lilies).toBeGreaterThan(0.3);
        expect(seen[3].lilies).toBeGreaterThan(seen[2].lilies);
        expect(seen[2].eyes).toBeLessThan(0.05);
        expect(seen[3].eyes).toBeGreaterThan(0.3);
        expect(seen[3].shafts).toBeGreaterThan(seen[2].shafts + 0.25);
    });

    it('raises pillars of tarnfire for four lines, adds to them while they stand, and pales them for a perfect clear', () => {
        const { camera, world } = makeWorld('High');
        const { u } = world;
        const pillars = world.parts.pillars.mesh;
        expect(pillars.visible).toBe(false);
        const t0 = world.time;
        world.onClear({ lines: 4 });
        run(world, camera, HUSH_HOLD + 0.2, 60);
        // They rise as the hush ends, gold.
        expect(u.pillars.value.toArray().slice(0, 3)).toEqual([t0 + HUSH_HOLD, 1, 0]);
        expect(pillars.visible).toBe(true);
        // Four more lines while they stand: brighter, never put out and lit again.
        run(world, camera, 0.6, 60);
        world.onClear({ lines: 4 });
        run(world, camera, 0.5, 60);
        expect(u.pillars.value.x).toBe(t0 + HUSH_HOLD);
        expect(u.pillars.value.y).toBeGreaterThan(1);
        expect(u.pillars.value.y).toBeLessThanOrEqual(1.6);
        // A perfect clear's crown turns them pale, and the moon sends a ring out.
        world.onClear({ crown: true });
        run(world, camera, 0.2, 60);
        expect(u.pillars.value.z).toBe(1);
        expect(u.moonRing.value.y).toBe(1);
        run(world, camera, PILLAR.live + 1);
        expect(pillars.visible).toBe(false);
        // Every pillar stands on open water, on both sides of the board.
        PILLARS.forEach(([x, z]) => expect(shoreDistance(x, z), `${x},${z}`).toBeLessThan(-0.5));
        expect(PILLARS.some(([x]) => x < 0) && PILLARS.some(([x]) => x > 0)).toBe(true);
        world.dispose();
    });

    it('sinks the night\'s lights low when the run ends, and brings them back', () => {
        const { camera, world } = makeWorld('Low');
        world.onGameOver();
        let low = 1;
        run(world, camera, 4, 30, () => {
            low = Math.min(low, world.u.breath.value);
        });
        expect(low).toBeLessThan(0.75);
        expect(low).toBeGreaterThan(0.4);
        run(world, camera, 16);
        expect(world.u.breath.value).toBeGreaterThan(0.97);
        world.dispose();
    });

    it('has both send their light at once for a second difficult clear in a row', () => {
        const { camera, world } = makeWorld('Low');
        const t0 = world.time;
        world.onClear({ lines: 2, twist: true, b2b: true });
        run(world, camera, 1);
        const p = world.u.pulse.value;
        expect(p.x).toBeGreaterThan(t0);
        expect(p.x).toBe(p.z);
        expect(p.y).toBe(1);
        expect(p.w).toBe(1);
        world.dispose();
    });
});

describe('stillwater tarn: their two lights on the water', () => {
    it('keeps each one\'s light before them at rest, and carries both across while a chain holds them near', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
        const { u } = world;
        run(world, camera, 3);
        expect(u.reach.value.x).toBeLessThan(0.3);
        expect(u.reach.value.y).toBeLessThan(0.3);
        expect(u.reach.value.z).toBeLessThan(0.2);
        world.onCombo(5);
        run(world, camera, 9);
        expect(u.reach.value.x).toBeGreaterThan(0.6);
        expect(u.reach.value.y).toBeGreaterThan(0.6);
        expect(u.reach.value.z).toBeGreaterThan(0.6);
        world.onCombo(0);
        run(world, camera, 40);
        expect(u.reach.value.x).toBeLessThan(0.45);
        expect(u.reach.value.z).toBeLessThan(0.45);
        // Held for a capture, it is what was asked; let go, the story has it again.
        world.setReachHold(['0.5', '0.7', '0.9']);
        run(world, camera, 12);
        expect(u.reach.value.x).toBeCloseTo(0.5, 2);
        expect(u.reach.value.y).toBeCloseTo(0.7, 2);
        expect(u.reach.value.z).toBeCloseTo(0.9, 2);
        world.setReachHold(null);
        run(world, camera, 12);
        expect(u.reach.value.y).toBeLessThan(0.5);
        world.dispose();
    });

    it('sends a pulse at its own moment, brightens the one who sent it, and the other as it arrives', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
        const { u } = world;
        run(world, camera, 2);
        const rest = { lantern: u.lanternAt.value.w, spirit: u.spiritAt.value.w };
        const born = world.time + 1;
        world.sendPulse('troll', born, 1);
        // The other is told to look across as it comes.
        expect(world.story.looks.some((look) => look.who === 'spirit' && look.key === 'partner')).toBe(true);
        run(world, camera, 0.5);
        expect(u.pulse.value.z).not.toBe(born);
        run(world, camera, 0.7);
        expect(u.pulse.value.z).toBe(born);
        expect(u.pulse.value.w).toBe(1);
        expect(u.lanternAt.value.w).toBeGreaterThan(rest.lantern + 0.4);
        // It crosses at PULSE_SPEED: she glows for it when it reaches her, and not before.
        const travel = world.pulseTravel();
        expect(travel).toBeCloseTo(Math.hypot(world._heartOf[0] - world._lantern[0], world._heartOf[2] - world._lantern[2]) / PULSE_SPEED, 9);
        expect(travel).toBeGreaterThan(2);
        expect(world.pulseGlow('spirit', born + travel * 0.5)).toBeLessThan(0.02);
        expect(world.pulseGlow('spirit', born + travel + 0.2)).toBeGreaterThan(0.3);
        expect(world.pulseGlow('troll', born)).toBeGreaterThan(0.6);
        expect(world.pulseGlow('troll', born - 0.1)).toBe(0);
        world.dispose();
    });

    it('has them send each other a light as a clear\'s lights come home, but not on every clear', () => {
        const { camera, world } = makeWorld('Low');
        for (let i = 0; i < 4; i++) world.onLock({ u: i % 2 ? 0.8 : 0.2, rows: [19, 18] });
        run(world, camera, 1.5);
        const t0 = world.time;
        world.onClear({ lines: 1 });
        run(world, camera, 7, 30);
        const first = world.u.pulse.value.clone();
        expect(first.x).toBeGreaterThan(t0);
        expect(first.z).toBeGreaterThan(t0);
        // One, then the other in answer.
        expect(Math.abs(first.x - first.z)).toBeGreaterThan(1);
        expect(first.y).toBeGreaterThan(0.1);
        expect(first.y).toBeLessThan(0.7);
        // A clear on the heels of the exchange sends nothing new.
        const again = makeWorld('Low');
        again.world.onClear({ lines: 1 });
        run(again.world, again.camera, 2);
        const queued = again.world.pulseQueue.length;
        again.world.onClear({ lines: 1 });
        expect(again.world.pulseQueue.length).toBe(queued);
        again.world.dispose();
        world.dispose();
    });

    it('burns her light in his lantern a while after a visit, and his ember by her stone', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
        const { u } = world;
        const own = u.lantern.value.clone();
        const hers = u.spirit.value.clone();
        const t0 = world.time;
        world.lifeEvent({ type: 'relit', start: t0, length: 30 });
        world.lifeEvent({ type: 'ember', start: t0, length: 30 });
        run(world, camera, 5);
        // The lantern has turned toward her pale light, and burns a little brighter for it.
        expect(world.relitNow).toBeGreaterThan(0.9);
        expect(u.lantern.value.distanceTo(hers)).toBeLessThan(own.distanceTo(hers) * 0.6);
        // His ember stands in the wisps' table by her stone, warm.
        const lit = Array.from({ length: u.counts.value.z }, (_, i) => ({ at: u.wispRows[i * 2], rgb: u.wispRows[i * 2 + 1] }));
        const ember = lit.find((row) => Math.hypot(row.at.x - PLACES.ember[0] * world.squeeze, row.at.z - PLACES.ember[2]) < 0.2);
        expect(ember).toBeTruthy();
        expect(ember.at.w).toBeGreaterThan(0.6);
        expect(ember.rgb.x).toBeGreaterThan(ember.rgb.z * 1.5);
        // Both are gone when their time is up.
        run(world, camera, 32);
        expect(world.relitNow).toBe(0);
        expect(u.lantern.value.distanceTo(own)).toBeLessThan(1e-6);
        expect(u.counts.value.z).toBe(0);
        world.dispose();
    });

    it('brings her over the water to him and home again, frame by frame in the real world', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
        world.cueScene('visit', world.time + 0.5);
        const home = world.spirit.rootWalk().x;
        let east = -Infinity;
        let nearest = Infinity;
        let relit = 0;
        let braid = 0;
        let fastest = 0;
        let before = world.spirit.rootWalk().clone();
        run(world, camera, 80, 30, () => {
            const her = world.spirit.rootWalk();
            const him = world.troll.body.root;
            east = Math.max(east, her.x);
            nearest = Math.min(nearest, Math.hypot(her.x - him.x, her.z - him.z));
            relit = Math.max(relit, world.relitNow);
            braid = Math.max(braid, world.u.reach.value.z);
            fastest = Math.max(fastest, Math.hypot(her.x - before.x, her.z - before.z) * 30);
            before = her.clone();
        });
        // She crossed the whole tarn to the water off his shore; he came down to its edge to meet her.
        expect(east).toBeGreaterThan(PLACES.visit[0] * world.squeeze - 0.5);
        expect(nearest).toBeLessThan(3.4);
        expect(nearest).toBeGreaterThan(1);
        // Her light went into his lantern, and both their lights lay braided on the water.
        expect(relit).toBeGreaterThan(0.9);
        expect(braid).toBeGreaterThan(0.6);
        // A glide, never a dart.
        expect(fastest).toBeLessThan(1.6);
        // And she is home again, he by his stone, the scene told to its end.
        expect(world.spirit.rootWalk().x).toBeLessThan(home + 1.6);
        expect(world.getState().troll).toBeLessThan(0.1);
        expect(world.getState().sceneLog.some((entry) => /^visit@\d+ done$/.test(entry))).toBe(true);
        world.dispose();
    });

    it('holds her beside him when a chain begins while she is across, and lets her home when it breaks', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
        world.cueScene('visit', world.time + 0.5);
        let across = false;
        run(world, camera, 40, 30, () => {
            if (!across && world.spirit.rootWalk().x > 4 * world.squeeze) {
                across = true;
                world.onCombo(3);
            }
        });
        expect(across).toBe(true);
        // The chain has them: no scene of theirs runs, and she has stayed by him.
        expect(world.getState().scenes).toEqual({ troll: 'none', spirit: 'none' });
        expect(world.spirit.rootWalk().x).toBeGreaterThan(4 * world.squeeze);
        expect(world.getState().troll).toBeGreaterThan(0.3);
        world.onCombo(0);
        run(world, camera, 45);
        expect(world.spirit.rootWalk().x).toBeLessThan(SPIRIT.reach[0] * world.squeeze + 0.5);
        expect(TROLL.home[0]).toBeGreaterThan(PLACES.visit[0]);
        world.dispose();
    });
});
