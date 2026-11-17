import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    DEFAULT_STAGE, DRAGON_BODY, DRAGON_KIND, DRAGON_KNOTS, DRAGON_RECIPES, DRAGON_RECIPE_NAMES, DRAGON_SCHEMES,
    DRAGON_SHARES, dragonLane, dragonSeats, flightPoint, flightState, planDragonFlight,
} from '../../src/themes/neon-district/neon-district-dragon.js';
import { STREET } from '../../src/themes/neon-district/neon-district-core.js';
import { NeonDistrictWorld, REST_RIG } from '../../src/themes/neon-district/neon-district-world.js';
import { fallbackLayout } from '../../src/themes/neon-district/neon-district-composition.js';
import {
    FIREWORK_LIFE, GYRE_LIFE, GYRE_RUN, fireworkSpread, gyreDepth,
} from '../../src/themes/neon-district/neon-district-fx.js';
import { build } from './helpers/tsl-node-build.js';

/** A tall phone frame: no room beside the card, a band of air over it. */
const TALL_STAGE = Object.freeze({
    cam: [0, 3, 0], tanH: 0.415, tanV: 0.9, pitch: (8 * Math.PI) / 180, left: null, right: null, top: 0.1,
});
/** A wide frame with room on both sides (no stats bar). */
const BOTH_STAGE = Object.freeze({ ...DEFAULT_STAGE, right: { a: 0.61, b: 1 } });

const knotOf = (plan, k) => ({ x: plan.knots[k * 4], y: plan.knots[k * 4 + 1], z: plan.knots[k * 4 + 2] });

describe('neon district dragon: the stage', () => {
    it('finds a lane beside the card on a wide frame, and only the band over it on a tall one', () => {
        const left = dragonLane(DEFAULT_STAGE, -1, 0.8);
        const right = dragonLane(DEFAULT_STAGE, 1, 0.8);
        expect(left.far - left.near).toBeGreaterThan(15);
        // Beside the stats bar the right lane is short: a place to pass close, not to fly a figure.
        expect(right.far - right.near).toBeLessThan(left.far - left.near);
        expect(dragonLane(TALL_STAGE, -1, 0.8)).toBeNull();
        expect(dragonLane(TALL_STAGE, 1, 0.8)).toBeNull();
        const over = dragonLane(TALL_STAGE, 0, 0.8);
        expect(over.side).toBe(0);
        // A lane closes with distance and never reaches into a wall.
        expect(left.width(left.near)).toBeGreaterThan(left.width(left.far));
        for (let depth = left.near; depth <= left.far; depth += 1) {
            for (const across of [0, 0.5, 1]) {
                const point = left.point(depth, across, 0.5);
                expect(point.x).toBeLessThan(0);
                expect(Math.abs(point.x) + 0.8).toBeLessThan(STREET.halfStreet);
                expect(point.y).toBeGreaterThan(1);
            }
        }
    });
});

describe('neon district dragon: flights', () => {
    const stages = [['wide', DEFAULT_STAGE], ['both lanes', BOTH_STAGE], ['tall', TALL_STAGE]];

    it('plans every recipe on every stage: a finite curve inside the canyon, flown in a few seconds', () => {
        for (const [label, stage] of stages) {
            DRAGON_RECIPES.forEach((recipe, index) => {
                for (let seed = 1; seed <= 6; seed++) {
                    const plan = planDragonFlight({ seed: seed * 31 + index, recipe: index, stage });
                    const name = `${label} ${recipe.name} #${seed}`;
                    expect(plan, name).toBeTruthy();
                    expect(plan.recipe).toBe(recipe.name);
                    expect(plan.knots.length).toBe(DRAGON_KNOTS * 4);
                    expect(plan.used, name).toBeGreaterThan(40);
                    for (let k = 0; k < DRAGON_KNOTS; k++) {
                        const p = knotOf(plan, k);
                        expect(Number.isFinite(p.x + p.y + p.z), name).toBe(true);
                        // Never through a wall, never under the street.
                        expect(Math.abs(p.x), `${name} knot ${k}`).toBeLessThan(STREET.halfStreet - 0.4);
                        expect(p.y, `${name} knot ${k}`).toBeGreaterThan(0.6);
                    }
                    expect(plan.duration, name).toBeGreaterThan(3);
                    expect(plan.duration, name).toBeLessThan(15);
                    expect(plan.spacing, name).toBeGreaterThanOrEqual(0.7);
                    expect(plan.scheme).toBeGreaterThanOrEqual(0);
                    expect(plan.scheme).toBeLessThan(DRAGON_SCHEMES.length);
                }
            });
        }
    });

    it('carries a frame along the curve that is a unit vector square to the way it flies', () => {
        DRAGON_RECIPES.forEach((recipe, index) => {
            const plan = planDragonFlight({ seed: 77 + index, recipe: index });
            for (let k = 1; k < plan.used - 1; k++) {
                const n = [plan.frames[k * 4], plan.frames[k * 4 + 1], plan.frames[k * 4 + 2]];
                expect(Math.hypot(...n), `${recipe.name} ${k}`).toBeCloseTo(1, 3);
                const a = knotOf(plan, k - 1);
                const b = knotOf(plan, k + 1);
                const t = [b.x - a.x, b.y - a.y, b.z - a.z];
                const length = Math.hypot(...t);
                if (length < 0.2) continue; // eslint-disable-line no-continue
                const along = Math.abs(n[0] * t[0] + n[1] * t[1] + n[2] * t[2]) / length;
                expect(along, `${recipe.name} ${k}`).toBeLessThan(0.35);
            }
        });
    });

    it('flies the head forward only, at a speed a body can follow, and the same at any step', () => {
        DRAGON_RECIPES.forEach((recipe, index) => {
            const plan = planDragonFlight({ seed: 5 + index * 13, recipe: index });
            const state = flightState(plan, 0);
            let last = -Infinity;
            for (let age = 0; age <= plan.duration; age += 1 / 60) {
                flightState(plan, age, state);
                expect(state.head, `${recipe.name} @${age.toFixed(2)}`).toBeGreaterThanOrEqual(last - 1e-6);
                expect(state.speed).toBeLessThan(60);
                expect(state.burst).toBeGreaterThanOrEqual(0);
                expect(state.burst).toBeLessThanOrEqual(1);
                expect(state.strength).toBeLessThanOrEqual(1);
                last = state.head;
            }
            // A pure function of the age: a coarse walk and a fine one agree.
            const coarse = flightState(plan, plan.duration * 0.61);
            expect(flightState(plan, plan.duration * 0.61).head).toBe(coarse.head);
            // Before it is called and after it has gone it is dark.
            expect(flightState(plan, -0.5).strength).toBe(0);
            expect(flightState(plan, plan.duration + 1).strength).toBe(0);
        });
    });

    it('never plans the same flight twice: each seed its own curve, each recipe its own figure', () => {
        DRAGON_RECIPES.forEach((recipe, index) => {
            const a = planDragonFlight({ seed: 11, recipe: index });
            const b = planDragonFlight({ seed: 11, recipe: index });
            const c = planDragonFlight({ seed: 12, recipe: index });
            expect(Array.from(a.knots)).toEqual(Array.from(b.knots));
            let apart = 0;
            for (let k = 0; k < a.used; k++) {
                const p = knotOf(a, k);
                const q = knotOf(c, k);
                apart = Math.max(apart, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
            }
            expect(apart, recipe.name).toBeGreaterThan(0.5);
        });
        // Between them the recipes come in every way and leave every way.
        const entries = new Set();
        const exits = new Set();
        for (let seed = 1; seed <= 80; seed++) {
            const plan = planDragonFlight({ seed, recipe: seed % DRAGON_RECIPES.length, stage: BOTH_STAGE });
            entries.add(plan.entry);
            exits.add(plan.exit);
        }
        expect([...entries].sort()).toEqual(['assemble', 'fromBehind', 'fromFar', 'fromStreet', 'fromTop']);
        expect([...exits].sort()).toEqual(['intoHaze', 'overCamera', 'scatter', 'upAndOut']);
        expect(new Set(DRAGON_RECIPE_NAMES).size).toBe(DRAGON_RECIPES.length);
    });

    it('bursts the swarm apart and gathers it again, there or somewhere else', () => {
        const ring = planDragonFlight({ seed: 3, recipe: DRAGON_RECIPE_NAMES.indexOf('ouroboros') });
        const burst = ring.bursts.find((b) => b.kind === 'burst');
        expect(burst).toBeTruthy();
        expect(flightState(ring, burst.t0 - 0.2).burst).toBe(0);
        expect(flightState(ring, (burst.t1 + burst.t2) / 2).burst).toBeCloseTo(1, 6);
        expect(flightState(ring, burst.t3 + 0.2).burst).toBe(0);

        // A jump: the head waits while every drone is in the cloud, then is somewhere else.
        const vanish = planDragonFlight({ seed: 9, recipe: DRAGON_RECIPE_NAMES.indexOf('vanish'), stage: BOTH_STAGE });
        const jump = vanish.bursts.find((b) => b.kind === 'jump');
        expect(jump).toBeTruthy();
        const before = flightState(vanish, jump.t1 + 0.05);
        expect(before.burst).toBeCloseTo(1, 6);
        const headBefore = before.head;
        const from = flightPoint(vanish, headBefore);
        const after = flightState(vanish, jump.t2 + 0.02);
        expect(after.burst).toBeGreaterThan(0.95);
        expect(after.head - headBefore).toBeGreaterThan(vanish.body);
        const to = flightPoint(vanish, after.head);
        expect(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)).toBeGreaterThan(4);
        expect(flightState(vanish, jump.t3 + 0.1).burst).toBe(0);

        // Gathered out of sparks: a cloud as it is called, a dragon a moment later.
        const phoenix = planDragonFlight({ seed: 4, recipe: DRAGON_RECIPE_NAMES.indexOf('phoenix') });
        expect(flightState(phoenix, 0.05).burst).toBeGreaterThan(0.9);
        expect(flightState(phoenix, 2.5).burst).toBe(0);
        // The whole body already lies along the curve as it gathers.
        expect(flightState(phoenix, 0).head).toBeGreaterThanOrEqual(phoenix.body);

        // Dissolving: the light goes as the cloud rises.
        const lantern = planDragonFlight({ seed: 6, recipe: DRAGON_RECIPE_NAMES.indexOf('lantern') });
        expect(lantern.dissolves).toBeLessThan(lantern.duration);
        expect(flightState(lantern, lantern.dissolves + 0.6).burst).toBeGreaterThan(0.9);
        expect(flightState(lantern, lantern.duration - 0.05).strength).toBeLessThan(0.1);
    });

    it('skims the street low enough to throw spray, and marks the run', () => {
        const plan = planDragonFlight({ seed: 21, recipe: DRAGON_RECIPE_NAMES.indexOf('skimmer') });
        expect(plan.skims.length).toBe(1);
        const [skim] = plan.skims;
        expect(skim.to).toBeGreaterThan(skim.from);
        const mid = knotOf(plan, Math.round((skim.from + skim.to) / 2));
        expect(mid.y).toBeLessThan(DRAGON_BODY.radius * plan.scale + 1.2);
    });
});

describe('neon district dragon: the swarm', () => {
    it('seats every drone, deals the lines evenly and keeps two eyes', () => {
        for (const count of [900, 2600, 5200]) {
            const { aSeat, aKind } = dragonSeats(count, 0xd7a6);
            expect(aSeat.length).toBe(count * 4);
            const kinds = new Map();
            for (let i = 0; i < count; i++) kinds.set(aKind[i], (kinds.get(aKind[i]) || 0) + 1);
            expect(kinds.get(DRAGON_KIND.eye)).toBe(2);
            for (const [kind, share] of DRAGON_SHARES) {
                expect(kinds.get(kind), `${count} kind ${kind}`).toBeGreaterThan(count * share * 0.6);
            }
            for (let i = 0; i < count * 4; i++) {
                expect(aSeat[i]).toBeGreaterThanOrEqual(0);
                expect(aSeat[i]).toBeLessThanOrEqual(1);
            }
            // A contour is a row of drones with no gap in it (a gap in the row is a gap in the tube).
            const line = [];
            for (let i = 0; i < count; i++) {
                if (aKind[i] === DRAGON_KIND.contour && aSeat[i * 4 + 1] < 1 / 6) line.push(aSeat[i * 4]);
            }
            line.sort((a, b) => a - b);
            const step = 1 / line.length;
            for (let i = 1; i < line.length; i++) expect(line[i] - line[i - 1]).toBeLessThan(step * 1.6);
        }
    });
});

describe('neon district dragon: in the world', () => {
    function makeWorld(width = 1600, height = 900) {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
        const world = new NeonDistrictWorld({ scene, quality: 'High', capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(width, height, width / height);
        world.setLayout(fallbackLayout(width, height), width / height);
        world.seek(10);
        world.updateCamera(camera, { time: 10, delta: 0 });
        world.update({ time: 10, delta: 0 }, camera);
        return { scene, camera, world };
    }

    it('deals every recipe once before any comes round again, and never the same twice running', () => {
        const { world } = makeWorld();
        const dealt = [];
        for (let i = 0; i < DRAGON_RECIPES.length * 3; i++) dealt.push(world.dealDragon().recipe);
        for (let round = 0; round < 3; round++) {
            const hand = dealt.slice(round * DRAGON_RECIPES.length, (round + 1) * DRAGON_RECIPES.length);
            expect(new Set(hand).size).toBe(DRAGON_RECIPES.length);
        }
        for (let i = 1; i < dealt.length; i++) expect(dealt[i]).not.toBe(dealt[i - 1]);
        // Every flight has a seed of its own.
        const seeds = new Set();
        for (let i = 0; i < 40; i++) seeds.add(world.dealDragon().seed);
        expect(seeds.size).toBe(40);
        world.dispose();
    });

    it('flies beside the card on a wide frame and over it on a tall one', () => {
        const wide = makeWorld();
        expect(Math.abs(wide.world.launchDragon(0, wide.world.time).plan.side)).toBe(1);
        wide.world.dispose();
        const tall = makeWorld(430, 932);
        expect(tall.world.launchDragon(0, tall.world.time).plan.side).toBe(0);
        tall.world.dispose();
    });

    it('builds the dragon and the event effects to WGSL and GLSL', () => {
        const { world } = makeWorld();
        for (const name of ['dragon', 'strike', 'gyre', 'fireworks', 'flyby', 'sky']) {
            // (the builders three/webgpu exports: one from three/src would be a second copy of TSL)
            for (const Builder of [THREE.WGSLNodeBuilder, THREE.GLSLNodeBuilder]) {
                const result = build(Builder, world.parts[name].mesh);
                expect(result.thrown, `${name}: ${result.thrown?.message}`).toBeUndefined();
                expect(result.heard, name).toEqual([]);
                expect(result.vertex.length, name).toBeGreaterThan(100);
                expect(result.fragment.length, name).toBeGreaterThan(100);
                expect(`${result.vertex}${result.fragment}`, name).not.toMatch(/\bNaN\b|undefined/);
            }
        }
        world.dispose();
    });
});

describe('neon district effects: the gyre and the fireworks', () => {
    it('runs a gyre away up the street, slowing, and spreads a burst that hangs', () => {
        expect(gyreDepth(0)).toBeCloseTo(5, 6);
        let last = gyreDepth(0);
        for (let age = 0.1; age <= GYRE_LIFE; age += 0.1) {
            const depth = gyreDepth(age);
            expect(depth).toBeGreaterThan(last);
            last = depth;
        }
        expect(last).toBeLessThan(5 + GYRE_RUN);
        expect(fireworkSpread(0)).toBe(0);
        expect(fireworkSpread(0.3)).toBeGreaterThan(0.6);
        expect(fireworkSpread(FIREWORK_LIFE)).toBeGreaterThan(0.99);
    });
});
