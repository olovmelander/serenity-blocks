/**
 * THE MOUNTAINS' GOLDEN AFTERNOON, THE MIST IN THE HOLLOW (world/odyssey-hollow-mist.js) and THE
 * TURN'S WAKE (world/odyssey-turn-wake.js): chapter 4's light, the weather you can see from its rail,
 * and what the land does as the day turns. (The mountain's autumn palette was taken out at the
 * owner's word on 2026-11-17: the mountain stays green.)
 * (The world that wears them is built, both backends, in odyssey-day-turn.test.js.)
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';

import {
    ODYSSEY_HOLLOW_MIST,
    buildHollowMistGeometry,
    hollowMistAt,
} from '../../src/rendering/odyssey/world/odyssey-hollow-mist.js';
import {
    ODYSSEY_TURN_WAKE,
    createOdysseyTurnWake,
    inTurnWakeReach,
    planTurnWake,
    turnWakeBirdAt,
    turnWakeGustAt,
    turnWakeLeafAt,
    turnWakeShownAt,
} from '../../src/rendering/odyssey/world/odyssey-turn-wake.js';
import { ODYSSEY_DAY_TURN, ODYSSEY_HOUR_LOOK } from '../../src/rendering/odyssey/world/odyssey-day-turn.js';
import { ODYSSEY_WEATHER_RANGE } from '../../src/rendering/odyssey/world/odyssey-weather-clock.js';
import { ODYSSEY_EVENING, odysseyEveningAt } from '../../src/rendering/odyssey/world/odyssey-evening.js';
import { ODYSSEY_COLOUR_SCRIPT, sampleColourScript } from '../../src/rendering/odyssey/odyssey-colour-script.js';
import { bakeValleyMist, sampleValleyMist } from '../../src/rendering/odyssey/world/odyssey-valley-mist.js';
import { ODYSSEY_SEA_LEVEL, odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const layout = getLevelRegistry().getPresentationLayout();
/** Orb `n`'s park, journey progress; and Act II progress of journey progress `p`. */
const orb = (n) => layout.levelPositions[n - 1];
const actTOf = (p) => (p - layout.chapterPositions[1]) / (layout.chapterPositions[5] - layout.chapterPositions[1]);

describe("the mountains' golden afternoon meets the evening", () => {
    const named = (name) => ODYSSEY_COLOUR_SCRIPT.find((k) => k.name === name);

    it('deepens orb by orb into the golden hour: the hour and the sun only ever go one way', () => {
        const run = ['island-morning', 'mountain-afternoon', 'mountain-gold', 'golden-hour'].map(named);
        run.forEach((k) => expect(k).toBeTruthy());
        for (let i = 1; i < run.length; i += 1) {
            expect(run[i].p).toBeGreaterThan(run[i - 1].p);
            expect(run[i].hour).toBeGreaterThan(run[i - 1].hour);
            // The sun warms: its blue falls, keyframe by keyframe.
            expect(run[i].sun & 0xff).toBeLessThan(run[i - 1].sun & 0xff);
        }
        // The mountains' two wear the evening's own recipe; the island's morning the anchor's.
        expect(run[0].horizon).toBeUndefined();
        expect(run[1].horizon).toBe('evening');
        expect(run[2].horizon).toBe('evening');
        // The hour goes on to sunset through the evening, and never falls on the way.
        let prev = 0;
        for (let p = 0.27; p <= named('belt-of-venus').p; p += 0.002) {
            const { hour } = sampleColourScript(p);
            expect(hour).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = hour;
        }
        expect(prev).toBeGreaterThan(0.95);
    });

    it('has no step at the 4->5 seam: every colour moves a little a step across it', () => {
        // Script p 0.40..0.42 spans the seam (journey p 0.335 -> 0.349).
        const lightOf = (p) => {
            const s = sampleColourScript(p);
            return [...s.skyHorizon, ...s.skyZenith, ...s.sun, s.hour];
        };
        for (let p = 0.36; p < 0.44; p += 0.002) {
            const a = lightOf(p);
            const b = lightOf(p + 0.002);
            a.forEach((v, i) => expect(Math.abs(b[i] - v)).toBeLessThan(0.012));
        }
    });

    it('grows the low sun\'s shafts out of the mountains\' last orbs, and hands the hour\'s sky over', () => {
        const at = (p) => odysseyEveningAt(actTOf(p), 37);
        // None through the mountains' fifth orb, a few by the last, the whole fan at chapter 5's first.
        expect(ODYSSEY_EVENING.shafts[0]).toBeLessThan(orb(24));
        expect(at(orb(23)).shafts).toBeLessThan(0.01);
        expect(at(orb(26)).shafts).toBeGreaterThan(at(orb(25)).shafts);
        expect(at(orb(25)).shafts).toBeGreaterThan(0.05);
        expect(at(orb(26)).shafts).toBeLessThan(at(orb(27)).shafts * 0.75);
        // The hour's own sky terms leave across the evening's first fifth; its clouds and mist hold.
        expect(ODYSSEY_HOUR_LOOK.eveningHandover).toBeGreaterThan(0);
        expect(ODYSSEY_HOUR_LOOK.eveningHandover).toBeLessThanOrEqual(0.5);
        expect(ODYSSEY_HOUR_LOOK.hourHeld).toBeCloseTo(named('golden-hour').hour, 9);
        // The crowns' caps go to gold with the hour: all of it by the mountains' last orbs.
        expect(named('mountain-gold').hour * ODYSSEY_HOUR_LOOK.capGold).toBeGreaterThan(0.9);
        expect(ODYSSEY_HOUR_LOOK.capGoldTint[0]).toBeGreaterThan(ODYSSEY_HOUR_LOOK.capGoldTint[2] * 1.5);
    });
});

describe('the mist in the hollow', () => {
    const plate = bakeValleyMist(odysseyWorldHeight, ODYSSEY_SEA_LEVEL);

    it('is none on the island\'s morning, gathers through the afternoon, and is whole by the gold', () => {
        expect(hollowMistAt(0).amount).toBe(0);
        expect(hollowMistAt(ODYSSEY_HOLLOW_MIST.hour[0]).amount).toBe(0);
        expect(hollowMistAt(ODYSSEY_HOLLOW_MIST.hour[1]).amount).toBe(1);
        expect(hollowMistAt(1).amount).toBe(1);
        expect(hollowMistAt(NaN, NaN)).toEqual({ amount: 0, gather: hollowMistAt(0, 1).gather });
        // Whole at the mountains' first orbs (the afternoon keyframe's hour).
        const afternoon = ODYSSEY_COLOUR_SCRIPT.find((k) => k.name === 'mountain-afternoon');
        expect(hollowMistAt(afternoon.hour).amount).toBe(1);
        let prev = 0;
        for (let hour = 0; hour <= 1; hour += 0.01) {
            const { amount } = hollowMistAt(hour);
            expect(amount).toBeGreaterThanOrEqual(prev);
            prev = amount;
        }
    });

    it('thins and gathers with the weather\'s pool, across its whole range', () => {
        const [thin, thick] = ODYSSEY_WEATHER_RANGE.pool;
        expect(hollowMistAt(0.5, thin).gather).toBeCloseTo(0, 6);
        expect(hollowMistAt(0.5, thick).gather).toBeCloseTo(1, 6);
        expect(hollowMistAt(0.5, 1).gather).toBeGreaterThan(0.3);
        expect(hollowMistAt(0.5, 1).gather).toBeLessThan(0.7);
        // The banks' window stays open at the thinnest and never closes to a blanket at the thickest.
        const { window: cut, gather } = ODYSSEY_HOLLOW_MIST.bank;
        expect(cut[0] - gather).toBeGreaterThan(0.3);
        expect(cut[1]).toBeLessThan(1);
        // It never hides the land under it, and stays clear round the eye.
        expect(ODYSSEY_HOLLOW_MIST.alpha).toBeLessThan(0.6);
        expect(ODYSSEY_HOLLOW_MIST.near[0]).toBeGreaterThan(80);
    });

    it('lies in the hollows of the real island, over the grass, where the plate says there is a pool', () => {
        const built = buildHollowMistGeometry(odysseyWorldHeight, plate);
        const position = built.geometry.getAttribute('position');
        const pool = built.geometry.getAttribute('aPool');
        expect(built.triangles).toBeGreaterThan(2000);
        expect(built.triangles).toBeLessThan(12000);
        expect(built.deepest).toBeGreaterThan(ODYSSEY_HOLLOW_MIST.depth[1]);
        let pooled = 0;
        for (let i = 0; i < position.count; i += 1) {
            const x = position.getX(i);
            const z = position.getZ(i);
            const ground = odysseyWorldHeight(x, z);
            const depth = pool.getX(i);
            expect(Number.isFinite(position.getY(i))).toBe(true);
            // Over the ground everywhere, by a share of the pool's own depth.
            expect(position.getY(i)).toBeGreaterThanOrEqual(ground + ODYSSEY_HOLLOW_MIST.clear - 1e-3);
            expect(position.getY(i)).toBeLessThanOrEqual(ground + Math.max(depth, ODYSSEY_HOLLOW_MIST.clear) + 1e-3);
            expect(depth).toBeCloseTo(sampleValleyMist(plate, x, z).depth, 4);
            if (depth > ODYSSEY_HOLLOW_MIST.depth[1]) pooled += 1;
        }
        // A real pool, and not the whole basin: some of the sheet holds mist, most of it none.
        expect(pooled / position.count).toBeGreaterThan(0.03);
        expect(pooled / position.count).toBeLessThan(0.7);
        built.geometry.dispose();
    });
});

describe("the turn's wake", () => {
    // A stand of trees on the real island, round the glide's focus: every third a conifer.
    const trees = [];
    for (let i = 0; i < 160; i += 1) {
        const x = ODYSSEY_TURN_WAKE.focus[0] + (((i * 37) % 23) - 11) * 22;
        const z = ODYSSEY_TURN_WAKE.focus[1] + (((i * 53) % 19) - 9) * 20;
        const y = odysseyWorldHeight(x, z);
        if (y > ODYSSEY_SEA_LEVEL + 2) {
            trees.push({
                x, y, z, top: y + 11 + ((i * 7) % 9), broad: i % 3 !== 0,
            });
        }
    }
    const plan = planTurnWake(trees, odysseyWorldHeight);
    const L = ODYSSEY_TURN_WAKE.leaves;
    const B = ODYSSEY_TURN_WAKE.birds;

    it('answers from the broadleaf trees the glide looks at, the same every run', () => {
        expect(trees.length).toBeGreaterThan(100);
        expect(plan.leaves.length).toBe(L.count);
        expect(plan.birds.length).toBe(B.parties * B.each);
        expect(planTurnWake(trees, odysseyWorldHeight)).toEqual(plan);
        expect(planTurnWake(trees, odysseyWorldHeight, { leaves: 120 }).leaves.length).toBe(120);
        // No tree, no wake; conifers alone let nothing go.
        expect(planTurnWake([], odysseyWorldHeight)).toEqual({ leaves: [], birds: [] });
        const conifers = trees.filter((t) => !t.broad);
        expect(planTurnWake(conifers, odysseyWorldHeight)).toEqual({ leaves: [], birds: [] });
        // The reach is the stretch between the two orbs, not the island.
        expect(inTurnWakeReach(...ODYSSEY_TURN_WAKE.focus)).toBe(true);
        expect(inTurnWakeReach(600, 300)).toBe(false);
        expect(inTurnWakeReach(-185, -1200)).toBe(false);
    });

    it('lets each leaf go from a crown, throws it downwind and lands it on the grass', () => {
        const broad = trees.filter((t) => t.broad);
        plan.leaves.forEach((leaf) => {
            // It starts in a broadleaf's crown...
            const home = broad.find((t) => Math.hypot(t.x - leaf.x, t.z - leaf.z) < (t.top - t.y) * 0.3
                && leaf.y > t.y && leaf.y < t.top + 0.5);
            expect(home, 'a crown').toBeTruthy();
            expect(turnWakeLeafAt(leaf, 0)).toEqual({ x: leaf.x, y: leaf.y, z: leaf.z });
            // ...is over the land all the way, and ends at the grass.
            expect(leaf.life).toBeGreaterThanOrEqual(0.6);
            expect(leaf.life).toBeLessThanOrEqual(L.maxLife);
            for (let a = 0; a < leaf.life - 0.1; a += 0.25) {
                const at = turnWakeLeafAt(leaf, a);
                expect(at.y).toBeGreaterThan(odysseyWorldHeight(at.x, at.z));
            }
            const end = turnWakeLeafAt(leaf, leaf.life);
            if (leaf.life < L.maxLife) {
                expect(end.y - odysseyWorldHeight(end.x, end.z)).toBeLessThan(L.land + 0.05);
            }
            // Downwind of where it began: the gust's heading.
            const [hx, hz] = ODYSSEY_DAY_TURN.heading;
            const along = ((end.x - leaf.x) * hx) + ((end.z - leaf.z) * hz);
            expect(along).toBeGreaterThan(0);
            // Nothing of it before it lets go or after it lands; whole in between.
            expect(turnWakeShownAt(leaf, 0)).toBe(0);
            expect(turnWakeShownAt(leaf, -3)).toBe(0);
            expect(turnWakeShownAt(leaf, leaf.life)).toBe(0);
            expect(turnWakeShownAt(leaf, leaf.life + 5)).toBe(0);
            if (leaf.life > L.grow + L.settle + 0.2) {
                expect(turnWakeShownAt(leaf, (L.grow + (leaf.life - L.settle)) / 2)).toBe(1);
            }
            expect(leaf.wait).toBeGreaterThanOrEqual(0);
            expect(leaf.wait).toBeLessThanOrEqual(L.stagger);
        });
        // Most land well inside the time they may fly.
        const landed = plan.leaves.filter((leaf) => leaf.life < L.maxLife).length;
        expect(landed / plan.leaves.length).toBeGreaterThan(0.9);
    });

    it('lifts the birds out of crowns in parties, over the land, into trees downwind', () => {
        plan.birds.forEach((bird) => {
            const crownAt = (x, y, z) => trees.find((t) => Math.hypot(t.x - x, t.z - z) < 2 && y > t.y && y < t.top);
            const from = crownAt(bird.x, bird.y, bird.z);
            const into = crownAt(bird.tx, bird.ty, bird.tz);
            expect(from, 'the crown it leaves').toBeTruthy();
            expect(from.broad).toBe(true);
            expect(into, 'the crown it ends in').toBeTruthy();
            expect(turnWakeBirdAt(bird, 0)).toEqual({ x: bird.x, y: bird.y, z: bird.z });
            const end = turnWakeBirdAt(bird, bird.life);
            expect(end.x).toBeCloseTo(bird.tx, 6);
            expect(end.y).toBeCloseTo(bird.ty, 6);
            expect(end.z).toBeCloseTo(bird.tz, 6);
            // Clear of the ground in the open air, and no faster than a small bird flies.
            let prev = turnWakeBirdAt(bird, 0);
            for (let s = 1; s <= 40; s += 1) {
                const age = (s / 40) * bird.life;
                const at = turnWakeBirdAt(bird, age);
                if (s > 6 && s < 34) expect(at.y - odysseyWorldHeight(at.x, at.z)).toBeGreaterThan(B.clear * 0.4);
                const speed = Math.hypot(at.x - prev.x, at.y - prev.y, at.z - prev.z) / (bird.life / 40);
                expect(speed).toBeLessThan(75);
                prev = at;
            }
            expect(turnWakeShownAt(bird, 0)).toBe(0);
            expect(turnWakeShownAt(bird, bird.life)).toBe(0);
            expect(turnWakeShownAt(bird, bird.life / 2)).toBe(1);
        });
        // Parties lift one after another.
        const firstOf = (party) => Math.min(
            ...plan.birds.slice(party * B.each, (party + 1) * B.each).map((b) => b.wait),
        );
        for (let party = 1; party < B.parties; party += 1) {
            expect(firstOf(party)).toBeGreaterThan(firstOf(party - 1));
        }
    });

    it("sways the forest for the gust's few seconds and no longer", () => {
        expect(turnWakeGustAt(-1)).toBe(0);
        expect(turnWakeGustAt(0)).toBe(0);
        expect(turnWakeGustAt(Infinity)).toBe(0);
        expect(turnWakeGustAt(NaN)).toBe(0);
        const peak = turnWakeGustAt(ODYSSEY_TURN_WAKE.gust.rise);
        expect(peak).toBeCloseTo(ODYSSEY_TURN_WAKE.gust.gain, 9);
        let prev = 0;
        for (let t = 0; t < 30; t += 0.05) {
            const g = turnWakeGustAt(t);
            // No jump in or out.
            expect(Math.abs(g - prev)).toBeLessThan(0.13);
            expect(g).toBeLessThanOrEqual(peak + 1e-9);
            prev = g;
        }
        expect(turnWakeGustAt(30)).toBeLessThan(0.01);
    });

    describe('as a draw', () => {
        const clock = uniform(0);
        const wake = createOdysseyTurnWake({
            trees,
            heightAt: odysseyWorldHeight,
            time: clock,
            tints: [[0.7, 0.5, 0.1], [0.7, 0.4, 0.07], [0.55, 0.22, 0.06], [0.48, 0.09, 0.05]],
            skyColour: vec3(0.8, 0.85, 0.9),
            toOutput: (c) => c,
        });
        const [ox, oz] = ODYSSEY_DAY_TURN.origin;
        const [hx, hz] = ODYSSEY_DAY_TURN.heading;
        // The rail near the focus, and the shade's front just short of and just past it.
        const x = ODYSSEY_TURN_WAKE.focus[0] + 40;
        const z = ODYSSEY_TURN_WAKE.focus[1] + 120;
        const along = ((x - ox) * hx) + ((z - oz) * hz);

        it('is null where no broadleaf stands, and hidden until a gust is let go', () => {
            expect(createOdysseyTurnWake({
                trees: [],
                heightAt: odysseyWorldHeight,
                time: clock,
                tints: [],
                skyColour: vec3(1, 1, 1),
                toOutput: (c) => c,
            })).toBeNull();
            expect(wake.mesh.visible).toBe(false);
            // (The leaves: the birds are the fieldfares' own draw, odyssey-wake-fieldfares.test.js.)
            expect(wake.mesh.geometry.instanceCount).toBe(plan.leaves.length);
            expect(wake.update(10, along - 500, true, x, z)).toBe(0);
            expect(wake.mesh.visible).toBe(false);
        });

        it("lets one gust go as the shade's edge passes the rail, and leaves it alone until it is down", () => {
            expect(wake.update(10.1, along + 300, true, x, z)).toBe(0);
            expect(wake.uniforms.uWake.value.x).toBe(10.1);
            expect(wake.mesh.visible).toBe(true);
            expect(wake.update(10.6, along + 900, true, x, z)).toBeGreaterThan(0.5);
            // The shade comes back over the rail while the leaves are in the air: nothing resets.
            wake.update(12, along - 200, true, x, z);
            expect(wake.uniforms.uWake.value.x).toBe(10.1);
            // The world may hide it (under water, a bisect lever) without ending it.
            wake.update(12.1, along - 300, true, x, z, false);
            expect(wake.mesh.visible).toBe(false);
            wake.update(12.2, along - 300, true, x, z, true);
            expect(wake.mesh.visible).toBe(true);
            // When the last leaf is down the draw goes, and the next crossing lets a new one go.
            wake.update(60, along - 300, true, x, z);
            expect(wake.mesh.visible).toBe(false);
            wake.update(60.1, along + 300, true, x, z);
            expect(wake.uniforms.uWake.value.x).toBe(60.1);
            expect(wake.mesh.visible).toBe(true);
        });

        it('lets nothing go with no shade travelling (reduced motion) or far from the glide', () => {
            wake.update(200, along - 300, false, x, z);
            wake.update(200.1, along + 300, false, x, z);
            expect(wake.uniforms.uWake.value.x).toBe(60.1);
            // The same crossing seen from far up the mountain.
            const fx = x - 900;
            const fz = z - 1200;
            const far = ((fx - ox) * hx) + ((fz - oz) * hz);
            wake.update(201, far - 300, true, fx, fz);
            wake.update(201.1, far + 300, true, fx, fz);
            expect(wake.uniforms.uWake.value.x).toBe(60.1);
            // A clock that goes back (a new board) forgets the old gust, and the next is its own.
            expect(wake.update(5, along - 300, false, x, z)).toBe(0);
            expect(wake.mesh.visible).toBe(false);
            wake.update(5.1, along - 300, true, x, z);
            wake.update(5.2, along + 300, true, x, z);
            expect(wake.uniforms.uWake.value.x).toBe(5.2);
        });

        BACKENDS.forEach(([label, Builder]) => {
            it(`builds clean (${label})`, () => {
                const out = build(Builder, wake.mesh);
                expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard).toEqual([]);
                ['vertex', 'fragment'].forEach((stage) => {
                    expect(typeof out[stage]).toBe('string');
                    expect(out[stage]).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                });
                if (label === 'WGSL') {
                    expect(unassignedReads(out.vertex), 'vertex').toEqual([]);
                    expect(unassignedReads(out.fragment), 'fragment').toEqual([]);
                }
            }, 60_000);
        });
    });
});
