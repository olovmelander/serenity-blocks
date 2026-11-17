/**
 * Stellar Drift — the living pass (2026-11-17): what the picture does by itself over time, and the
 * shapes the big moments take. A real StellarDriftWorld on the CPU, no renderer.
 *
 * Pinned as relations, never tuning numbers: a moon's map is deterministic and has its parts; the
 * inner moon keeps its orbit, crosses the giant's face and its shadow falls on it; a perfect
 * clear's eclipse hides the sun and brings it out again as a diamond ring, then gives the hour back;
 * game over's nightfall falls, survives the menu and lifts by itself or on a new run; a chain's
 * crown lights the haze for a while; comets come by themselves and for a new level; great white
 * storms rise by the clock in the north.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, StellarDriftWorld, fovForAspect,
} from '../../src/themes/stellar-drift/stellar-drift-world.js';
import {
    COMET_CROSS, COMET_FIRST, COMET_PATHS, COMET_PERIOD, ECLIPSE, ECLIPSE_LIFE, HALO_LIFE, INNER_MOON,
    NIGHTFALL_HOLD, OUTBREAK, RINGS, eclipseAt, innerMoonAt, outbreakAt, palettePlace, sunDirection,
} from '../../src/themes/stellar-drift/stellar-drift-core.js';
import { MOON_SIZES, bakeMoon, moonSeed } from '../../src/themes/stellar-drift/stellar-drift-moon-bake.js';
import { WORLD_SEED } from '../../src/themes/stellar-drift/stellar-drift-bake.js';
import { fallbackLayout } from '../../src/themes/stellar-drift/stellar-drift-composition.js';

function makeWorld(at = 10, quality = 'Minimal') {
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

function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 30))) {
    for (let i = 0; i < steps; i++) frame(world, camera, seconds / steps);
}

const clear = (world, over = {}) => world.onClear({
    player: 0, rows: [19], lines: 1, combo: 1, cascade: 1, twist: false, perfect: false, b2b: false, screen: null, ...over,
});

const sunOf = (world) => world.u.sunDir.value.clone();
const hourSun = (world) => {
    const s = sunDirection(palettePlace(world.levelPlace, world.time));
    return new THREE.Vector3(s[0], s[1], s[2]);
};

describe('the moons wear baked maps', () => {
    it.each(['ice', 'rust'])('bakes the %s moon deterministically, with a full mip chain', (kind) => {
        const width = kind === 'ice' ? 512 : MOON_SIZES.rust;
        const a = bakeMoon(kind, width, 101);
        const b = bakeMoon(kind, width, 101);
        expect(b).toBe(a); // the bake cache hands the same result back
        expect(a.width).toBe(width);
        expect(a.height).toBe(width / 2);
        const last = a.levels[a.levels.length - 1];
        expect([last.width, last.height]).toEqual([1, 1]);
        const top = a.levels[0].data;
        expect(top.length).toBe(width * (width / 2) * 4);
        // Light and dark ground, some of the special material, and relief both ways round level.
        let lo = 255;
        let hi = 0;
        let special = 0;
        let slopes = 0;
        for (let i = 0; i < top.length; i += 4) {
            lo = Math.min(lo, top[i]);
            hi = Math.max(hi, top[i]);
            if (top[i + 1] > 60) special += 1;
            if (Math.abs(top[i + 2] - 128) > 6 || Math.abs(top[i + 3] - 128) > 6) slopes += 1;
        }
        expect(hi - lo).toBeGreaterThan(80);
        expect(special / (top.length / 4)).toBeGreaterThan(0.01);
        expect(slopes / (top.length / 4)).toBeGreaterThan(0.01);
        const other = bakeMoon(kind, width, 202);
        expect(Buffer.from(other.levels[0].data).equals(Buffer.from(top))).toBe(false);
    });

    it('bakes both from the world\'s own seed, the icy one at the tier\'s size', () => {
        const { world } = makeWorld();
        expect(world.u.moonIceTex.image.width).toBe(world.tier.moonSize);
        expect(world.u.moonRustTex.image.width).toBe(MOON_SIZES.rust);
        expect(bakeMoon('rust', MOON_SIZES.rust, moonSeed(WORLD_SEED)).levels[0].data)
            .toBe(world.u.moonRustTex.image.data);
        world.dispose();
    });
});

describe('the inner moon', () => {
    it('keeps its orbit outside the rings and comes round once a period', () => {
        for (let t = 0; t < INNER_MOON.period; t += 7) {
            const p = innerMoonAt(t);
            expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(INNER_MOON.orbit, 6);
            expect(innerMoonAt(t + INNER_MOON.period).map((v) => +v.toFixed(9))).toEqual(p.map((v) => +v.toFixed(9)));
        }
        expect(INNER_MOON.orbit - INNER_MOON.radius).toBeGreaterThan(RINGS.to);
    });

    it('crosses the giant\'s face, its shadow falls on the giant, and it passes through the giant\'s shadow', () => {
        const { world, camera } = makeWorld(0);
        const cam = world.restCamera().position.clone();
        const radius = Math.asin(1 / cam.length());
        let transit = 0;
        let shadow = 0;
        let dark = 0;
        for (let t = 0; t < INNER_MOON.period; t += 1) {
            frame(world, camera, 1);
            const p = new THREE.Vector3(...innerMoonAt(world.time));
            const toMoon = p.clone().sub(cam);
            const toGiant = cam.clone().negate();
            const off = toMoon.angleTo(toGiant);
            if (off < radius * 0.9 && toMoon.length() < toGiant.length()) transit += 1;
            // The moon's shadow on the giant: the sun's ray through it meets the face the camera sees.
            const s = world.u.sunDir.value;
            const b = -p.dot(s);
            const disc = b * b - (p.lengthSq() - 1);
            if (b < 0 && disc > 0) {
                const hit = p.clone().addScaledVector(s, b + Math.sqrt(disc)).normalize();
                if (hit.dot(cam.clone().normalize()) > 0.3 && hit.dot(s) > 0.1) shadow += 1;
            }
            if (world.u.innerMoonLit.value < 0.5) dark += 1;
        }
        expect(transit).toBeGreaterThan(4);
        expect(shadow).toBeGreaterThan(4);
        expect(dark).toBeGreaterThan(2);
        world.dispose();
    });
});

describe('a perfect clear is an eclipse', () => {
    it('lays the sun\'s path behind the giant and out past its limb', () => {
        expect(eclipseAt(-0.1).w).toBe(0);
        expect(eclipseAt(ECLIPSE.dusk * 0.5).w).toBeGreaterThan(0);
        expect(eclipseAt(ECLIPSE.dusk * 0.5).w).toBeLessThan(1);
        for (let k = 0.05; k < 1; k += 0.1) {
            const e = eclipseAt(ECLIPSE.dusk + ECLIPSE.total * k);
            expect(e.w).toBe(1);
            expect(e.rho).toBeLessThan(1);
        }
        expect(eclipseAt(ECLIPSE.dusk + ECLIPSE.total + ECLIPSE.ring * 0.99).rho).toBeGreaterThan(1);
        expect(eclipseAt(ECLIPSE_LIFE).w).toBe(0);
    });

    it('hides the sun behind the giant, brings it out as a diamond ring, then gives the hour back', () => {
        const { world, camera } = makeWorld(20);
        frame(world, camera, 1 / 30, () => clear(world, { lines: 4, rows: [19, 18, 17, 16], perfect: true }));
        const born = world.eclipseBirth;
        expect(born).toBeGreaterThan(19);
        run(world, camera, born + ECLIPSE.dusk + ECLIPSE.total * 0.5 - world.time);
        // Totality: the sun is behind the disc (none of it shows), the giant's face is night.
        expect(world.u.sunShow.value.x).toBeLessThan(0.05);
        expect(world.u.sunShow.value.z).toBe(1);
        expect(sunOf(world).angleTo(hourSun(world))).toBeGreaterThan(0.5);
        run(world, camera, born + ECLIPSE.dusk + ECLIPSE.total + ECLIPSE.ring - world.time);
        // The diamond ring: it stands just past the limb, drawn.
        expect(world.u.sunShow.value.x).toBeGreaterThan(0.5);
        expect(world.u.sunShow.value.y).toBeGreaterThan(0.5);
        run(world, camera, born + ECLIPSE_LIFE + 0.5 - world.time);
        expect(world.u.sunShow.value.y).toBe(0);
        expect(sunOf(world).angleTo(hourSun(world))).toBeLessThan(1e-6);
        world.dispose();
    });

    it('is not staged under reduced motion (the gold is)', () => {
        const { world, camera } = makeWorld(20);
        world.setReducedMotion(true);
        frame(world, camera, 1 / 30, () => clear(world, { lines: 4, rows: [19, 18, 17, 16], perfect: true }));
        run(world, camera, ECLIPSE.dusk + 1);
        expect(world.u.sunShow.value.z).toBe(0);
        expect(sunOf(world).angleTo(hourSun(world))).toBeLessThan(1e-6);
        world.dispose();
    });
});

describe('game over is nightfall', () => {
    it('falls, holds through the menu, and lifts by itself', () => {
        const { world, camera } = makeWorld(20);
        world.onGameOver();
        run(world, camera, 4);
        const gain = world.u.sunGain.value;
        expect(gain).toBeLessThan(0.8);
        expect(sunOf(world).angleTo(hourSun(world))).toBeGreaterThan(0.3);
        // The menu after the run resets the session: the night stays.
        world.resetSession();
        run(world, camera, 1);
        expect(world.u.sunGain.value).toBeLessThan(0.8);
        run(world, camera, NIGHTFALL_HOLD + 8);
        expect(world.u.sunGain.value).toBeGreaterThan(0.99);
        expect(sunOf(world).angleTo(hourSun(world))).toBeLessThan(0.02);
        world.dispose();
    });

    it('lifts within seconds when the next run starts', () => {
        const { world, camera } = makeWorld(20);
        world.onGameOver();
        run(world, camera, 4);
        world.onSessionStart();
        run(world, camera, 5);
        expect(world.u.sunGain.value).toBeGreaterThan(0.97);
        world.dispose();
    });
});

describe('a chain\'s crown lights the haze', () => {
    it('lights for a while, a second crown feeds it, and it goes out', () => {
        const { world, camera } = makeWorld(20);
        frame(world, camera, 1 / 30, () => {
            clear(world, { combo: 3 });
            clear(world, { combo: 5 });
            clear(world, { combo: 8 });
        });
        run(world, camera, 0.5);
        expect(world.u.halo.value.y).toBeGreaterThan(0);
        const { power } = world.halo;
        world.haloAt(world.time, 1, [1, 0.5, 0.2]);
        expect(world.halo.power).toBeGreaterThan(power);
        run(world, camera, HALO_LIFE + 0.5);
        expect(world.u.halo.value.y).toBe(0);
        world.dispose();
    });
});

describe('comets cross the far sky', () => {
    it('come by themselves, by the clock', () => {
        const { world, camera } = makeWorld(COMET_FIRST - 3);
        expect(world.u.cometB.value.x).toBe(0);
        run(world, camera, 3 + COMET_CROSS * 0.5);
        expect(world.u.cometB.value.x).toBeGreaterThan(0);
        run(world, camera, COMET_CROSS);
        expect(world.u.cometB.value.x).toBe(0);
        expect(COMET_PERIOD).toBeGreaterThan(COMET_CROSS * 4);
        world.dispose();
    });

    it('come for a new level; a second level brightens the one crossing', () => {
        const { world, camera } = makeWorld(20);
        frame(world, camera, 1 / 30, () => world.levelUp(2));
        run(world, camera, 3);
        const { birth } = world.comet;
        expect(world.u.cometB.value.x).toBeGreaterThan(0);
        frame(world, camera, 1 / 30, () => world.levelUp(3));
        expect(world.comet.birth).toBe(birth);
        world.dispose();
    });

    it('keep their heads in the frame with sky to the right for the tail', () => {
        COMET_PATHS.forEach(([from, to]) => {
            [from, to].forEach(([x, y]) => {
                expect(Math.abs(x)).toBeLessThanOrEqual(1.1);
                expect(Math.abs(y)).toBeLessThanOrEqual(1.1);
                expect(x).toBeLessThanOrEqual(0.7);
            });
        });
    });
});

describe('great white storms rise by the clock', () => {
    it('erupt in the north, grow and fade, and the world draws them', () => {
        expect(outbreakAt(OUTBREAK.first - 1)).toBeNull();
        const early = outbreakAt(OUTBREAK.first + 1);
        const mid = outbreakAt(OUTBREAK.first + OUTBREAK.life * 0.5);
        expect(early.strength).toBeLessThan(mid.strength);
        expect(mid.lat).toBeGreaterThan(0.2);
        expect(outbreakAt(OUTBREAK.first + OUTBREAK.life + 1)).toBeNull();
        expect(outbreakAt(OUTBREAK.first + OUTBREAK.period + 5)).not.toBeNull();
        const { world, camera } = makeWorld(OUTBREAK.first + 30);
        frame(world, camera, 1 / 30);
        expect(world.u.outbreak.value.w).toBeGreaterThan(0);
        expect(Math.abs(world.u.outbreakDir.value)).toBe(1);
        world.dispose();
    });
});
