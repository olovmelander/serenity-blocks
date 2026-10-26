/**
 * Crystal Cave — the veins: the stones' colours turn by a clock of their own (crystal-cave-veins.js),
 * like a geode's minerals, and every level is one vein on (crystal-cave-world.js applyVein).
 * Timings are read from the modules, never copied.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseCrystalCaveCavern } from '../../src/themes/crystal-cave/crystal-cave-assets.js';
import { CRYSTAL_CAVE_HOUR_SECONDS } from '../../src/themes/crystal-cave/crystal-cave-hours.js';
import { GEM_FAMILIES } from '../../src/themes/crystal-cave/crystal-cave-light.js';
import { CrystalCaveReactions } from '../../src/themes/crystal-cave/crystal-cave-reactions.js';
import {
    CRYSTAL_CAVE_VEINS, CRYSTAL_CAVE_VEIN_HEX, CRYSTAL_CAVE_VEIN_HOLD, CRYSTAL_CAVE_VEIN_SECONDS,
    crystalCaveVeinAt, crystalCaveVeinDrift, crystalCaveVeinName,
} from '../../src/themes/crystal-cave/crystal-cave-veins.js';
import { CrystalCaveWorld } from '../../src/themes/crystal-cave/crystal-cave-world.js';

const N = CRYSTAL_CAVE_VEINS.length;
const P = CRYSTAL_CAVE_VEIN_SECONDS;
const REST_END = P * CRYSTAL_CAVE_VEIN_HOLD;
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

/** The families' colours the world has written into the cave's light. */
const coloursOf = (world) => world.light.familyColors.map((colour) => colour.toArray());
/** The largest difference in any channel of any family's colour. */
const far = (a, b) => Math.max(...a.flatMap((colour, i) => colour.map((c, k) => Math.abs(c - b[i][k]))));
const saturation = ([r, g, b]) => {
    const max = Math.max(r, g, b);
    return max > 0 ? (max - Math.min(r, g, b)) / max : 0;
};

describe('Crystal Cave veins', () => {
    it('keeps a house pace, on a clock of its own beside the hours', () => {
        expect(N).toBeGreaterThanOrEqual(4);
        expect(N).toBeLessThanOrEqual(6);
        expect(P).toBeGreaterThanOrEqual(80);
        expect(P).toBeLessThanOrEqual(150);
        // Not the hours' period: the stones and the light drift through ever new pairings.
        expect(P).not.toBe(CRYSTAL_CAVE_HOUR_SECONDS);
        expect(CRYSTAL_CAVE_VEIN_HOLD).toBeGreaterThanOrEqual(0.3);
        expect(CRYSTAL_CAVE_VEIN_HOLD).toBeLessThan(0.6);
    });

    it('opens on the cave as it always was: the first vein is the families\' own colours', () => {
        expect(CRYSTAL_CAVE_VEIN_HEX[0].gems).toEqual(GEM_FAMILIES.map((family) => family.hex));
        const own = GEM_FAMILIES.map((family) => new THREE.Color(family.hex).toArray());
        expect(far(crystalCaveVeinAt(0), own)).toBeLessThan(1e-6);
        CRYSTAL_CAVE_VEINS.forEach((vein) => expect(vein.gems).toHaveLength(GEM_FAMILIES.length));
    });

    it('turns by the clock alone, rests on each vein, and is each vein exactly on a whole phase', () => {
        for (let k = 0; k < N + 2; k += 1) {
            expect(crystalCaveVeinDrift(k * P)).toBe(k);
            expect(crystalCaveVeinDrift(k * P + REST_END * 0.5)).toBe(k);
            expect(crystalCaveVeinDrift(k * P + REST_END + (P - REST_END) / 2)).toBeCloseTo(k + 0.5, 9);
            const vein = CRYSTAL_CAVE_VEINS[k % N];
            expect(crystalCaveVeinName(k)).toBe(vein.name);
            expect(crystalCaveVeinAt(k)).toEqual(vein.gems.map((colour) => [...colour]));
        }
        let before = crystalCaveVeinDrift(0);
        for (let t = 0.25; t < P * (N + 1); t += 0.25) {
            const now = crystalCaveVeinDrift(t);
            expect(now).toBeGreaterThanOrEqual(before);
            before = now;
        }
    });

    it('makes every vein a different cave, and melts between them without going grey', () => {
        for (let k = 0; k < N; k += 1) {
            const here = crystalCaveVeinAt(k);
            const next = crystalCaveVeinAt(k + 1);
            expect(far(here, next)).toBeGreaterThan(0.2);
            for (let step = 1; step < 10; step += 1) {
                const melt = crystalCaveVeinAt(k + step / 10);
                melt.forEach((colour, family) => {
                    const floor = Math.min(saturation(here[family]), saturation(next[family]));
                    expect(saturation(colour)).toBeGreaterThan(floor * 0.85 - 1e-9);
                });
            }
        }
    });
});

describe('Crystal Cave world veins', () => {
    it('turns the stones\' colours by the clock alone with no level-up, and leaves the families\' rest alone', () => {
        const world = build();
        world.update(5, 1 / 60);
        expect(world.getDiagnostics().vein).toBe(CRYSTAL_CAVE_VEINS[0].name);
        expect(far(coloursOf(world), CRYSTAL_CAVE_VEINS[0].gems)).toBeLessThan(1e-6);
        for (let vein = 1; vein <= N; vein += 1) {
            world.update(vein * P + 5, 1 / 60);
            expect(world.getDiagnostics().vein).toBe(CRYSTAL_CAVE_VEINS[vein % N].name);
            expect(far(coloursOf(world), CRYSTAL_CAVE_VEINS[vein % N].gems)).toBeLessThan(1e-6);
            expect(Array.from(world.light.uniforms.familyLevel.array)).toEqual([1, 1, 1, 1, 1]);
        }
        // The uniform the shaders read holds the very colours the world writes.
        expect(world.light.uniforms.familyColor.array[0]).toBe(world.light.familyColors[0]);
        // A spark in a family's colour wears the vein's colour.
        world.update(2 * P + 5, 1 / 60);
        expect(world.familyTint(1).toArray()).toEqual(world.light.familyColors[1].toArray());
    });

    it('steps a level a vein on top of the clock, eased, the short way round, beside the hour', () => {
        const world = build();
        const director = new CrystalCaveReactions();
        world.update(5, 1 / 60, director);
        world.setLevel(2);
        director.onLevelUp();
        world.update(5 + 1 / 60, 1 / 60, director);
        expect(world.veinPhase()).toBeGreaterThan(0);
        expect(world.veinPhase()).toBeLessThan(0.05);
        for (let frame = 2; frame < 60 * 30; frame += 1) world.update(5 + frame / 60, 1 / 60, director);
        expect(world.veinStep).toBe(1);
        expect(world.hourStep).toBe(1);
        expect(world.getDiagnostics().vein).toBe(CRYSTAL_CAVE_VEINS[1].name);
        // On top of the clock: a vein of the clock later the stones are two on.
        world.update(P + 6, 1 / 60, director);
        expect(world.getDiagnostics().vein).toBe(CRYSTAL_CAVE_VEINS[2].name);
        world.reset();
        expect(world.level).toBe(2);
        world.setLevel(N, { silent: true });
        expect(world.veinStep).toBe(-1);
        world.setLevel(1, { silent: true });
        expect(world.veinStep).toBe(0);
    });
});
