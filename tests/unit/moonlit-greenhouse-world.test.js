/**
 * Moonlit Greenhouse — the world, end to end in Node (no renderer): every tier builds its parts,
 * the moon stands where the frame puts it, locks open blooms beside the card (lower pieces nearer),
 * clears release fireflies, waves and pollen, a chain pulls the fireflies into step and the moss up
 * the columns, four lines hush the house and open the Queen of the Night, the night turns with the
 * level and the clock, and a seek plus the same script gives the same world.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    MOONLIT_GREENHOUSE_PARTS, MoonlitGreenhouseWorld,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-world.js';
import { QUALITY_NAMES } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-quality.js';
import { fallbackLayout } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-composition.js';
import {
    NIGHT_SECONDS, TIMING, mossForCombo, syncForCombo,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-core.js';

const W = 1600;
const H = 900;
const COLORS = ['#ffda9e', '#d7b3ff', '#82f5b8', '#ff9ecf', '#5b7ba7', '#ffd76a', '#a8ffd8'];

function makeWorld(options = {}) {
    const scene = new THREE.Scene();
    const world = new MoonlitGreenhouseWorld({ scene, quality: 'Low', ...options }).build();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 400);
    world.bindCamera(camera);
    const layout = options.noBoard ? null : fallbackLayout(W, H);
    world.setLayout(layout, W / H);
    world.setViewport(W, H, W / H);
    world.seek(options.start ?? 10);
    let t = world.clock;
    const step = (seconds, dt = 1 / 30) => {
        const n = Math.max(1, Math.round(seconds / dt));
        for (let i = 0; i < n; i += 1) {
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
        world, scene, camera, layout, step,
    };
}

function onScreen(camera, p) {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5, z: v.z };
}

const inside = (r, p) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;

/** Record every bloom the world asks the garden to open. */
function recordBlooms(world) {
    const added = [];
    const add = world.parts.blooms.add.bind(world.parts.blooms);
    world.parts.blooms.add = (b) => {
        added.push({ ...b });
        return add(b);
    };
    return added;
}

describe('moonlit greenhouse world', () => {
    it('builds exactly its parts at every tier, and leaves nothing behind', () => {
        QUALITY_NAMES.forEach((quality) => {
            const scene = new THREE.Scene();
            const world = new MoonlitGreenhouseWorld({ scene, quality }).build();
            expect(Object.keys(world.parts).sort()).toEqual([...MOONLIT_GREENHOUSE_PARTS].sort());
            world.showOnlyParts(['glass', 'water']);
            expect(world.parts.glass.mesh.visible).toBe(true);
            expect(world.parts.palms.mesh.visible).toBe(false);
            world.dispose();
            expect(scene.children.length).toBe(0);
        });
    }, 60000);

    it('stands the moon where the frame puts it, left of the card and high', () => {
        const { world, layout } = makeWorld();
        const card = layout.cards[0];
        expect(world.moonScreen.visible).toBe(1);
        expect(world.moonScreen.x).toBeLessThan(card.x0);
        expect(world.moonScreen.y).toBeLessThan(0.35);
        // The clock's drift moves it by a few degrees at most.
        expect(Math.abs(world.moonScreen.x - world.frame.moonX)).toBeLessThan(0.08);
        expect(Math.abs(world.moonScreen.y - world.frame.moonY)).toBeLessThan(0.08);
        // Its light comes down through the left of the vault: the shadowing crowns are the left palms.
        expect(world.U.crownCount.value).toBeGreaterThan(0);
        for (let i = 0; i < world.U.crownCount.value; i += 1) expect(world.crownRowsV[i * 2].x).toBeLessThan(0);
    });

    it('opens every lock\'s bloom beside the card, on screen, in the beds or on the canal', () => {
        const {
            world, camera, layout, step,
        } = makeWorld();
        const added = recordBlooms(world);
        const card = layout.cards[0];
        for (let i = 0; i < 14; i += 1) {
            world.onLock({
                rows: [19 - ((i * 5) % 17)], u: (i * 0.37) % 1, color: COLORS[i % 7], hardDrop: i % 4 === 3,
            });
            step(0.2);
        }
        expect(added).toHaveLength(14);
        added.forEach((b) => {
            const s = onScreen(camera, b);
            expect(s.x).toBeGreaterThan(-0.02);
            expect(s.x).toBeLessThan(1.02);
            expect(s.y).toBeLessThan(1.02);
            expect(inside(card, s)).toBe(false);
            expect(b.at).toBeGreaterThan(0);
        });
        expect(added.some((b) => b.onWater) || added.some((b) => !b.onWater)).toBe(true);
        expect(world.getState().locks).toBe(14);
        // A seed is in flight from the card's edge until it lands, then gone.
        world.onLock({ rows: [12], u: 0.2, color: COLORS[2] });
        step(TIMING.seedFlight * 0.4);
        expect(world.getState().seeds).toBeGreaterThan(0);
        step(TIMING.seedFlight + 0.3);
        expect(world.getState().seeds).toBe(0);
    });

    it('opens a low piece\'s bloom nearer the eye than a high one\'s', () => {
        const { world, step } = makeWorld();
        const added = recordBlooms(world);
        world.onLock({ rows: [19], u: 0.15, color: COLORS[0] });
        world.onLock({ rows: [2], u: 0.15, color: COLORS[0] });
        step(0.1);
        const [low, high] = added;
        const eye = world.camera.position;
        expect(Math.hypot(low.x - eye.x, low.z - eye.z)).toBeLessThan(Math.hypot(high.x - eye.x, high.z - eye.z));
    });

    it('rings the canal where a bloom opens on the water, and shakes the dew loose on a hard drop', () => {
        const { world, step } = makeWorld();
        const added = recordBlooms(world);
        let tries = 0;
        while (!added.some((b) => b.onWater) && tries < 40) {
            world.onLock({ rows: [19 - (tries % 6)], u: 0.4 + (tries % 5) * 0.05, color: COLORS[3] });
            tries += 1;
        }
        if (added.some((b) => b.onWater)) {
            step(TIMING.seedFlight + 0.2);
            expect(world.getState().rings).toBeGreaterThan(0);
        }
        const at = world.clock;
        world.onLock({
            rows: [18], u: 0.8, color: COLORS[1], hardDrop: true,
        });
        step(1 / 30);
        expect(world.U.dew.value.x).toBeCloseTo(at, 6);
        expect(world.U.dew.value.y).toBeGreaterThan(0);
    });

    it('rings the water from the lily itself and brings the seed down on the flower\'s heart', () => {
        const { world } = makeWorld();
        const records = [];
        const add = world.parts.blooms.add.bind(world.parts.blooms);
        world.parts.blooms.add = (b) => {
            const r = add(b);
            records.push(r);
            return r;
        };
        for (let i = 0; i < 40 && !records.some((r) => r?.onWater); i += 1) {
            world.onLock({ rows: [19 - (i % 9)], u: (i * 0.23) % 1, color: COLORS[i % 7] });
        }
        const lily = records.find((r) => r?.onWater);
        expect(lily).toBeTruthy();
        const ring = world.ringRowsV.slice(0, world.ringCount * 2).filter((_, i) => i % 2 === 0)
            .find((row) => Math.abs(row.z - lily.at) < 1e-9);
        expect(ring.x).toBeCloseTo(lily.x, 6);
        expect(ring.y).toBeCloseTo(lily.z, 6);
        const seed = world.seeds[records.indexOf(lily)];
        expect(seed.to.x).toBeCloseTo(lily.heart.x, 6);
        expect(seed.to.y).toBeCloseTo(lily.heart.y, 6);
        expect(seed.to.z).toBeCloseTo(lily.heart.z, 6);
    });

    it('turns back to the first night the short way round after a long run', () => {
        const { world, step } = makeWorld();
        world.levelUp(15, { silent: true });
        step(0.5);
        world.resetSession();
        let travel = 0;
        let last = world.levelPlace();
        // It does turn (the step eases off), just not through the whole wheel.
        expect(((last % 6) + 6) % 6).toBeCloseTo(2, 1);
        for (let i = 0; i < 90; i += 1) {
            step(0.1);
            const now = world.levelPlace();
            travel += Math.abs(now - last);
            last = now;
        }
        // Level 15 is place 14 on the wheel of six, two nights from the first: never fourteen.
        expect(travel).toBeLessThanOrEqual(3 + 1e-9);
        expect(((last % 6) + 6) % 6).toBeCloseTo(0, 6);
        // A step up the levels is still one night, and a drop of many levels the short way too.
        world.levelUp(2);
        step(8);
        expect(world.levelPlace()).toBeCloseTo(1, 6);
        world.levelUp(12);
        const start = world.levelPlace();
        step(8);
        expect(Math.abs(world.levelPlace() - start)).toBeLessThanOrEqual(3 + 1e-9);
    });

    it('releases fireflies from the cleared rows, a wave a line and the oldest blooms\' pollen', () => {
        const { world, step } = makeWorld();
        for (let i = 0; i < 8; i += 1) world.onLock({ rows: [19 - i], u: (i * 0.29) % 1, color: COLORS[i % 7] });
        step(TIMING.seedFlight + TIMING.bloomOpen + 0.2);
        const { open } = world.getState();
        expect(open).toBe(8);
        world.onClear({ rows: [19, 18], lines: 2, combo: 1 });
        step(0.05);
        const s = world.getState();
        expect(s.fliers).toBe(2 * 2 * 9);
        expect(s.waves).toBe(2);
        expect(s.released).toBe(2);
        expect(s.pollen).toBeGreaterThan(0);
        // Four lines release every bloom.
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, combo: 1 });
        step(0.05);
        expect(world.getState().released).toBe(8);
    });

    it('turns the air on a T-spin and lets it settle', () => {
        const { world, step } = makeWorld();
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        step(TIMING.turn * 0.5);
        expect(world.U.turn.value.y).toBeGreaterThan(0.5);
        expect(world.U.gust.value).toBeGreaterThan(0.2);
        step(TIMING.turn);
        expect(world.U.turn.value.y).toBe(0);
    });

    it('hushes the house on four lines, then opens the Queen of the Night and floods the panes', () => {
        const { world, step } = makeWorld();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(TIMING.hush * 0.5);
        expect(world.U.hush.value).toBeGreaterThan(0.5);
        expect(world.U.moonLight.value).toBeLessThan(0.7);
        expect(world.U.queen.value.x).toBe(0);
        step(TIMING.hush * 0.5 + TIMING.queenOpen + 0.3);
        expect(world.U.queen.value.x).toBeGreaterThan(0.9);
        expect(world.U.hush.value).toBeLessThan(0.1);
        expect(world.getState().queens).toBe(1);
        step(TIMING.queenHold + TIMING.queenClose + 0.5);
        expect(world.U.queen.value.x).toBe(0);
        // A perfect clear opens the second whorl.
        world.onClear({
            rows: [19, 18, 17, 16], lines: 4, perfect: true,
        });
        step(TIMING.hush + 0.6);
        expect(world.U.queen.value.w).toBe(1);
        expect(world.U.flood.value).toBeGreaterThan(0);
    });

    it('pulls the fireflies into step and the moss up the columns with a chain, and lets go', () => {
        const { world, step } = makeWorld();
        for (let n = 1; n <= 8; n += 1) world.onCombo(n);
        step(8);
        expect(world.U.sync.value).toBeGreaterThan(syncForCombo(8) - 0.05);
        expect(world.U.moss.value).toBeGreaterThan(mossForCombo(8) - 0.15);
        const flock = world.U.swarm.value;
        expect(flock).toBeGreaterThan(0.9);
        world.onCombo(0);
        step(14);
        expect(world.U.sync.value).toBeLessThan(0.05);
        expect(world.U.moss.value).toBeLessThan(0.2);
        expect(world.U.swarm.value).toBeLessThan(flock);
    });

    it('drifts the night with the clock and steps it with the level', () => {
        const { world, step } = makeWorld({ start: 0 });
        const before = world.nightPlace();
        step(30);
        expect(world.nightPlace() - before).toBeCloseTo(30 / NIGHT_SECONDS, 2);
        const drift = world.clock / NIGHT_SECONDS;
        world.levelUp(2);
        step(0.5);
        expect(world.levelPlace()).toBeGreaterThan(0);
        expect(world.levelPlace()).toBeLessThan(1);
        step(10);
        expect(world.levelPlace()).toBeCloseTo(1, 6);
        expect(world.nightPlace()).toBeCloseTo(1 + world.clock / NIGHT_SECONDS, 6);
        expect(world.clock / NIGHT_SECONDS).toBeGreaterThan(drift);
        // A new run eases the level's step back off; the clock runs on.
        const { clock } = world;
        world.resetSession();
        step(10);
        expect(world.levelPlace()).toBeCloseTo(0, 6);
        expect(world.clock).toBeGreaterThan(clock);
        expect(world.getState().open).toBe(0);
    });

    it('lands every aim where it was aimed, never on a kerb\'s far side or across the house', () => {
        const { world, camera } = makeWorld();
        let checked = 0;
        for (let y = 0.63; y <= 0.97; y += 0.02) {
            for (let x = 0.03; x <= 0.97; x += 0.04) {
                const hit = world.castGround(x, y, {});
                // Points the house clamps (the far end, the walls) are allowed to move; the rest must
                // project back onto the point that was aimed at.
                const clamped = hit.z <= -43.9 || Math.abs(hit.x) >= 6.39 || hit.kind === 'bed';
                if (clamped) continue;
                const s = onScreen(camera, hit);
                expect(Math.hypot(s.x - x, s.y - y), `aim ${x.toFixed(2)}, ${y.toFixed(2)}`).toBeLessThan(0.03);
                checked += 1;
            }
        }
        expect(checked).toBeGreaterThan(100);
        // A ray over the horizon still lands inside the house.
        const high = world.castGround(0.2, 0.3, {});
        expect(Math.abs(high.x)).toBeLessThan(7);
        expect(high.z).toBeGreaterThanOrEqual(-44);
    });

    it('is a fresh world after a seek, whatever the last run left', () => {
        const used = makeWorld({ start: 5 });
        for (let n = 1; n <= 8; n += 1) used.world.onCombo(n);
        used.world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        used.step(11);
        used.world.seek(20);
        used.step(5);
        const fresh = makeWorld({ start: 20 });
        fresh.step(5);
        const a = used.world.getState();
        const b = fresh.world.getState();
        ['sync', 'moss', 'swarm', 'combo', 'open', 'rings', 'waves']
            .forEach((key) => expect(a[key], key).toBeCloseTo(b[key], 6));
        expect(used.world.U.crownCount.value).toBe(fresh.world.U.crownCount.value);
    });

    it('keeps the Queen open through a second four lines, and lets her glow go smoothly', () => {
        const { world, step } = makeWorld();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(TIMING.hush + TIMING.queenOpen + 1);
        expect(world.U.queen.value.x).toBeGreaterThan(0.95);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
        let least = 1;
        for (let i = 0; i < 30; i += 1) {
            step(1 / 30);
            least = Math.min(least, world.U.queen.value.x);
        }
        expect(least).toBeGreaterThan(0.95);
        expect(world.U.hush.value).toBe(0);
        expect(world.U.queen.value.w).toBe(1);
        expect(world.U.flood.value).toBeGreaterThan(0);
        // Her end: the glow fades with her, never dropping in a frame.
        let last = world.U.queen.value.y;
        let jump = 0;
        for (let i = 0; i < 30 * 16; i += 1) {
            step(1 / 30);
            const g = world.U.queen.value.y;
            jump = Math.max(jump, last - g);
            last = g;
        }
        expect(world.U.queen.value.x).toBe(0);
        expect(jump).toBeLessThan(0.05);
    });

    it('hands the post stack the same object every frame', () => {
        const { world, step } = makeWorld();
        const a = world.getPostState();
        step(0.1);
        expect(world.getPostState()).toBe(a);
        expect(a.exposure).toBeGreaterThan(0);
        expect(a.moonX).toBeGreaterThan(0);
    });

    it('is the same world after a seek and the same script, at 30 and at 120 frames a second', () => {
        const script = (world, step) => {
            for (let i = 0; i < 6; i += 1) {
                world.onLock({
                    rows: [19 - i], u: (i * 0.41) % 1, color: COLORS[i % 7], hardDrop: i === 2,
                });
                step(0.3);
            }
            world.onCombo(1);
            world.onClear({ rows: [19], lines: 1, combo: 1 });
            step(0.6);
            world.onCombo(2);
            world.onClear({
                rows: [19, 18], lines: 2, combo: 2, tspin: true,
            });
            step(1.2);
        };
        const run = (dt) => {
            const { world, step } = makeWorld({ start: 12 });
            const fixed = (s) => step(s, dt);
            script(world, fixed);
            const s = world.getState();
            delete s.time;
            return s;
        };
        const a = run(1 / 30);
        const b = run(1 / 30);
        expect(b).toEqual(a);
        const c = run(1 / 120);
        expect(c.open).toBe(a.open);
        expect(c.released).toBe(a.released);
        expect(c.locks).toBe(a.locks);
        expect(c.sync).toBeCloseTo(a.sync, 1);
    });
});
