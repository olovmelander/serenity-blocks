/**
 * Chromadelic Highway — the planets' share of play (src/themes/chromadelic-highway/
 * chromadelic-highway-planet-events.js): the board's light fronts, the hero's lightning and the
 * ice giant's ring in a fever. They accumulate like the rest of the theme (a newcomer never cuts a
 * stronger front), replay from a seek, soften under Reduce flashing, and a lightning cell lands on
 * the night side the camera sees.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FRONT_DEFAULTS, LIGHTNING_SLOTS, PLANET_FRONT_SLOTS, PlanetEvents, seededRandom,
} from '../../src/themes/chromadelic-highway/chromadelic-highway-planet-events.js';
import { ChromadelicWorld, KEY_LIGHT } from '../../src/themes/chromadelic-highway/chromadelic-highway-world.js';

const RED = { r: 1, g: 0.1, b: 0.2 };
const BLUE = { r: 0.1, g: 0.3, b: 1 };

/** Uniform stand-ins for one body's front slots. */
const slots = () => Array.from(
    { length: PLANET_FRONT_SLOTS },
    () => ({ a: new THREE.Vector4(), c: new THREE.Vector4() }),
);

describe('planet light fronts', () => {
    it('folds one clear\'s beats into one front, and a later clear takes a free slot', () => {
        const fx = new PlanetEvents();
        const first = fx.front({ rgb: RED, amp: 1 }, 10);
        const again = fx.front({ rgb: RED, amp: 0.5 }, 10.05);
        expect(again).toBe(first);
        expect(first.amp).toBeGreaterThan(1);
        const later = fx.front({ rgb: BLUE, amp: 1 }, 10.4);
        expect(later).not.toBe(first);
        expect(fx.fronts.filter(Boolean)).toHaveLength(2);
    });

    it('never cuts a strong front for a weaker newcomer: it folds in instead', () => {
        const fx = new PlanetEvents();
        for (let i = 0; i < PLANET_FRONT_SLOTS; i++) fx.front({ rgb: RED, amp: 2 }, 10 + 0.2 * i);
        const live = fx.fronts.slice();
        const youngest = live[PLANET_FRONT_SLOTS - 1];
        const before = youngest.amp;
        fx.front({ rgb: BLUE, amp: 0.4 }, 10.7);
        expect(fx.fronts).toEqual(live); // every front still in flight
        expect(youngest.amp).toBeGreaterThan(before);
        // A spent front's slot is free again.
        const fresh = fx.front({ rgb: BLUE, amp: 1 }, 30);
        expect(fx.fronts).toContain(fresh);
        expect(fresh.birth).toBe(30);
    });

    it('runs each front across a body from the key\'s side, reaching the farther body later', () => {
        const fx = new PlanetEvents();
        fx.front({ rgb: RED, amp: 1 }, 0);
        const near = slots();
        const far = slots();
        fx.writeFronts(0.1, 0.16, 1, near);
        expect(near[0].a.z).toBe(0); // the light has not reached the hero yet
        let lastS = Infinity;
        for (let t = 0.2; t < 1.2; t += 0.1) {
            fx.writeFronts(t, 0.16, 1, near);
            fx.writeFronts(t, 0.28, 1, far);
            expect(near[0].a.x).toBeLessThan(lastS); // it only ever moves on, away from the key
            lastS = near[0].a.x;
            expect(far[0].a.x).toBeGreaterThan(near[0].a.x); // the farther body sees it later
            expect(near[0].a.z).toBeGreaterThan(0);
            expect(near[0].c.x).toBeCloseTo(RED.r);
        }
        // It starts just off the globe on the key's side and crosses the face (cosine 1 → 0).
        fx.writeFronts(0.16 + 0.001, 0.16, 1, near);
        expect(near[0].a.x).toBeCloseTo(1 + 1.5 * FRONT_DEFAULTS.width, 2);
        fx.writeFronts(0.16 + (1 + 1.5 * FRONT_DEFAULTS.width) / FRONT_DEFAULTS.sweep, 0.16, 1, near);
        expect(near[0].a.x).toBeCloseTo(0, 2);
    });

    it('crosses a ring at full light and twice as fast, so the globe catches it a beat after', () => {
        const fx = new PlanetEvents();
        const f = fx.front({ rgb: RED, amp: 1 }, 0);
        const ringed = slots();
        const tRing = (2.2 - 1) / (2 * f.sweep);
        fx.writeFronts(tRing * 0.5, 0, 2.2, ringed);
        expect(ringed[0].a.z).toBeCloseTo(1, 5); // no fading over the ring
        fx.writeFronts(tRing, 0, 2.2, ringed);
        expect(ringed[0].a.x).toBeCloseTo(1 + 1.5 * f.width, 5); // at the globe's edge
        fx.writeFronts(tRing + 0.5, 0, 2.2, ringed);
        expect(ringed[0].a.z).toBeLessThan(1);
    });

    it('a prism front carries the spectrum flag; an idle slot carries no light', () => {
        const fx = new PlanetEvents();
        fx.front({ rgb: RED, prism: 1, amp: 2 }, 0);
        const out = slots();
        fx.writeFronts(0.5, 0, 1, out);
        expect(out[0].a.w).toBe(1);
        expect(out[1].a.z).toBe(0);
        expect(out[1].c.w).toBe(0);
    });

    it('rises slowly and burns at 60 % under Reduce flashing', () => {
        const fx = new PlanetEvents();
        fx.calm = true;
        const f = fx.front({ rgb: RED, amp: 1, rise: 0.05 }, 0);
        expect(f.amp).toBeCloseTo(0.6);
        expect(f.rise).toBeGreaterThanOrEqual(0.25);
    });
});

describe('the hero\'s lightning', () => {
    it('fills free cells, then gives up the one closest to done', () => {
        const fx = new PlanetEvents();
        for (let i = 0; i < LIGHTNING_SLOTS; i++) fx.strike(10 + 0.1 * i);
        const oldest = fx.cells[0];
        const next = fx.strike(10.5);
        expect(fx.cells).not.toContain(oldest);
        expect(fx.cells).toContain(next);
        // After a cell has burnt out its slot is reused before any live one.
        const live = fx.cells.filter((c) => c !== next);
        fx.cells[1].birth = 0;
        const reused = fx.strike(10.6);
        expect(fx.cells.indexOf(reused)).toBe(1);
        expect(live.filter((c) => fx.cells.includes(c)).length).toBe(LIGHTNING_SLOTS - 2);
    });

    it('flickers in strokes, and under Reduce flashing is one soft glow', () => {
        const fx = new PlanetEvents();
        const cell = fx.strike(0, { amp: 1 });
        const sample = (flicker) => Array.from({ length: 1200 }, (_, i) => fx.cellLight(cell, i / 1000, flicker));
        const hard = sample(1);
        const soft = sample(0);
        expect(Math.max(...hard)).toBeGreaterThan(1);
        expect(Math.max(...soft)).toBeLessThan(0.5);
        // No strobe when calm: the glow never jumps between milliseconds, and it rises once, then falls.
        const steps = soft.slice(1).map((v, i) => Math.abs(v - soft[i]));
        expect(Math.max(...steps)).toBeLessThan(0.01);
        const peak = soft.indexOf(Math.max(...soft));
        expect(soft.slice(peak).every((v, i, a) => i === 0 || v <= a[i - 1] + 1e-12)).toBe(true);
        expect(fx.cellLight(cell, 2)).toBe(0);
    });

    it('rumbles at its rate between clears, and replays the same cells after a reset', () => {
        const run = () => {
            const fx = new PlanetEvents();
            let fired = 0;
            for (let i = 0; i < 120; i++) fired += fx.rumble(3, 1 / 60, i / 60);
            const sites = fx.resolveCells(2, 1, (rand) => ({ x: rand(), y: rand(), z: rand() }));
            return { fired, sites: sites.map((s) => s && s.dir) };
        };
        const a = run();
        expect(a.fired).toBeGreaterThanOrEqual(5);
        expect(a.fired).toBeLessThanOrEqual(6);
        expect(run()).toEqual(a);
    });

    it('has a deterministic random sequence per seed', () => {
        const a = seededRandom(7);
        const b = seededRandom(7);
        const c = seededRandom(8);
        const xs = [a(), a(), a()];
        expect([b(), b(), b()]).toEqual(xs);
        expect(c()).not.toBe(xs[0]);
        xs.forEach((x) => {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(1);
        });
    });
});

describe('the world sends play to the planets', () => {
    afterEach(() => vi.unstubAllGlobals());

    /** An unbuilt world with stand-ins for the parts update() touches (as the world tests do). */
    const liveWorld = (quality = 'High') => {
        const world = new ChromadelicWorld({ scene: null, quality, random: () => 0.5 });
        world.spawnComet = vi.fn();
        world.spawnMeteor = vi.fn();
        world.sky = {
            uniforms: { uTime: { value: 0 }, uNebBreath: { value: 0 } },
            setHueShift: vi.fn(),
            setAir: vi.fn(),
            setDirections: vi.fn(),
        };
        world.stars = {
            uniforms: { uTime: { value: 0 }, uBinaryFlare: { value: 0 }, uBinaryDir: { value: { copy() {} } } },
            triggerWave: vi.fn(),
        };
        world.meteors = { update: () => 0, clear: vi.fn() };
        world.updateBodies = () => {};
        return world;
    };
    const step = (world, seconds, dt = 1 / 60) => {
        const steps = Math.round(seconds / dt);
        for (let i = 0; i < steps; i++) {
            world.update({
                time: world.time + dt, delta: dt, pace: 1, pulse: 0, ring: 0, particle: 0, ambient: 0,
            }, null);
        }
    };
    const fronts = (world) => world.planetFx.fronts.filter(Boolean);
    const cellsAlive = (world) => world.planetFx.cells.filter((c) => c && world.time - c.birth < 1.4).length;

    it('a clear sends a front in its bands\' colour and fires a cell for every line', () => {
        const world = liveWorld();
        world.seek(20);
        world.onLineClear(3);
        step(world, 0.6);
        expect(fronts(world)).toHaveLength(1);
        expect(fronts(world)[0].prism).toBe(0);
        expect(cellsAlive(world)).toBeGreaterThanOrEqual(3);
    });

    it('a quad sends a prism front, rings the giant\'s ring out in the spectrum and breaks the storm', () => {
        const world = liveWorld();
        world.seek(20);
        world.onLineClear(4);
        step(world, 0.7);
        expect(fronts(world).some((f) => f.prism === 1)).toBe(true);
        expect(world.fx.ringPrism).toBeGreaterThan(0.5);
        expect(cellsAlive(world)).toBeGreaterThanOrEqual(3);
        step(world, 5);
        expect(world.fx.ringPrism).toBeLessThan(0.05);
    });

    it('back-to-back answers in gold with the gold front; a level-up dawns slow and wide', () => {
        const world = liveWorld();
        world.seek(20);
        world.onB2B();
        step(world, 0.3);
        expect(fronts(world)).toHaveLength(0); // the gold comes with the gold cascade, 0.42 s on
        step(world, 0.2);
        const gold = fronts(world)[0];
        expect(gold.rgb.r).toBeGreaterThan(gold.rgb.b);
        const level = liveWorld();
        level.seek(20);
        level.onLevelUp(2);
        const dawn = fronts(level)[0];
        expect(dawn.width).toBeGreaterThan(FRONT_DEFAULTS.width);
        expect(dawn.sweep).toBeLessThan(FRONT_DEFAULTS.sweep);
    });

    it('a fever keeps the storm flickering and the ring in the spectrum; the hands rest, it calms', () => {
        const world = liveWorld();
        world.seek(20);
        const sample = world.surge.sample.bind(world.surge);
        world.surge.sample = () => ({
            punch: 0, level: 1, fever: 1, stage: 3,
        });
        const before = world.planetFx.cellSeq;
        step(world, 3);
        expect(world.planetFx.cellSeq - before).toBeGreaterThanOrEqual(8); // ~3 a second
        expect(world.fx.ringPrism).toBe(1);
        world.surge.sample = sample;
        world.surge.reset();
        const calm = world.planetFx.cellSeq;
        step(world, 5);
        expect(world.planetFx.cellSeq - calm).toBeLessThanOrEqual(1);
        expect(world.fx.ringPrism).toBeLessThan(0.05);
    });

    it('runs the ring\'s spectrum on an integrated phase: a fever never jumps it', () => {
        const world = liveWorld();
        world.seek(20);
        let last = world.ringFlow;
        world.surge.sample = () => ({
            punch: 0, level: 1, fever: 1, stage: 3,
        });
        for (let i = 0; i < 120; i++) {
            step(world, 1 / 60);
            const d = (world.ringFlow - last + 1) % 1;
            expect(d).toBeLessThan(0.4 / 60 + 1e-9);
            last = world.ringFlow;
        }
    });

    it('a seek forgets the fronts, the lightning and the ring\'s phase', () => {
        const world = liveWorld();
        world.seek(20);
        world.onLineClear(4);
        step(world, 0.8);
        world.seek(5);
        expect(fronts(world)).toHaveLength(0);
        expect(world.planetFx.cells.every((c) => c === null)).toBe(true);
        expect(world.ringFlow).toBe(0);
    });

    it('softens the planets under Reduce flashing', () => {
        vi.stubGlobal('window', { settings: { reduceFlashing: true } });
        const world = liveWorld();
        world.seek(20);
        step(world, 1 / 60);
        expect(world.planetFx.calm).toBe(true);
        world.onLineClear(2);
        expect(fronts(world)[0].rise).toBeGreaterThanOrEqual(0.25);
    });

    it('Minimal (no lightning on its hero) never rumbles', () => {
        const world = liveWorld('Minimal');
        world.seek(20);
        world.surge.sample = () => ({
            punch: 0, level: 1, fever: 1, stage: 3,
        });
        step(world, 2);
        expect(world.planetFx.cellSeq).toBe(0);
    });
});

describe('the built planets catch it', () => {
    /**
     * A world with real planet impostors (blank textures), stand-ins for the other parts update()
     * touches, and the rest pose's camera.
     */
    const bodies = () => {
        const world = new ChromadelicWorld({ scene: new THREE.Scene(), quality: 'High', random: () => 0.5 });
        world.loadTexture = () => new THREE.Texture();
        world.sky = {
            uniforms: { uTime: { value: 0 }, uNebBreath: { value: 0 } },
            setHueShift: vi.fn(),
            setAir: vi.fn(),
            setDirections: vi.fn(),
        };
        world.stars = {
            uniforms: { uTime: { value: 0 }, uBinaryFlare: { value: 0 }, uBinaryDir: { value: { copy() {} } } },
            triggerWave: vi.fn(),
            setProjection: vi.fn(),
        };
        world.meteors = { update: () => 0, clear: vi.fn() };
        world.spawnComet = vi.fn();
        world.spawnMeteor = vi.fn();
        world.buildPlanets();
        world.setLayout(16 / 9, null, { width: 1920, height: 1080 });
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 12000);
        world.seek(20);
        world.updateCamera(camera, { time: 20, delta: 0 });
        world.setViewport(1080, camera, 1920, 1080);
        world.update({ time: 20, delta: 0, pace: 1 }, camera);
        return { world, camera };
    };
    /** Step the live world (scheduled strikes fire in update()) up to time `t`. */
    const at = (world, camera, t) => {
        const dt = t - world.time;
        world.updateCamera(camera, { time: t, delta: dt });
        world.update({ time: t, delta: dt, pace: 1 }, camera);
    };

    it('the hero catches the front before the farther ice giant', () => {
        const { world, camera } = bodies();
        const heroDistance = world.hero.mesh.position.distanceTo(KEY_LIGHT);
        const giantDistance = world.secondary.mesh.position.distanceTo(KEY_LIGHT);
        expect(giantDistance).toBeGreaterThan(heroDistance * 1.3);
        world.onLineClear(2);
        let heroAt = null;
        let giantAt = null;
        for (let t = 20 + 1 / 120; t < 21.5; t += 1 / 120) {
            at(world, camera, t);
            if (heroAt === null && world.hero.frontValues[0].a.z > 0) heroAt = t;
            if (giantAt === null && world.secondary.frontValues[0].a.z > 0) giantAt = t;
        }
        expect(heroAt).not.toBeNull();
        expect(giantAt).toBeGreaterThan(heroAt + 0.05);
    });

    it('lands every lightning cell on the night side the camera sees, turning with the bands', () => {
        const { world, camera } = bodies();
        world.onLineClear(3);
        for (let t = 20; t <= 20.5; t += 1 / 60) at(world, camera, t);
        const { hero } = world;
        const L1 = hero.uniforms.uL1.value;
        const toEye = new THREE.Vector3().subVectors(camera.position, hero.mesh.position).normalize();
        const cells = world.planetFx.cells.filter((c) => c && c.dir);
        expect(cells.length).toBeGreaterThanOrEqual(3);
        // Back to world space with this frame's spin: the inverse of the body's world→local turn.
        for (const c of cells) {
            const site = hero.siteToWorld(c.dir);
            expect(site.dot(L1)).toBeLessThan(-0.05); // night side
            expect(site.dot(toEye)).toBeGreaterThan(0.4); // on the face the camera sees
        }
        expect(hero.uniforms.uCellLight.value.x + hero.uniforms.uCellLight.value.y
            + hero.uniforms.uCellLight.value.z + hero.uniforms.uCellLight.value.w).toBeGreaterThan(0);
    });
});
