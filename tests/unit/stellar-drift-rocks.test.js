/**
 * Stellar Drift — the rocks of the haze, on the CPU: the drifting field's plan, the hero rocks'
 * passes (their CPU twin is what the shader is fed), and the world that draws them.
 *
 * What is pinned is behaviour, not tuning: the field is deterministic and wears every design, its
 * big bodies ride nearer the lens; a hero's pass starts and ends out of sight, never crosses the
 * card, its HUD or the giant, never rides over another hero, and a hero is nearly always in sight.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FIELD_CLASSES, HERO, HERO_ROWS, ICE_DESIGNS, ROCK_DESIGNS, createHeroPass, heroAt, heroLanes, heroPassAt,
    planField, planHeroPass,
} from '../../src/themes/stellar-drift/stellar-drift-rocks.js';
import {
    REST_RIG, StellarDriftWorld, fovForAspect,
} from '../../src/themes/stellar-drift/stellar-drift-world.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/stellar-drift/stellar-drift-quality.js';
import { WORLD_SEED } from '../../src/themes/stellar-drift/stellar-drift-bake.js';
import { fallbackLayout } from '../../src/themes/stellar-drift/stellar-drift-composition.js';

const SEED = 4321;
const WIDE = [16 / 9, 4 / 3, 21 / 9];

/** Walk every hero over `seconds` of the drift clock; what was seen, where. */
function walk(aspect, count = 3, seconds = 4000, step = 0.5) {
    const lanes = heroLanes(aspect);
    const states = Array.from({ length: count }, createHeroPass);
    const at = {
        x: 0, y: 0, live: false, along: 0,
    };
    const seen = Array.from({ length: count }, () => 0);
    let samples = 0;
    let any = 0;
    let overlap = 0;
    let trespass = 0;
    for (let t = 0; t < seconds; t += step) {
        samples += 1;
        const shown = [];
        for (let i = 0; i < count; i++) {
            heroAt(SEED, i, t, lanes, states[i], at);
            const r = states[i].radius;
            if (!at.live || at.x < -r || at.y < -r || at.x > lanes.aspect + r || at.y > 1 + r) continue;
            seen[i] += 1;
            shown.push([at.x, at.y, r]);
            const g = lanes.giant;
            if (Math.hypot(at.x - g.x, at.y - g.y) < g.r * 0.9 + r * 0.5) trespass += 1;
            for (const rect of lanes.rects) {
                if (at.x > rect.x0 - r && at.x < rect.x1 + r && at.y > rect.y0 - r && at.y < rect.y1 + r) trespass += 1;
            }
        }
        if (shown.length) any += 1;
        for (let p = 0; p < shown.length; p++) {
            for (let q = p + 1; q < shown.length; q++) {
                const apart = Math.hypot(shown[p][0] - shown[q][0], shown[p][1] - shown[q][1]);
                if (apart < shown[p][2] + shown[q][2]) overlap += 1;
            }
        }
    }
    return {
        lanes, seen: seen.map((n) => n / samples), any: any / samples, overlap, trespass,
    };
}

describe('stellar drift rocks: the drifting field', () => {
    it.each(Object.keys(FIELD_CLASSES))('plans the %s alike every time, wearing every design', (name) => {
        const cls = FIELD_CLASSES[name];
        const a = planField(SEED, 48, cls);
        const b = planField(SEED, 48, cls);
        expect(a.place).toEqual(b.place);
        expect(a.look).toEqual(b.look);
        expect(planField(SEED + 1, 48, cls).place).not.toEqual(a.place);
        const variants = new Set();
        for (let i = 0; i < 48; i++) {
            const depth = a.place[i * 4 + 2];
            expect(depth).toBeGreaterThanOrEqual(cls.depth[0] - 1e-6);
            expect(depth).toBeLessThanOrEqual(cls.depth[1] + 1e-6);
            // Its radius spans the class's angles at its depth.
            const angle = a.place[i * 4 + 3] / depth;
            expect(angle).toBeGreaterThanOrEqual(cls.angle[0] - 1e-7);
            expect(angle).toBeLessThanOrEqual(cls.angle[1] + 1e-7);
            expect(Math.hypot(a.spin[i * 4], a.spin[i * 4 + 1], a.spin[i * 4 + 2])).toBeCloseTo(1, 5);
            variants.add(a.look[i * 4]);
            expect([0, 1]).toContain(a.look[i * 4 + 1]);
        }
        expect(variants.size).toBe(ROCK_DESIGNS.length);
    });

    it('rides its big bodies near the lens and its small ones far', () => {
        const cls = FIELD_CLASSES.boulders;
        const plan = planField(SEED, 400, cls);
        // (its angle on screen, its depth)
        const rows = Array.from({ length: 400 }, (_, i) => [
            plan.place[i * 4 + 3] / plan.place[i * 4 + 2], plan.place[i * 4 + 2],
        ]);
        rows.sort((p, q) => q[0] - p[0]);
        const nearOfBig = rows.slice(0, 40).reduce((s, r) => s + r[1], 0) / 40;
        const nearOfSmall = rows.slice(-200).reduce((s, r) => s + r[1], 0) / 200;
        expect(nearOfBig).toBeLessThan(nearOfSmall * 0.8);
        // ...and most of the field is small: a few large ones, many small.
        const mid = (cls.angle[0] + cls.angle[1]) / 2;
        expect(rows.filter((r) => r[0] > mid).length).toBeLessThan(rows.filter((r) => r[0] <= mid).length * 0.6);
    });

    it('dresses icy designs as ice and rocky ones mostly as rock', () => {
        const plan = planField(SEED, 600, FIELD_CLASSES.boulders);
        let icyIce = 0;
        let icy = 0;
        let rockyIce = 0;
        let rocky = 0;
        for (let i = 0; i < 600; i++) {
            const design = ROCK_DESIGNS[plan.look[i * 4]];
            const ice = plan.look[i * 4 + 1];
            if (ICE_DESIGNS.includes(design)) {
                icy += 1;
                icyIce += ice;
            } else {
                rocky += 1;
                rockyIce += ice;
            }
        }
        expect(icyIce / icy).toBeGreaterThan(0.75);
        expect(rockyIce / rocky).toBeLessThan(0.3);
    });
});

describe('stellar drift rocks: the hero rocks', () => {
    it.each(WIDE)('at aspect %f, keeps off the card, its HUD and the giant, and off one another', (aspect) => {
        const out = walk(aspect);
        expect(out.trespass).toBe(0);
        expect(out.overlap).toBe(0);
        // Nearly always one in sight; each hero in sight a good share of the time.
        expect(out.any).toBeGreaterThan(0.75);
        out.seen.forEach((share) => expect(share).toBeGreaterThan(0.15));
    });

    it('keeps out of the card on a tall phone too, below it where the giant is not', () => {
        const out = walk(390 / 844);
        expect(out.trespass).toBe(0);
        expect(out.overlap).toBe(0);
        expect(out.lanes.lanes.map((lane) => lane.name)).toContain('below');
        expect(out.any).toBeGreaterThan(0.4);
    });

    it('starts and ends every pass beyond the frame, so a new one never pops in', () => {
        const lanes = heroLanes(16 / 9);
        for (let index = 0; index < 3; index++) {
            for (let pass = 0; pass < 40; pass++) {
                const s = planHeroPass(SEED, index, pass, lanes, createHeroPass());
                const room = s.radius * 1.12;
                [s.from, s.to].forEach((p) => {
                    const outside = p.x < -room || p.x > lanes.aspect + room || p.y < -room || p.y > 1 + room;
                    expect(outside).toBe(true);
                });
                // A pass fits its period, with a breath of out-of-sight between.
                const period = HERO.periods[index];
                expect(s.duration).toBeLessThan(period);
                expect(s.start).toBeCloseTo((pass - HERO.phases[index]) * period, 6);
            }
        }
    });

    it('is a closed form of the clock: the same moment gives the same place, however it was reached', () => {
        const lanes = heroLanes(16 / 9);
        const at = (index, t, state) => {
            const out = heroAt(SEED, index, t, lanes, state);
            return [out.x, out.y, out.live];
        };
        for (let index = 0; index < 3; index++) {
            const walked = createHeroPass();
            for (let t = 0; t < 600; t += 7) at(index, t, walked);
            expect(at(index, 600, walked)).toEqual(at(index, 600, createHeroPass()));
            expect(heroPassAt(index, 600)).toBe(walked.pass);
        }
    });

    it('wears a different design from one pass to the next, each hero its own size range', () => {
        const lanes = heroLanes(16 / 9);
        for (let index = 0; index < 3; index++) {
            let last = -1;
            for (let pass = 0; pass < 12; pass++) {
                const s = planHeroPass(SEED, index, pass, lanes, createHeroPass());
                expect(s.variant).not.toBe(last);
                last = s.variant;
                expect(s.ice).toBe(ICE_DESIGNS.includes(ROCK_DESIGNS[s.variant]) ? 1 : 0);
                // 40..140 px across on a 900-line frame.
                const across = s.radius * 2 * 900;
                expect(across).toBeGreaterThan(40);
                expect(across).toBeLessThan(145);
                expect(Math.hypot(s.axis.x, s.axis.y, s.axis.z)).toBeCloseTo(1, 5);
            }
        }
    });
});

describe('stellar drift rocks: in the world', () => {
    function makeWorld(quality, at = 30) {
        const scene = new THREE.Scene();
        const aspect = 16 / 9;
        const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        const world = new StellarDriftWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, aspect);
        world.setLayout(fallbackLayout(1600, 900), aspect);
        world.seek(at);
        const sim = {
            time: at, delta: 0, pointerX: 0, pointerY: 0,
        };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
        return { world, camera };
    }

    it.each(QUALITY_NAMES)('draws the tier\'s counts on %s, one mesh a class', (quality) => {
        const { world } = makeWorld(quality);
        const [boulders, shards, motes, heroes] = QUALITY[quality].ice;
        expect(world.parts.boulders.geometry.instanceCount).toBe(boulders);
        expect(world.parts.shards.geometry.instanceCount).toBe(shards);
        expect(world.parts.motes.geometry.instanceCount).toBe(motes);
        expect(world.parts.heroes.geometry.instanceCount).toBe(heroes);
        // Every tier keeps the look: heroes and every class of the field.
        expect(heroes).toBeGreaterThanOrEqual(2);
        expect(boulders).toBeGreaterThan(0);
        world.dispose();
    });

    it('feeds the shader where the CPU twin says each hero is, and nothing new a frame', () => {
        const { world, camera } = makeWorld('High', 30);
        const { heroes } = world.ice;
        const { geometry, material, table } = heroes;
        const rows = table.array;
        const rest = world.restCamera();
        const lanes = heroes.lanesFor(16 / 9);
        const seed = WORLD_SEED + 53 + 393;
        let checked = 0;
        for (let t = 30; t < 400; t += 9.5) {
            const sim = {
                time: t, delta: 0, pointerX: 0, pointerY: 0,
            };
            world.seek(t);
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            for (let i = 0; i < heroes.count; i++) {
                const twin = heroAt(seed, i, world.ice.frame.clock.value, lanes, createHeroPass());
                const row = rows[i * HERO_ROWS];
                expect(row.w > 0).toBe(twin.live);
                if (!twin.live) continue;
                const p = new THREE.Vector3(row.x, row.y, row.z).project(rest);
                expect((p.x + 1) / 2).toBeCloseTo(twin.x / lanes.aspect, 3);
                expect((1 - p.y) / 2).toBeCloseTo(twin.y, 3);
                checked += 1;
            }
        }
        expect(checked).toBeGreaterThan(20);
        expect(heroes.geometry).toBe(geometry);
        expect(heroes.material).toBe(material);
        expect(heroes.table.array).toBe(rows);
        world.dispose();
    });
});
