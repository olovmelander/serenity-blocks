import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseCrystalCaveCavern } from '../../src/themes/crystal-cave/crystal-cave-assets.js';
import {
    CRYSTAL_CAVE_HOURS, CRYSTAL_CAVE_HOUR_COLOURS, CRYSTAL_CAVE_HOUR_HOLD, CRYSTAL_CAVE_HOUR_SCALARS,
    CRYSTAL_CAVE_HOUR_SECONDS, crystalCaveHourAt, crystalCaveHourDrift, crystalCaveHourName,
} from '../../src/themes/crystal-cave/crystal-cave-hours.js';
import { createCaveLight } from '../../src/themes/crystal-cave/crystal-cave-light.js';
import { CrystalCavePost } from '../../src/themes/crystal-cave/crystal-cave-post.js';
import { CrystalCaveReactions } from '../../src/themes/crystal-cave/crystal-cave-reactions.js';
import { CrystalCaveWorld } from '../../src/themes/crystal-cave/crystal-cave-world.js';

const N = CRYSTAL_CAVE_HOURS.length;
const P = CRYSTAL_CAVE_HOUR_SECONDS;
const REST_END = P * CRYSTAL_CAVE_HOUR_HOLD;
let gltf;
const worlds = [];

beforeAll(async () => {
    const bytes = readFileSync(new URL('../../src/themes/crystal-cave/assets/cavern.glb', import.meta.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    gltf = await new GLTFLoader().parseAsync(buffer, '');
});

afterEach(() => {
    worlds.splice(0).forEach((world) => world.dispose());
});

function build() {
    const world = new CrystalCaveWorld({
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 300),
        assets: parseCrystalCaveCavern(gltf),
        quality: 'Low',
    });
    worlds.push(world);
    return world;
}

/** What the hour has set in the cave's light. */
function lightOf(world) {
    const u = world.light.uniforms;
    return {
        sky: u.skyTint.value.toArray(),
        skyLevel: u.skyLevel.value,
        stones: u.stoneGlow.value,
        haze: u.hazeColor.value.toArray(),
    };
}

describe('Crystal Cave hours above the cave', () => {
    it('keeps a house pace: 80 s or more an hour, with a rest before each melt', () => {
        expect(N).toBeGreaterThanOrEqual(4);
        expect(N).toBeLessThanOrEqual(6);
        expect(P).toBeGreaterThanOrEqual(80);
        expect(CRYSTAL_CAVE_HOUR_HOLD).toBeGreaterThanOrEqual(0.3);
        expect(CRYSTAL_CAVE_HOUR_HOLD).toBeLessThanOrEqual(0.4);
        expect(new Set(CRYSTAL_CAVE_HOURS.map((hour) => hour.name)).size).toBe(N);
        for (const hour of CRYSTAL_CAVE_HOURS) {
            for (const key of CRYSTAL_CAVE_HOUR_COLOURS) expect(hour[key], `${hour.name} ${key}`).toHaveLength(3);
            for (const key of CRYSTAL_CAVE_HOUR_SCALARS) expect(hour[key] >= 0, `${hour.name} ${key}`).toBe(true);
        }
    });

    it('opens on the cave as it always was', () => {
        const [first] = CRYSTAL_CAVE_HOURS;
        expect(first.sky).toEqual([1, 1, 1]);
        for (const key of ['skyGain', 'stones', 'hazeDensity', 'pool', 'exposure']) expect(first[key]).toBe(1);
        expect(first.worms).toBe(0);
        const light = createCaveLight();
        light.uniforms.hazeColor.value.toArray().forEach((c, i) => expect(c).toBeCloseTo(first.haze[i], 9));
        expect(light.uniforms.skyTint.value.toArray()).toEqual([1, 1, 1]);
        expect([light.uniforms.skyLevel.value, light.uniforms.stoneGlow.value]).toEqual([1, 1]);
        light.dispose();
    });

    it('turns by the clock alone, rests on each hour, and is each hour exactly on a whole phase', () => {
        expect(crystalCaveHourDrift(REST_END - 0.5)).toBe(0);
        expect(crystalCaveHourDrift(2 * P)).toBe(2);
        let last = 0;
        for (let t = 0; t <= 2 * N * P; t += 0.5) {
            const phase = crystalCaveHourDrift(t);
            expect(phase).toBeGreaterThanOrEqual(last);
            expect(phase - last).toBeLessThan(0.05);
            last = phase;
        }
        CRYSTAL_CAVE_HOURS.forEach((hour, index) => {
            const at = crystalCaveHourAt(index - N);
            for (const key of CRYSTAL_CAVE_HOUR_COLOURS) expect(at[key]).toEqual([...hour[key]]);
            for (const key of CRYSTAL_CAVE_HOUR_SCALARS) expect(at[key]).toBe(hour[key]);
            expect(crystalCaveHourName(index + 0.3)).toBe(hour.name);
            // Each hour clearly its own: the skylight or the stones or the glow-worms differ.
            const next = CRYSTAL_CAVE_HOURS[(index + 1) % N];
            const sky = Math.hypot(...hour.sky.map((c, i) => c * hour.skyGain - next.sky[i] * next.skyGain));
            expect(sky + Math.abs(hour.stones - next.stones) + Math.abs(hour.worms - next.worms), hour.name)
                .toBeGreaterThan(0.3);
        });
    });
});

describe('Crystal Cave world hours', () => {
    it('turns the light by the clock alone with no level-up, and never touches the families\' rest', () => {
        const world = build();
        world.update(5, 1 / 60);
        expect(world.getDiagnostics().hour).toBe(CRYSTAL_CAVE_HOURS[0].name);
        const opening = lightOf(world);
        expect(world.rock.controls.skyGain.value).toBeCloseTo(2.4, 9);
        for (let hour = 1; hour <= N; hour += 1) {
            world.update(hour * P + 5, 1 / 60);
            const expected = CRYSTAL_CAVE_HOURS[hour % N];
            expect(world.getDiagnostics().hour).toBe(expected.name);
            expect(lightOf(world).sky).toEqual([...expected.sky]);
            expect(lightOf(world).stones).toBe(expected.stones);
            expect(world.air.controls.worms.value).toBe(expected.worms);
            expect(Array.from(world.light.uniforms.familyLevel.array)).toEqual([1, 1, 1, 1, 1]);
        }
        world.update(3 * P + 5, 1 / 60);
        expect(lightOf(world)).not.toEqual(opening);
        // Play on top: the hour sets where the hall rests, the heat still lifts it.
        const director = new CrystalCaveReactions();
        world.update(3 * P + 6, 1 / 60, director);
        const night = CRYSTAL_CAVE_HOURS[3];
        expect(world.rock.controls.skyGain.value).toBeCloseTo(2.4 * night.skyGain, 9);
        expect(world.air.controls.worms.value).toBeCloseTo(night.worms, 9);
    });

    it('steps a level an hour on top of the clock, eased, the short way round, and keeps it through a reset', () => {
        const world = build();
        const director = new CrystalCaveReactions();
        world.update(5, 1 / 60, director);
        world.setLevel(2);
        director.onLevelUp();
        world.update(5 + 1 / 60, 1 / 60, director);
        expect(world.hourPhase()).toBeGreaterThan(0);
        expect(world.hourPhase()).toBeLessThan(0.05);
        for (let frame = 2; frame < 60 * 30; frame += 1) world.update(5 + frame / 60, 1 / 60, director);
        expect(world.hourStep).toBe(1);
        expect(world.getDiagnostics().hour).toBe(CRYSTAL_CAVE_HOURS[1].name);
        expect(lightOf(world).sky).toEqual([...CRYSTAL_CAVE_HOURS[1].sky]);
        // On top of the clock: an hour of the clock later the day is two on.
        world.update(P + 6, 1 / 60, director);
        expect(world.getDiagnostics().hour).toBe(CRYSTAL_CAVE_HOURS[2].name);
        world.reset();
        expect(world.level).toBe(2);
        world.setLevel(N, { silent: true });
        expect(world.hourStep).toBe(-1);
        world.setLevel(1, { silent: true });
        expect(world.hourStep).toBe(0);
    });

    it('rests the lens\'s iris where the hour says', () => {
        const world = build();
        const post = new CrystalCavePost({
            renderer: {},
            scene: new THREE.Scene(),
            camera: new THREE.PerspectiveCamera(),
            quality: 'Low',
            atmosphere: world.getAtmosphere(),
        });
        world.update(5, 1 / 60);
        post.update({});
        const rest = post.uExposure.value;
        world.update(4 * P + 5, 1 / 60);
        post.update({});
        expect(post.uExposure.value).toBeCloseTo(rest * CRYSTAL_CAVE_HOURS[4].exposure, 9);
        post.dispose();
    });
});
