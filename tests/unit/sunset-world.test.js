/**
 * Sunset — the world, built for real in Node (no renderer): what the board does to it, where
 * things land on screen, how the day moves, and the meshes it builds in code.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    SUNSET_PARTS, SunsetWorld, birdsForCombo, fireForCombo,
} from '../../src/themes/sunset/sunset-world.js';
import { QUALITY_NAMES } from '../../src/themes/sunset/sunset-quality.js';
import { fallbackLayout, frameFor } from '../../src/themes/sunset/sunset-composition.js';
import { LEVEL_SECONDS } from '../../src/themes/sunset/sunset-hours.js';
import { buildSeaFan } from '../../src/themes/sunset/sunset-sea.js';
import { buildLanternGeometry } from '../../src/themes/sunset/sunset-lanterns.js';
import { buildBirdGeometry } from '../../src/themes/sunset/sunset-birds.js';

const W = 1600;
const H = 852;

function makeWorld(options = {}) {
    const scene = new THREE.Scene();
    const world = new SunsetWorld({ scene, quality: 'Low', ...options }).build();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.25, 40000);
    world.bindCamera(camera);
    const layout = options.noBoard ? null : fallbackLayout(W, H);
    world.setLayout(layout, W / H);
    world.setViewport(W, H, W / H);
    world.seek(options.start ?? 10);
    let t = world.clock;
    const step = (seconds, dt = 1 / 30) => {
        const n = Math.round(seconds / dt);
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
        world, camera, scene, layout, step,
    };
}

const onScreen = (camera, p) => {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5, z: v.z };
};
const inside = (r, p) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

describe('sunset world: building', () => {
    it('builds every tier with every part, and draws only the parts asked for', () => {
        QUALITY_NAMES.forEach((quality) => {
            const { world, scene } = makeWorld({ quality });
            expect(Object.keys(world.parts).sort()).toEqual([...SUNSET_PARTS].sort());
            world.showOnlyParts(['sky', 'sea']);
            expect(world.parts.lanterns.mesh.visible).toBe(false);
            expect(world.parts.sky.mesh.visible).toBe(true);
            world.dispose();
            expect(scene.children).toHaveLength(0);
        });
    });

    it('builds its sea, lanterns and birds facing the way they are seen', () => {
        const fan = buildSeaFan(12, 9);
        const p = fan.positions;
        let up = 0;
        for (let i = 0; i < fan.indices.length; i += 3) {
            const corner = (k) => new THREE.Vector3(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
            const [a, b, c] = [fan.indices[i], fan.indices[i + 1], fan.indices[i + 2]].map(corner);
            up += new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).y;
        }
        expect(up).toBeGreaterThan(0);
        const lantern = buildLanternGeometry();
        expect(lantern.getAttribute('aPart')).toBeDefined();
        lantern.computeBoundingBox();
        expect(lantern.boundingBox.min.y).toBeGreaterThanOrEqual(-1e-6); // it floats on its foot
        const bird = buildBirdGeometry();
        expect(bird.getAttribute('aSpan').array.every((v) => v >= 0 && v <= 1)).toBe(true);
    });
});

describe('sunset world: the frame', () => {
    it('sets the sky left of the card and rises it right of the card and the stats', () => {
        const layout = fallbackLayout(W, H);
        const f = frameFor(W / H, layout);
        expect(f.setX).toBeLessThan(layout.cards[0].x0);
        expect(f.riseX).toBeGreaterThan(Math.max(layout.cards[0].x1, layout.hud.x1));
        expect(f.horizon).toBeGreaterThan(0.5);
        expect(f.setAz).toBeLessThan(0);
        expect(f.riseAz).toBeGreaterThan(0);
    });

    it('puts the horizon and the setting sun where the frame says, on screen', () => {
        const { world, camera } = makeWorld({ hour: 18 });
        const horizon = onScreen(camera, { x: 0, y: camera.position.y, z: -20000 });
        expect(horizon.y).toBeCloseTo(world.frame.horizon, 1);
        const sun = world.U.sun.value;
        const s = onScreen(camera, {
            x: camera.position.x + sun.x * 1000,
            y: camera.position.y + sun.y * 1000,
            z: camera.position.z + sun.z * 1000,
        });
        expect(s.x).toBeCloseTo(world.frame.setX, 1);
        expect(s.y).toBeLessThan(world.frame.horizon + 0.01);
    });

    it('keeps the sun and the moon clear of the card wherever they are in the picture', () => {
        const layout = fallbackLayout(W, H);
        const near = (r, p) => p.x >= r.x0 - 0.012 && p.x <= r.x1 + 0.012 && p.y >= r.y0 - 0.02 && p.y <= r.y1 + 0.02;
        const seen = { sun: 0, moon: 0 };
        const { world, camera } = makeWorld({ hour: 0 });
        for (let h = 0; h < 24; h += 0.25) {
            world.day.pin = h;
            world.applyHour();
            [['sun', world.U.sun.value, world.U.sunUp.value], ['moon', world.U.moon.value, world.U.moonUp.value]]
                .forEach(([name, dir, up]) => {
                    if (up < 0.5) return;
                    const p = onScreen(camera, {
                        x: camera.position.x + dir.x * 1000,
                        y: camera.position.y + dir.y * 1000,
                        z: camera.position.z + dir.z * 1000,
                    });
                    if (p.y < 0.03) return; // over the top of the picture
                    seen[name] += 1;
                    const clear = !near(layout.cards[0], p) && !near(layout.hud, p);
                    expect(clear, `${name} at ${h} h: ${p.x.toFixed(2)},${p.y.toFixed(2)}`).toBe(true);
                });
        }
        expect(seen.sun).toBeGreaterThan(10);
        expect(seen.moon).toBeGreaterThan(10);
    });
});

describe('sunset world: what the board does', () => {
    it('sets a lock\'s lantern on the sea beside the card, never behind it', () => {
        const {
            world, camera, layout, step,
        } = makeWorld();
        const card = layout.cards[0];
        for (let i = 0; i < 12; i += 1) {
            world.onLock({
                rows: [19 - (i % 12), 18 - (i % 12)], u: (i * 0.29) % 1, color: '#ff4d8f', hardDrop: i % 3 === 0,
            });
            step(0.25);
        }
        step(1);
        const st = {};
        let seen = 0;
        world.pool.records.forEach((r) => {
            world.pool.stateOf(r, world.clock, st);
            if (st.phase !== 'water') return;
            seen += 1;
            const p = onScreen(camera, { x: st.x, y: st.y + 0.3, z: st.z });
            expect(inside(card, p), `lantern at ${p.x.toFixed(2)},${p.y.toFixed(2)}`).toBe(false);
            expect(p.y).toBeGreaterThan(world.frame.horizon);
            expect(p.x).toBeGreaterThan(0);
            expect(p.x).toBeLessThan(1);
        });
        expect(seen).toBeGreaterThan(3);
        expect(world.getState().rings).toBeGreaterThan(0);
    });

    it('lands a piece low on the stack nearer the eye than one high up', () => {
        const { world, step } = makeWorld();
        const low = world.pool.send.bind(world.pool);
        const sent = [];
        world.pool.send = (...args) => {
            const r = low(...args);
            sent.push(Math.hypot(r.x0, r.z0));
            return r;
        };
        world.onLock({ rows: [19], u: 0.1, color: '#ffd700' });
        world.onLock({ rows: [3], u: 0.1, color: '#ffd700' });
        step(0.1);
        expect(sent[0]).toBeLessThan(sent[1]);
    });

    it('lifts a lantern for each line, all of them for four, and turns them for a T-spin', () => {
        const { world, step } = makeWorld();
        for (let i = 0; i < 8; i += 1) {
            world.onLock({ rows: [19 - i], u: (i * 0.37) % 1, color: '#ff8a65' });
            step(0.4);
        }
        step(1);
        const afloat = world.pool.floating(world.clock);
        world.onClear({ lines: 2, rows: [19, 18] });
        step(1.5);
        expect(world.pool.flying(world.clock)).toBe(2);
        world.onClear({ lines: 2, rows: [19, 18], tspin: true });
        step(1.5);
        expect(world.pool.records.some((r) => r.spiral !== 0)).toBe(true);
        world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        step(3);
        expect(world.pool.floating(world.clock)).toBe(0);
        expect(world.getState().lifted).toBe(afloat);
    });

    it('shows the green flash for four lines only while the sun is low', () => {
        const low = makeWorld({ hour: 18 });
        low.world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        low.step(0.8);
        expect(low.world.getState().green).toBeGreaterThan(0.5);
        low.step(4);
        expect(low.world.getState().green).toBe(0);
        const night = makeWorld({ hour: 23 });
        night.world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        night.step(0.8);
        expect(night.world.getState().green).toBe(0);
    });

    it('sets the sky on fire with a chain and calls the gulls from three clears', () => {
        expect(fireForCombo(1)).toBe(0);
        expect(fireForCombo(5)).toBeGreaterThan(fireForCombo(3));
        expect(birdsForCombo(2, 20)).toBe(0);
        expect(birdsForCombo(3, 20)).toBeGreaterThan(0);
        expect(birdsForCombo(9, 20)).toBe(20);
        const { world, step } = makeWorld({ hour: 17.5 });
        world.onCombo(2);
        step(2);
        expect(world.getState().birds).toBe(0);
        world.onCombo(4);
        step(2);
        expect(world.getState().fire).toBeGreaterThan(0.4);
        expect(world.getState().birds).toBeGreaterThan(0);
        world.onCombo(0);
        step(12);
        expect(world.getState().fire).toBeLessThan(0.1);
    });

    it('turns the day by the clock alone, and a level carries it further, eased', () => {
        const { world, step } = makeWorld({ start: 0 });
        const w0 = world.wheel();
        const sun0 = world.getState().sunHeight;
        step(60);
        expect(world.wheel() - w0).toBeCloseTo(60, 1);
        // A minute of the clock brings the sun from golden hour down toward the sea.
        expect(world.getState().sunHeight).toBeLessThan(sun0 - 10);
        world.levelUp(2);
        step(0.5);
        const mid = world.wheel() - world.clock;
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(LEVEL_SECONDS);
        step(10);
        expect(world.wheel() - world.clock).toBeCloseTo(LEVEL_SECONDS, 4);
        // Two levels at once: twice as far, never back.
        world.levelUp(4);
        step(12);
        expect(world.wheel() - world.clock).toBeCloseTo(LEVEL_SECONDS * 3, 4);
        world.levelUp(3);
        step(1);
        expect(world.wheel() - world.clock).toBeCloseTo(LEVEL_SECONDS * 3, 4);
    });

    it('runs the stars the same way as the sun and the moon: up on the right, down on the left', () => {
        const at = (hour) => makeWorld({ hour }).world.U.starTurn.value;
        // A star straight ahead, fixed to the sky: where does the eye see it a little later?
        const axis = [0, 0.5736, 0.8192];
        const seen = (turn) => {
            // The shader turns the view by +turn into the sky: a fixed star is seen turned by -turn.
            const q = [0, 0.3, -0.954];
            const c = Math.cos(-turn);
            const s = Math.sin(-turn);
            const k = axis;
            const dot = k[0] * q[0] + k[1] * q[1] + k[2] * q[2];
            const cross = [k[1] * q[2] - k[2] * q[1], k[2] * q[0] - k[0] * q[2], k[0] * q[1] - k[1] * q[0]];
            return q.map((v, i) => v * c + cross[i] * s + k[i] * dot * (1 - c));
        };
        const before = seen(at(22));
        const after = seen(at(22.5));
        expect(after[0] - before[0]).toBeLessThan(0);
        expect(at(0)).toBeCloseTo(0, 6);
    });

    it('starts a new run with nothing on the water, the clock still running and the day where it was', () => {
        const { world, step } = makeWorld();
        world.onLock({ rows: [19], u: 0.2, color: '#ffd700' });
        world.levelUp(4);
        step(15);
        const { clock } = world;
        const wheel = world.wheel();
        world.resetSession();
        expect(world.pool.floating(world.clock)).toBe(0);
        expect(world.getState().rings).toBe(0);
        expect(world.clock).toBe(clock);
        expect(world.wheel()).toBe(wheel);
        expect(world.getState().level).toBe(1);
        step(1);
        expect(world.wheel()).toBeCloseTo(wheel + 1, 4);
        // The next run's level 2 carries it on from there.
        world.levelUp(2);
        step(10);
        expect(world.wheel() - world.clock).toBeCloseTo(LEVEL_SECONDS * 4, 4);
        // A rebuild in place hands the day over whole.
        const next = makeWorld();
        next.world.seek(world.clock);
        next.world.restoreDay(world.dayTarget());
        expect(next.world.dayHour()).toBeCloseTo(world.dayHour(), 6);
    });
});

describe('sunset world: it builds with play, and never restarts', () => {
    const quad = { lines: 4, rows: [19, 18, 17, 16] };
    const single = { lines: 1, rows: [19] };
    const lights = (world) => {
        const g = world.getState();
        return {
            halo: g.halo, fire: g.fire, flash: world.getPostState().flash, glint: world.U.glint.value,
        };
    };

    it('lets a weak clear after a strong one only add light, and keeps a standing halo where it is', () => {
        const { world, step } = makeWorld({ hour: 17.5 });
        world.onClear(quad);
        step(1.4);
        const before = lights(world);
        expect(world.getState().haloReach).toBeCloseTo(22, 0);
        world.onClear(single);
        step(1 / 30);
        const after = lights(world);
        Object.keys(before).forEach((key) => {
            expect(after[key], key).toBeGreaterThanOrEqual(before[key] * 0.97);
        });
        // The halo still standing takes the single's light at its place: it does not shrink back
        // onto the disc and run out again (it used to blink and regrow with every clear).
        expect(world.getState().haloReach).toBeCloseTo(22, 0);
        step(0.5);
        expect(world.getState().haloReach).toBeCloseTo(22, 0);
        // A later single is a single again, not a quad (the old halo never decayed its strength).
        step(8);
        world.onClear(single);
        step(0.6);
        const lone = world.getState().halo;
        const fresh = makeWorld({ hour: 17.5 });
        fresh.world.onClear(single);
        fresh.step(0.6);
        expect(lone).toBeCloseTo(fresh.world.getState().halo, 2);
    });

    it('holds the green flash on through a second four-line clear instead of restarting it', () => {
        const { world, step } = makeWorld({ hour: 18 });
        world.onClear(quad);
        step(1.4);
        const lit = world.getState().green;
        expect(lit).toBeGreaterThan(0.9);
        world.onClear(quad);
        step(1 / 30);
        expect(world.getState().green).toBeGreaterThanOrEqual(lit * 0.99);
        // Held on past where the first alone would have let it go.
        step(1.4);
        expect(world.getState().green).toBeGreaterThan(0.9);
        step(4);
        expect(world.getState().green).toBe(0);
    });

    it('builds a long chain toward a fever the first clear never reaches, then breathes back', () => {
        const { world, step } = makeWorld({ hour: 17.5, quality: 'High' });
        for (let i = 0; i < 6; i += 1) world.onLock({ rows: [19], u: 0.3, color: '#ffd700' });
        step(1);
        let combo = 0;
        const clear = (c) => {
            combo += 1;
            world.onLock({
                rows: [19], u: 0.6, color: '#ff8a65', hardDrop: true,
            });
            world.onClear({ rows: [19], combo, ...c });
            world.onCombo(combo);
        };
        clear({ lines: 1 });
        step(0.6);
        const first = world.getState();
        const plan = [1, 2, 1, 2, 2, 3, 2, 2, 3, 2];
        plan.forEach((lines) => {
            clear({ lines });
            step(0.64);
        });
        // A cascade's waves each build on the last.
        for (let wave = 2; wave <= 4; wave += 1) {
            world.onClear({
                rows: [19], lines: 1, combo, cascade: wave,
            });
            step(0.36);
        }
        clear(quad);
        step(0.36);
        const peak = world.getState();
        expect(peak.heat.stage).toBe(3);
        expect(peak.ember).toBeGreaterThan(first.ember + 0.6);
        expect(peak.fire).toBeGreaterThan(Math.max(1, first.fire));
        expect(peak.halo).toBeGreaterThan(first.halo);
        expect(peak.greatHalo).toBeGreaterThan(0.3);
        expect(peak.birds).toBeGreaterThan(first.birds);
        // The iris closes a little as the sky burns, so its colours stay deep.
        expect(world.getPostState().exposure).toBeLessThan(world.light.exposure * 0.92);
        // The perfect clear settles after the quad: the crown on it, not a second quad.
        const crown = world.getState().lifted;
        world.onCrown();
        step(1);
        expect(world.getState().greatHalo).toBeGreaterThan(peak.greatHalo);
        expect(world.getState().sunDogs).toBeGreaterThan(peak.sunDogs);
        expect(world.getState().lifted).toBeGreaterThanOrEqual(crown);
        // The hands rest: the world breathes back to the evening it was.
        world.onCombo(0);
        step(16);
        const rest = world.getState();
        expect(rest.heat.level).toBeLessThan(0.05);
        expect(rest.ember).toBeLessThan(0.01);
        expect(rest.halo).toBeLessThan(0.05);
        expect(rest.greatHalo).toBeLessThan(0.1);
        expect(rest.fire).toBeLessThan(0.15);
    });

    it('lifts more lanterns with every wave of a cascade, and shows sun dogs for a back-to-back', () => {
        const { world, step } = makeWorld({ hour: 17.5, quality: 'High' });
        for (let i = 0; i < 12; i += 1) world.onLock({ rows: [19], u: 0.3, color: '#ffd700' });
        step(1);
        const lifted = () => world.getState().lifted;
        let was = lifted();
        world.onClear({ rows: [19], lines: 1, cascade: 1 });
        const wave1 = lifted() - was;
        step(0.36);
        was = lifted();
        world.onClear({ rows: [19], lines: 1, cascade: 3 });
        expect(lifted() - was).toBeGreaterThan(wave1);
        step(2);
        expect(world.getState().sunDogs).toBe(0);
        world.onClear({ ...quad, b2b: true });
        step(0.8);
        expect(world.getState().sunDogs).toBeGreaterThan(0.5);
        // A T-spin that clears nothing still sends a lantern up, turning.
        for (let i = 0; i < 3; i += 1) world.onLock({ rows: [19], u: 0.7, color: '#ba68c8' });
        step(1);
        was = lifted();
        world.onSpin();
        expect(lifted() - was).toBe(1);
        expect(world.pool.records.some((r) => r.spiral !== 0)).toBe(true);
    });

    it('lets a chain grow the flock in the air, and never restarts one still crossing', () => {
        const { world, step } = makeWorld({ hour: 17.5, quality: 'High' });
        const birds = world.parts.birds.mesh.geometry.getAttribute('aBird');
        world.onCombo(3);
        step(2);
        const small = world.getState().birds;
        expect(small).toBeGreaterThan(0);
        // Three to five within a few seconds: the great flock (a cooldown used to refuse it).
        world.onCombo(4);
        world.onCombo(5);
        step(0.5);
        expect(world.getState().birds).toBeGreaterThan(small);
        // Long after, a new step of the chain: a second flight sets out beside the first, which
        // flies on where it was.
        step(11);
        const lead = new THREE.Vector3(birds.getX(0), birds.getY(0), birds.getZ(0));
        const flying = world.getState().birds;
        world.onCombo(6);
        step(1 / 30);
        const now = new THREE.Vector3(birds.getX(0), birds.getY(0), birds.getZ(0));
        expect(now.distanceTo(lead)).toBeLessThan(1);
        expect(world.getState().birds).toBeGreaterThan(flying);
    });
});
