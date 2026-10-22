import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    SAND_FLOW, ShiftingSandsWorld, WORLD_TIERS, idleWind,
} from '../../src/themes/shifting-sands/shifting-sands-world.js';
import { BLOW_SLOTS, FX_TIERS } from '../../src/themes/shifting-sands/shifting-sands-fx.js';
import { GROUND_PULSE_SLOTS, TERRAIN_TIERS } from '../../src/themes/shifting-sands/shifting-sands-terrain.js';
import { POST_LOOK } from '../../src/themes/shifting-sands/shifting-sands-post.js';
import { SETTLE, SLOT_SUMMONED } from '../../src/themes/shifting-sands/shifting-sands-worm.js';

const TIERS = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

function countDescendants(root) {
    let n = 0;
    root.traverse(() => { n += 1; });
    return n;
}

function makeWorld(quality = 'Minimal') {
    const scene = new THREE.Scene();
    const world = new ShiftingSandsWorld({ scene, quality, capture: true }).build();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 2, 26000);
    return { scene, world, camera };
}

/** Frames from the world's clock to `to`, at `dt`. */
function advance(world, camera, to, dt = 1 / 30) {
    while (world.time < to - 1e-9) {
        const t = Math.min(to, world.time + dt);
        world.update({ time: t, delta: t - world.time }, camera);
    }
}

/**
 * The tray's Fever, as the bus sends it: twelve hard-dropped locks 0.64 s apart, each clearing
 * (singles into triples, a T-spin, a four-wave cascade), ending in a quad and its perfect clear.
 */
function fever(world, camera, start) {
    const plan = [1, 1, 2, 1, 2, 2, 3, 'tspin', 2, 'cascade', 3, 4];
    let t = start;
    plan.forEach((step, n) => {
        if (n > 0) t += 0.64;
        advance(world, camera, t);
        world.onHardDrop();
        world.onPieceLock();
        if (step === 'cascade') {
            world.onLineClear(2, { cascade: 1 });
            for (let w = 2; w <= 4; w++) {
                t += 0.36;
                advance(world, camera, t);
                world.onCombo(w);
                world.onLineClear(w % 3 === 0 ? 2 : 1, { cascade: w });
            }
        } else if (step === 'tspin') {
            world.onLineClear(2, { cascade: 1 });
            world.onTSpin(2);
        } else {
            world.onLineClear(step, { cascade: 1 });
        }
    });
    t += 0.36;
    advance(world, camera, t);
    world.onPerfectClear();
    return t;
}

/** What the player sees of the sandstorm and the light, this frame. */
function reading(world) {
    const s = world.shared;
    return {
        storm: world.heat.storm,
        burn: s.uHeat.value.w,
        windRise: s.uWind.value - idleWind(world.time),
        gold: s.uGoldGlow.value,
        flare: s.uSunFlare.value,
        bloom: world.bloomBoost,
        flash: world.flash,
        gust: s.uGust.value,
    };
}

describe('shifting sands tiers', () => {
    it('defines every quality tier for content, terrain, fx and post', () => {
        for (const t of TIERS) {
            expect(WORLD_TIERS[t]).toBeTruthy();
            expect(TERRAIN_TIERS[t]).toBeTruthy();
            expect(FX_TIERS[t]).toBeTruthy();
            expect(POST_LOOK[t]).toBeTruthy();
        }
    });

    it('scales the terrain and particle budgets monotonically with the tier', () => {
        for (let i = 1; i < TIERS.length; i++) {
            const a = TIERS[i - 1];
            const b = TIERS[i];
            const verts = (t) => TERRAIN_TIERS[t].rows * TERRAIN_TIERS[t].cols;
            expect(verts(b)).toBeGreaterThanOrEqual(verts(a));
            expect(FX_TIERS[b].motes).toBeGreaterThanOrEqual(FX_TIERS[a].motes);
            expect(FX_TIERS[b].wormSand).toBeGreaterThanOrEqual(FX_TIERS[a].wormSand);
        }
    });
});

describe('shifting sands world', () => {
    it('stands the camera above the sand and frames the suns on screen', () => {
        const { world, camera } = makeWorld();
        world.updateCamera(camera, { time: 0, pointerX: 0, pointerY: 0 });
        world.update({ time: 0, delta: 0 }, camera);
        const ground = world.field.height(camera.position.x, camera.position.z);
        expect(camera.position.y - ground).toBeGreaterThan(20);
        const sun = world.getSunScreen();
        expect(sun.visible).toBe(1);
        expect(sun.x).toBeGreaterThan(0);
        expect(sun.x).toBeLessThan(0.5);
        expect(sun.horizonY).toBeGreaterThan(sun.y);
        world.dispose();
    });

    it('creates nothing at event time: events are uniform writes', () => {
        const { scene, world, camera } = makeWorld();
        const before = countDescendants(scene);
        world.onHardDrop();
        world.onPieceLock();
        world.onCombo(5);
        world.onLineClear(2);
        world.onTSpin(0);
        world.onTSpin(2);
        world.onBackToBack();
        world.onLineClear(4);
        world.onPerfectClear();
        world.onLevelUp(6);
        for (let i = 1; i <= 30; i++) world.update({ time: i / 10, delta: 0.1 }, camera);
        expect(countDescendants(scene)).toBe(before);
        world.dispose();
        expect(scene.children.length).toBe(0);
    });

    it('answers a Tetris with the worm and a dust geyser at its emergence', () => {
        const { world, camera } = makeWorld();
        world.seek(10);
        world.update({ time: 10, delta: 0 }, camera);
        world.onLineClear(4);
        expect(world.director.summoned).not.toBeNull();
        const blows = world.blows.uBlows.array;
        expect(blows.some((v) => v.w > 10)).toBe(true);
        const br = world.director.summoned;
        world.update({ time: br.t0 + 2, delta: 0.016 }, camera);
        const { uB2, uB4 } = world.worm.uniforms;
        expect(uB2.array[SLOT_SUMMONED].y).toBeGreaterThan(0); // the body has a radius
        expect(uB4.array[SLOT_SUMMONED].x).toBe(1); // and is drawn
        world.dispose();
    });

    it('lets the sand outlive the worm, then leaves the erg as it found it', () => {
        const { world, camera } = makeWorld('Low');
        world.seek(10);
        world.update({ time: 10, delta: 0 }, camera);
        world.onLineClear(4);
        const br = world.director.summoned;
        const { uB2, uB4 } = world.worm.uniforms;
        const wells = world.terrain.uniforms.uWellH.array;
        const marks = (from, to) => wells.slice(from, to)
            .reduce((sum, v) => sum + Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) + Math.abs(v.w), 0);
        // Two seconds after the tail has gone under: no body, but grains in the air and a crater.
        world.update({ time: br.t0 + br.duration + 2, delta: 0.016 }, camera);
        expect(uB4.array[SLOT_SUMMONED].x).toBe(0);
        expect(uB2.array[SLOT_SUMMONED].y).toBeGreaterThan(0); // the sand still reads the path
        expect(world.wormSand.mesh.geometry.instanceCount).toBeGreaterThan(1);
        expect(world.terrain.uniforms.uWellH.array[SLOT_SUMMONED * 2 + 1].z).toBeGreaterThan(1);
        // After the settle: its marks are gone, and with no other worm about the pool is dormant.
        world.update({ time: br.t0 + br.duration + SETTLE + 0.1, delta: 0.016 }, camera);
        expect(uB2.array[SLOT_SUMMONED].y).toBe(0);
        expect(marks(SLOT_SUMMONED * 2, SLOT_SUMMONED * 2 + 2)).toBe(0);
        expect(world.terrain.uniforms.uSigns.array[SLOT_SUMMONED].w).toBe(0);
        if (!world.director.state.slots.some((slot) => slot.breach)) {
            expect(world.wormSand.mesh.geometry.instanceCount).toBe(1);
            expect(marks(0, wells.length)).toBe(0);
        }
        world.dispose();
    });

    it('tells the worm what the lens shows and what the boards cover', () => {
        const { world, camera } = makeWorld();
        world.setViewport(900, camera);
        expect(world.director.view.halfAz).toBeCloseTo(39.65, 1); // 50° vertical at 16:9
        expect(world.director.view.bands.length).toBe(0);
        world.setKeepOutRects([{
            x0: 0.4, y0: 0.1, x1: 0.6, y1: 0.9,
        }, null]);
        const [band] = world.director.view.bands;
        expect(band[0]).toBeCloseTo(-band[1], 6);
        expect(band[1]).toBeGreaterThan(8);
        expect(band[1]).toBeLessThan(11);
        world.setKeepOutRects([]);
        expect(world.director.view.bands.length).toBe(0);
        world.dispose();
    });

    it('deepens the dusk with the level and lowers both suns', () => {
        const { world, camera } = makeWorld();
        const elA = world.shared.uSunA.value.y;
        const zenith = world.shared.uZenith.value.clone();
        world.onLevelUp(15);
        world.update({ time: 1, delta: 30 }, camera); // long dt: the ease completes
        expect(world.dusk).toBeGreaterThan(0.95);
        expect(world.shared.uSunA.value.y).toBeLessThan(elA);
        expect(world.shared.uZenith.value.equals(zenith)).toBe(false);
        world.resetSession();
        world.update({ time: 2, delta: 30 }, camera);
        expect(world.dusk).toBeLessThan(0.05);
        world.dispose();
    });

    it('rolls beats closer than a tick out as one louder drum ring', () => {
        const { world } = makeWorld();
        world.seek(5);
        world.onPieceLock();
        const pulses = world.terrain.uniforms.uPulses.array;
        const alone = pulses.find((p) => p.z === 5).w;
        world.onPieceLock(); // same instant (two boards, a flurry): it joins the ring, never drops
        expect(pulses.filter((p) => p.z === 5).length).toBe(1);
        expect(pulses.find((p) => p.z === 5).w).toBeGreaterThan(alone);
        world.dispose();
    });

    it('gives a new ring the slot with the least light left, never a strong one', () => {
        const { world, camera } = makeWorld();
        world.seek(5);
        world.update({ time: 5, delta: 0 }, camera);
        world.onLineClear(3); // three geysers, each ringing the sand (strong rings)
        const pulses = world.terrain.uniforms.uPulses.array;
        expect(pulses.filter((p) => p.w > 1.5).length).toBe(3);
        [5.5, 5.65, 5.8].forEach((t) => {
            advance(world, camera, t);
            world.onPieceLock(); // the free slots
        });
        advance(world, camera, 6); // past the join window of the last beat
        const drum = pulses.slice(0, GROUND_PULSE_SLOTS);
        const left = drum.map((p) => p.w * Math.exp(-(world.time - p.z) * 1.15));
        const weakest = left.indexOf(Math.min(...left));
        const kept = drum.map((p) => p.clone());
        world.onPieceLock();
        expect(drum[weakest].z).toBe(world.time);
        drum.forEach((p, i) => {
            if (i !== weakest) expect(p.equals(kept[i]), `slot ${i}`).toBe(true);
        });
        world.dispose();
    });

    it("never yanks a rising geyser or the worm's herald to a new site", () => {
        const { world, camera } = makeWorld();
        world.seek(10);
        world.update({ time: 10, delta: 0 }, camera);
        world.onLineClear(4);
        const blows = world.blows.uBlows.array;
        const herald = world.director.summoned.t0 - 0.7;
        expect(blows.some((v) => v.w === herald)).toBe(true);
        advance(world, camera, 10.3);
        world.onLineClear(3);
        const key = (v) => `${v.x},${v.z},${v.w}`;
        const rising = blows.filter((v) => v.w > 10.2 && v.w !== herald).map(key);
        advance(world, camera, 10.9);
        world.onLineClear(2);
        advance(world, camera, 11.4);
        world.onLineClear(3); // nine columns asked of six slots inside two seconds
        expect(blows.length).toBe(BLOW_SLOTS);
        expect(blows.some((v) => v.w === herald)).toBe(true);
        const kept = rising.filter((k) => blows.some((v) => key(v) === k));
        expect(kept.length).toBeGreaterThanOrEqual(1); // the oldest columns gave way first
        world.dispose();
    });

    it('streams the sand on a phase that quickens with a gust and never jumps or runs back', () => {
        const { world, camera } = makeWorld();
        world.seek(300); // late in a session, where time x speed jumped hardest
        world.update({ time: 300, delta: 0 }, camera);
        const flow = world.shared.uFlow.value;
        const F = SAND_FLOW.sheets;
        const top = (1.4 * F.wind + 1.05 * F.gust + F.base) / 60;
        let last = flow.x;
        let lastDrift = flow.y;
        let slowest = Infinity;
        let fastest = 0;
        for (let i = 1; i <= 360; i++) {
            if (i === 60) world.onLineClear(3);
            if (i === 90) world.onLineClear(4);
            const t = 300 + i / 60;
            world.update({ time: t, delta: 1 / 60 }, camera);
            const step = flow.x - last;
            slowest = Math.min(slowest, step);
            fastest = Math.max(fastest, step);
            expect(flow.y).toBeGreaterThan(lastDrift);
            last = flow.x;
            lastDrift = flow.y;
        }
        expect(slowest).toBeGreaterThan(0);
        expect(fastest).toBeLessThan(top);
        // and the gusts did quicken it
        expect(fastest).toBeGreaterThan(slowest * 1.5);
        world.dispose();
    });
});

describe('shifting sands build-up', () => {
    it('never lets a weak event cut the light a strong one lit', () => {
        const { world, camera } = makeWorld();
        world.seek(20);
        world.update({ time: 20, delta: 0 }, camera);
        world.onPieceLock();
        world.onLineClear(4);
        advance(world, camera, 20.25);
        const before = reading(world);
        world.onPieceLock();
        world.onLineClear(1);
        world.update({ time: 20.25, delta: 0 }, camera);
        const after = reading(world);
        ['flare', 'flash', 'gust', 'gold'].forEach((k) => {
            expect(after[k], k).toBeGreaterThanOrEqual(before[k] - 1e-9);
        });
        world.dispose();
    });

    it('reads a long chain hotter than its first clear, and crowns it without replaying the quad', () => {
        const { world, camera } = makeWorld();
        world.seek(30);
        world.update({ time: 30, delta: 0 }, camera);
        world.onHardDrop();
        world.onPieceLock();
        world.onLineClear(1);
        advance(world, camera, 30.5);
        const first = reading(world);
        const summons = world.director.summonCount;
        const end = fever(world, camera, 31);
        // The fever has called the worm, or the quad has; the perfect clear calls no other.
        expect(world.director.summonCount).toBeGreaterThan(summons);
        const called = world.director.summonCount;
        advance(world, camera, end + 0.5);
        expect(world.director.summonCount).toBe(called);
        const peak = reading(world);
        expect(world.heat.stage).toBe(3);
        expect(peak.storm).toBeGreaterThan(first.storm + 0.5);
        expect(peak.windRise).toBeGreaterThan(first.windRise + 0.3);
        expect(peak.burn).toBeGreaterThan(first.burn + 0.4);
        expect(peak.gold).toBeGreaterThan(first.gold);
        expect(peak.bloom).toBeGreaterThan(first.bloom + 0.4);
        expect(world.exposure).toBeLessThan(1); // the iris closes a little as the heat adds light
        world.dispose();
    });

    it('breathes back to the still dusk once the hands rest', () => {
        const { world, camera } = makeWorld();
        world.seek(30);
        world.update({ time: 30, delta: 0 }, camera);
        const rest = reading(world);
        const end = fever(world, camera, 30.5);
        advance(world, camera, end + 20, 0.1);
        const after = reading(world);
        expect(after.storm).toBeLessThan(0.02);
        expect(after.windRise).toBeLessThan(0.02);
        expect(after.bloom).toBeLessThan(0.03);
        expect(after.flash).toBeLessThan(0.01);
        expect(after.gold).toBeLessThan(rest.gold + 0.03);
        expect(world.exposure).toBeGreaterThan(0.995);
        world.dispose();
    });
});
