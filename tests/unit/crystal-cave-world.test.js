import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseCrystalCaveCavern } from '../../src/themes/crystal-cave/crystal-cave-assets.js';
import { GEM_STRIDE, createGemGeometry, packCrystal } from '../../src/themes/crystal-cave/crystal-cave-gems.js';
import { FAMILY_COUNT, GEM_FAMILIES, createCaveNoiseTexture } from '../../src/themes/crystal-cave/crystal-cave-light.js';
import { QUALITY_PRESETS } from '../../src/themes/crystal-cave/crystal-cave-quality.js';
import { CrystalCaveReactions } from '../../src/themes/crystal-cave/crystal-cave-reactions.js';
import {
    CRYSTAL_CAVE_DEFAULT_BOARD, CrystalCaveStage, readCrystalCaveBoardRect,
} from '../../src/themes/crystal-cave/crystal-cave-stage.js';
import { CrystalCaveWorld } from '../../src/themes/crystal-cave/crystal-cave-world.js';

const TIERS = Object.keys(QUALITY_PRESETS);
let gltf;
const worlds = [];

beforeAll(async () => {
    const bytes = readFileSync(new URL('../../src/themes/crystal-cave/assets/cavern.glb', import.meta.url));
    gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
});

afterEach(() => {
    worlds.splice(0).forEach((world) => world.dispose());
});

function build(quality = 'High', aspect = 16 / 9) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 300);
    const world = new CrystalCaveWorld({
        scene, camera, assets: parseCrystalCaveCavern(gltf), quality,
    });
    worlds.push(world);
    return { scene, camera, world };
}

function play(world, director, seconds, hz = 60) {
    const steps = Math.round(seconds * hz);
    for (let index = 0; index < steps; index += 1) {
        director.update(1 / hz);
        world.update(world.time + 1 / hz, 1 / hz, director);
    }
}

const piece = (type, x, y = 20) => ({
    type, x, y, shape: [[1, 1, 1], [0, 1, 0]],
});

describe('Crystal Cave gem geometry and records', () => {
    it('builds the canonical crystal: six shaft faces and six termination faces, outward facing', () => {
        const geometry = createGemGeometry();
        const position = geometry.getAttribute('position');
        const face = geometry.getAttribute('aFace');
        expect(position.count).toBe(54);
        expect(geometry.getAttribute('uv').count).toBe(54);
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const normal = new THREE.Vector3();
        let apexes = 0;
        for (let index = 0; index < position.count; index += 3) {
            a.fromBufferAttribute(position, index);
            b.fromBufferAttribute(position, index + 1);
            c.fromBufferAttribute(position, index + 2);
            [a, b, c].forEach((point) => {
                if (point.y === 2) {
                    apexes += 1;
                    point.y = 1.6;
                }
            });
            normal.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
            // The face's own direction (cos, sin of its side) points the same way.
            const outward = new THREE.Vector3(face.getX(index), 0, face.getY(index));
            expect(normal.dot(outward)).toBeGreaterThan(0.5);
            expect(face.getX(index + 1)).toBe(face.getX(index));
            expect(face.getZ(index + 2)).toBe(face.getZ(index));
        }
        expect(apexes).toBe(6);
        // Side planes sit at distance one from the axis.
        for (let index = 0; index < position.count; index += 1) {
            if (position.getY(index) > 1.5) continue;
            const reach = position.getX(index) * face.getX(index) + position.getZ(index) * face.getY(index);
            expect(reach).toBeCloseTo(1, 5);
        }
        geometry.dispose();
    });

    it('packs a crystal record into its sixteen floats', () => {
        const target = new Float32Array(GEM_STRIDE * 2);
        packCrystal(target, 1, {
            x: 1, y: 2, z: 3, qx: 0, qy: 0, qz: 0, qw: 1, radius: 2, depth: 1.5, height: 8, tip: 2, apexX: 0.1, apexZ: -0.2,
            family: 3, glow: 1.2, seed: 0.5,
        });
        expect([...target.slice(0, GEM_STRIDE)]).toEqual(new Array(GEM_STRIDE).fill(0));
        const record = [...target.slice(GEM_STRIDE)].map((value) => Math.round(value * 1000) / 1000);
        expect(record).toEqual([1, 2, 3, 2, 0, 0, 0, 1, 8, 1.5, 0.25, 0.5, 0.1, -0.2, 3, 1.2]);
    });

    it('offers five families and a tiling noise that both backends read identically', () => {
        expect(FAMILY_COUNT).toBe(5);
        expect(GEM_FAMILIES.map((family) => family.id)).toEqual(['aqua', 'amethyst', 'sapphire', 'rose', 'amber']);
        const first = createCaveNoiseTexture();
        const second = createCaveNoiseTexture();
        expect(first.image.width).toBe(256);
        expect(first.wrapS).toBe(THREE.RepeatWrapping);
        expect([...first.image.data.slice(0, 64)]).toEqual([...second.image.data.slice(0, 64)]);
        const values = new Set(first.image.data.slice(0, 4000));
        expect(values.size).toBeGreaterThan(100);
        first.dispose();
        second.dispose();
    });
});

describe('Crystal Cave stage', () => {
    it('maps the board card to world points in front of the camera', () => {
        const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 300);
        camera.position.set(0, 4, 30);
        camera.lookAt(0, 2, -18);
        const stage = new CrystalCaveStage(camera);
        const left = stage.edge(-1, 0.5);
        const right = stage.edge(1, 0.5);
        expect(left.x).toBeLessThan(-2);
        expect(right.x).toBeGreaterThan(2);
        expect(left.x).toBeCloseTo(-right.x, 5);
        expect(left.z).toBeLessThan(camera.position.z - 10);
        expect(stage.edge(-1, 1).y).toBeGreaterThan(stage.edge(-1, 0).y + 5);
        expect(stage.cell(0.5, 0.5).x).toBeCloseTo(0, 5);
        expect(stage.centre().distanceTo(stage.cell(0.5, 0.5))).toBeCloseTo(0, 5);
    });

    it('follows a measured card and falls back to the default for nonsense', () => {
        const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 300);
        const stage = new CrystalCaveStage(camera);
        stage.setBoard({
            x0: 0.1, x1: 0.3, y0: 0.2, y1: 0.8,
        });
        expect(stage.edge(1, 0.5).x).toBeLessThan(0);
        for (const rect of [null, {}, {
            x0: 0.5, x1: 0.5, y0: 0, y1: 1,
        }, {
            x0: NaN, x1: 1, y0: 0, y1: 1,
        }]) {
            stage.setBoard(rect);
            expect(stage.board).toEqual({ ...CRYSTAL_CAVE_DEFAULT_BOARD });
        }
    });

    it('measures the union of visible board cards and ignores hidden ones', () => {
        const card = (left, top, width, height, style = {}) => ({
            getBoundingClientRect: () => ({
                left, top, right: left + width, bottom: top + height, width, height,
            }),
            style,
        });
        const cards = [card(400, 100, 200, 600), card(700, 150, 200, 500), card(0, 0, 4, 4),
            card(100, 100, 200, 200, { display: 'none' })];
        const doc = { querySelectorAll: () => cards };
        const win = { innerWidth: 1000, innerHeight: 800, getComputedStyle: (element) => ({ opacity: '1', ...element.style }) };
        expect(readCrystalCaveBoardRect(doc, win)).toEqual({
            x0: 0.4, x1: 0.9, y0: 0.125, y1: 0.875,
        });
        expect(readCrystalCaveBoardRect({ querySelectorAll: () => [] }, win)).toBeNull();
        expect(readCrystalCaveBoardRect(null, win)).toBeNull();
    });
});

describe('Crystal Cave world', () => {
    it('builds the same cave from node materials at every tier', () => {
        const counts = TIERS.map((quality) => {
            const { scene, world } = build(quality);
            const diagnostics = world.getDiagnostics();
            expect(diagnostics.quality).toBe(quality);
            scene.traverse((object) => {
                for (const material of [].concat(object.material ?? [])) expect(material.isNodeMaterial).toBe(true);
            });
            const preset = QUALITY_PRESETS[quality];
            expect(diagnostics.reflection).toBe(preset.reflectionScale > 0);
            expect(diagnostics.pools).toEqual({
                sparks: preset.sparks, fans: preset.fans, beams: preset.beams, rings: preset.rings,
            });
            expect(diagnostics.air.glowworms).toBe(Math.min(preset.glowworms, world.assets.glowworms.count));
            expect(diagnostics.air.motes).toBe(preset.motes);
            expect(diagnostics.lattice).toBeGreaterThan(1);
            expect(diagnostics.lattice).toBeLessThanOrEqual(preset.beams);
            expect(diagnostics.sprouts).toBe(world.assets.meta.sprouts.length);
            // Every crystal of any size survives the thinning of the small ones.
            const large = world.assets.crystals.filter((crystal) => crystal.group > 0 || crystal.height >= 2.2).length;
            expect(diagnostics.crystals).toBeGreaterThanOrEqual(large);
            return diagnostics.crystals;
        });
        // Extreme first, Minimal last: the crystal count never rises as the tier falls.
        for (let index = 1; index < counts.length; index += 1) expect(counts[index]).toBeLessThanOrEqual(counts[index - 1]);
        expect(counts[0]).toBe(parseCrystalCaveCavern(gltf).crystals.length);
        expect(counts.at(-1)).toBeLessThan(counts[0]);
    });

    it('draws crystals nearest first so hidden stones are rejected by depth', () => {
        const { world } = build('High');
        const [x, y, z] = world.assets.meta.camera.eye;
        const range = world.crystals.map((crystal) => Math.hypot(crystal.x - x, crystal.y - y, crystal.z - z));
        for (let index = 1; index < range.length; index += 1) expect(range[index]).toBeGreaterThanOrEqual(range[index - 1]);
    });

    it('frames landscape and portrait from the authored camera and never moves far from it', () => {
        for (const aspect of [16 / 9, 390 / 844]) {
            const { world, camera } = build('Low', aspect);
            world.prepareCamera(aspect);
            expect(camera.fov).toBe(aspect < 0.9 ? 72 : 55);
            expect(camera.position.toArray()).toEqual([0, 4, 30]);
            for (const time of [0, 7, 31, 120, 999]) {
                world.update(time, 0.016, null, { x: 1, y: -1 });
                expect(camera.position.distanceTo(new THREE.Vector3(0, 4, 30))).toBeLessThan(2.2);
                expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
            }
        }
    });

    it('starts with the shore bare and the lattice dark', () => {
        const { world } = build('High');
        const diagnostics = world.getDiagnostics();
        expect(diagnostics.grown).toBe(0);
        expect(diagnostics.activeSparks).toBe(0);
        world.lattice.forEach((_link, index) => expect(world.effects.beamLevelOf(index)).toBe(0));
        expect(world.light.uniforms.energy.value).toBe(0);
        expect([...world.light.uniforms.familyLevel.array]).toEqual([1, 1, 1, 1, 1]);
    });

    it('sends light from the board to crystals of the piece\'s family on its side', () => {
        const { world } = build('High');
        const director = new CrystalCaveReactions();
        const pulses = [];
        const pulse = world.gems.pulse.bind(world.gems);
        world.gems.pulse = (index, time, strength) => {
            pulses.push(index);
            pulse(index, time, strength);
        };
        director.onPieceLock({ piece: piece('O', 0) });
        play(world, director, 0.1);
        expect(world.getDiagnostics().activeSparks).toBeGreaterThan(6);
        play(world, director, 1.4);
        expect(pulses.length).toBeGreaterThanOrEqual(2);
        pulses.forEach((index) => {
            const crystal = world.crystals[index];
            expect(crystal.x).toBeLessThan(0);
            expect(crystal.group).toBe(0);
        });
        // Amethyst pieces charge amethyst stones when the side has any.
        const amethystOnLeft = world.targets[1 * 2 + 0].length > 0;
        if (amethystOnLeft) pulses.forEach((index) => expect(world.crystals[index].family).toBe(1));
        expect(world.light.uniforms.familyLevel.array[1]).toBeGreaterThan(1);
    });

    it('grows one cluster per cleared line at the water\'s edge and withdraws them on game over', () => {
        const { world } = build('High');
        const director = new CrystalCaveReactions();
        director.onLineClear({ lineCount: 3, clearedRows: [21, 22, 23] });
        play(world, director, 2.4);
        expect(world.getDiagnostics().grown).toBe(3);
        expect(world.light.uniforms.energy.value).toBeGreaterThan(0);
        expect(world.rock.controls.waveStrength.value).toBeGreaterThan(0);
        director.onLineClear({ lineCount: 1 });
        play(world, director, 2.4);
        expect(world.getDiagnostics().grown).toBe(4);
        director.onGameOver();
        play(world, director, 3);
        expect(world.getDiagnostics().grown).toBe(0);
    });

    it('keeps answering once every site has grown, without growing more', () => {
        const { world } = build('Medium');
        const director = new CrystalCaveReactions();
        for (let round = 0; round < 14; round += 1) {
            director.onLineClear(4);
            play(world, director, 0.9);
        }
        play(world, director, 2);
        expect(world.getDiagnostics().grown).toBe(world.sites.length);
        director.onLineClear(4);
        expect(() => play(world, director, 1)).not.toThrow();
        expect(world.getDiagnostics().grown).toBe(world.sites.length);
    });

    it('links the lattice as a chain builds and lets it go when the chain breaks', () => {
        const { world } = build('High');
        const director = new CrystalCaveReactions();
        const lit = () => world.lattice.filter((_link, index) => world.effects.beamLevelOf(index) > 0.2).length;
        for (let step = 2; step <= 3; step += 1) {
            director.onPieceLock({ piece: piece('T', 3) });
            director.onLineClear(1);
            director.onCombo(step);
            play(world, director, 0.7);
        }
        const early = lit();
        expect(early).toBeGreaterThan(0);
        for (let step = 4; step <= 9; step += 1) {
            director.onPieceLock({ piece: piece('T', 3) });
            director.onLineClear(1);
            director.onCombo(step);
            play(world, director, 0.7);
        }
        expect(lit()).toBeGreaterThan(early);
        expect(lit()).toBe(world.lattice.length);
        director.onPieceLock({ piece: piece('T', 3) });
        director.onPieceLock({ piece: piece('T', 3) });
        play(world, director, 3.5);
        expect(lit()).toBe(0);
    });

    it.each(TIERS)('stays inside its fixed pools through a flood of events at %s', (quality) => {
        const { scene, world } = build(quality);
        const director = new CrystalCaveReactions();
        const before = { children: world.group.children.length, sceneChildren: scene.children.length };
        const drawables = [];
        scene.traverse((object) => { if (object.isMesh) drawables.push(object); });
        const preset = QUALITY_PRESETS[quality];
        for (let round = 0; round < 40; round += 1) {
            director.onHardDrop({ distance: 18 });
            director.onPieceLock({ piece: piece('IOTSZJL'[round % 7], round % 10, 6 + (round % 18)) });
            director.onLineClear(1 + (round % 4));
            director.onCombo(2 + round);
            if (round % 6 === 0) director.onTSpin({ piece: piece('T', 7) });
            if (round % 9 === 0) director.onPerfectClear();
            if (round % 11 === 0) director.onLevelUp();
            play(world, director, 0.12, 30);
            const diagnostics = world.getDiagnostics();
            expect(diagnostics.activeSparks).toBeLessThanOrEqual(preset.sparks);
            expect(diagnostics.grown).toBeLessThanOrEqual(world.sites.length);
        }
        expect(world.group.children.length).toBe(before.children);
        expect(scene.children.length).toBe(before.sceneChildren);
        const after = [];
        scene.traverse((object) => { if (object.isMesh) after.push(object); });
        expect(after).toEqual(drawables);
        for (const value of [world.light.uniforms.energy.value, world.light.uniforms.resonance.value,
            world.light.uniforms.flash.value, ...world.light.uniforms.familyLevel.array]) {
            expect(Number.isFinite(value)).toBe(true);
        }
        expect(world.actions.filter((action) => action.active).length).toBeLessThanOrEqual(world.actions.length);
    });

    it('replays an event identically after reset', () => {
        const { world } = build('High');
        const director = new CrystalCaveReactions();
        const run = () => {
            director.reset();
            world.reset();
            director.onHardDrop({ distance: 14 });
            director.onPieceLock({ piece: piece('S', 7) });
            director.onLineClear({ lineCount: 2, clearedRows: [22, 23] });
            play(world, director, 0.5);
            const sparks = world.effects.group.children[0].geometry;
            return JSON.stringify([
                world.getDiagnostics().activeSparks,
                [...sparks.getAttribute('iPlace').array.slice(0, 48)].map((value) => Math.round(value * 1e4)),
                world.sites.map((site) => Math.round(site.growth * 1e4)),
                world.rock.controls.waveRadius.value,
            ]);
        };
        const first = run();
        expect(run()).toBe(first);
    });

    it('returns to the idle cave on reset', () => {
        const { world } = build('High');
        const director = new CrystalCaveReactions();
        director.onLineClear(4);
        director.onCombo(6);
        play(world, director, 1.2);
        director.reset();
        world.reset();
        const diagnostics = world.getDiagnostics();
        expect(diagnostics.activeSparks).toBe(0);
        expect(diagnostics.grown).toBe(0);
        expect(world.rock.controls.waveStrength.value).toBe(0);
        expect([...world.light.uniforms.familyLevel.array]).toEqual([1, 1, 1, 1, 1]);
        world.lattice.forEach((_link, index) => expect(world.effects.beamLevelOf(index)).toBe(0));
    });

    it('ignores malformed frames and is safe to update after disposal', () => {
        const { world, camera } = build('Low');
        const eye = camera.position.clone();
        for (const [time, dt] of [[NaN, 0.016], [1, NaN], [Infinity, 0.016], [undefined, undefined]]) {
            expect(() => world.update(time, dt)).not.toThrow();
        }
        expect(camera.position.equals(eye)).toBe(true);
        world.dispose();
        expect(() => world.update(1, 0.016)).not.toThrow();
        expect(() => world.dispose()).not.toThrow();
    });

    it('removes everything it added and nothing else on dispose', () => {
        const { scene, world } = build('High');
        const marker = new THREE.Object3D();
        scene.add(marker);
        const geometry = world.assets.geometry;
        world.dispose();
        expect(scene.children).toEqual([marker]);
        // The cavern belongs to the asset pack, not to the world.
        expect(geometry.getAttribute('position')).toBeDefined();
    });

    it('rejects a missing scene or cavern', () => {
        expect(() => new CrystalCaveWorld({ camera: new THREE.PerspectiveCamera(), assets: {} })).toThrow(TypeError);
        expect(() => new CrystalCaveWorld({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), assets: {} }))
            .toThrow(/cavern/);
    });
});
