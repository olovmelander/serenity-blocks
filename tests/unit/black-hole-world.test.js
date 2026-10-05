import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { readBoardRects } from '../../src/themes/black-hole/black-hole-board-rects.js';
import { DIRECTOR_LIMITS } from '../../src/themes/black-hole/black-hole-director.js';
import { DISK_COS_TILT, DISK_SIN_TILT } from '../../src/themes/black-hole/black-hole-disk-basis.js';
import { HOLE, HOTSPOT_SLOTS, WAVE_SLOTS } from '../../src/themes/black-hole/black-hole-lens.js';
import { TURN_WRAP } from '../../src/themes/black-hole/black-hole-matter.js';
import {
    bakeDiskTexture, bakeSkyRows, bakeSkyTexture, createRandom, valueNoise2, valueNoise3,
} from '../../src/themes/black-hole/black-hole-noise.js';
import {
    QUALITY_PRESETS, normalizeBlackHoleQuality, resolveBlackHoleQuality,
} from '../../src/themes/black-hole/black-hole-quality.js';
import { ResolutionController } from '../../src/themes/black-hole/black-hole-resolution.js';
import {
    BLACK_HOLE_SEED, BlackHoleWorld, bakeBlackHoleTextures, bakeBlackHoleTexturesAsync,
} from '../../src/themes/black-hole/black-hole-world.js';

const TIERS = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const STEP = 1 / 60;
const worlds = [];
/** A postage-stamp galaxy: these tests are about the world, not about painting its sky. */
const BAKES = bakeBlackHoleTextures({ skySize: [32, 16] }, BLACK_HOLE_SEED);

function create(quality = 'Minimal', aspect = 16 / 9) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, aspect, 1, 20000);
    const world = new BlackHoleWorld({
        scene, camera, quality, bakes: BAKES,
    });
    world.setViewport(Math.round(900 * aspect), 900);
    worlds.push(world);
    return { world, scene, camera };
}

function run(world, from, to, step = STEP) {
    for (let time = from + step; time <= to + 1e-9; time += step) world.update(time, step);
}

/** Where a world point lands on screen, in NDC. */
const onScreen = (camera, point) => point.clone().project(camera);

/** The photon ring's left and right edges, in NDC x. */
function ringEdges(world, camera) {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(135);
    return [-1, 1].map((side) => world.hole.clone().addScaledVector(right, side).project(camera).x);
}

const piece = (overrides = {}) => ({
    x: 3, y: 20, shape: [[0, 1, 0], [1, 1, 1]], color: '#62ffe0', ...overrides,
});

afterEach(() => {
    for (const world of worlds) world.dispose();
    worlds.length = 0;
});

describe('Black Hole quality tiers', () => {
    it('scales every budget down the tiers and keeps the whole picture on each', () => {
        for (let i = 1; i < TIERS.length; i += 1) {
            const above = QUALITY_PRESETS[TIERS[i - 1]];
            const below = QUALITY_PRESETS[TIERS[i]];
            for (const key of ['marchSteps', 'starLayers', 'dustCount', 'sparkCount', 'infallMotes', 'infallSlots',
                'bloomScale', 'pixelRatio']) {
                expect(below[key], `${TIERS[i]}.${key}`).toBeLessThanOrEqual(above[key]);
            }
            // Fewer steps must take longer strides, or the march stops short of the far side.
            expect(below.stepScale).toBeGreaterThanOrEqual(above.stepScale);
            expect(below.skySize[0]).toBeLessThanOrEqual(above.skySize[0]);
        }
        for (const tier of TIERS) {
            const preset = QUALITY_PRESETS[tier];
            expect(preset.marchSteps).toBeGreaterThanOrEqual(24);
            expect(preset.infallSlots).toBeGreaterThanOrEqual(4);
            expect(preset.infallSlots).toBeLessThanOrEqual(DIRECTOR_LIMITS.infalls);
            expect(preset.dustCount).toBeGreaterThan(0);
            expect(preset.sparkCount).toBeGreaterThanOrEqual(DIRECTOR_LIMITS.bursts * 8);
            expect(preset.minScale).toBeLessThan(1);
            // The march reaches round the hole: enough strides to cross the bound and back.
            expect(preset.marchSteps * Math.log1p(preset.stepScale)).toBeGreaterThan(Math.log(HOLE.ESCAPE) * 2);
        }
        expect(QUALITY_PRESETS.Minimal.enablePost).toBe(false);
        expect(QUALITY_PRESETS.Low.enablePost).toBe(true);
        expect(Object.isFrozen(QUALITY_PRESETS) && Object.isFrozen(QUALITY_PRESETS.High)).toBe(true);
    });

    it('accepts the legacy label for the cheapest tier and falls back to High', () => {
        expect(normalizeBlackHoleQuality('Minimum')).toBe('Minimal');
        expect(normalizeBlackHoleQuality(' minimum ')).toBe('Minimal');
        expect(normalizeBlackHoleQuality('ultra')).toBe('Ultra');
        expect(normalizeBlackHoleQuality(undefined)).toBe('High');
        expect(normalizeBlackHoleQuality('Custom')).toBe('High');
        expect(resolveBlackHoleQuality('Low')).toEqual({ name: 'Low', preset: QUALITY_PRESETS.Low });
    });
});

describe('Black Hole bakes', () => {
    it('bakes a repeatable, full-range gas tile that wraps on both axes', () => {
        const [width, height] = [64, 32];
        const gas = bakeDiskTexture(width, height, 7);
        expect(gas).toHaveLength(width * height * 4);
        expect(Array.from(gas)).toEqual(Array.from(bakeDiskTexture(width, height, 7)));
        expect(Array.from(gas)).not.toEqual(Array.from(bakeDiskTexture(width, height, 8)));
        for (let channel = 0; channel < 4; channel += 1) {
            let low = 255;
            let high = 0;
            for (let i = channel; i < gas.length; i += 4) {
                low = Math.min(low, gas[i]);
                high = Math.max(high, gas[i]);
            }
            expect([low, high]).toEqual([0, 255]);
        }
        // Across each wrap the texture changes no faster than it does inside itself.
        const at = (x, y, channel) => gas[(y * width + x) * 4 + channel];
        for (let channel = 0; channel < 4; channel += 1) {
            let inside = 0;
            let seam = 0;
            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width - 1; x += 1) {
                    inside = Math.max(inside, Math.abs(at(x, y, channel) - at(x + 1, y, channel)));
                }
                seam = Math.max(seam, Math.abs(at(width - 1, y, channel) - at(0, y, channel)));
            }
            expect(seam, `channel ${channel} round the disk`).toBeLessThanOrEqual(inside);
            inside = 0;
            seam = 0;
            for (let x = 0; x < width; x += 1) {
                for (let y = 0; y < height - 1; y += 1) {
                    inside = Math.max(inside, Math.abs(at(x, y, channel) - at(x, y + 1, channel)));
                }
                seam = Math.max(seam, Math.abs(at(x, height - 1, channel) - at(x, 0, channel)));
            }
            expect(seam, `channel ${channel} across the disk`).toBeLessThanOrEqual(inside);
        }
    });

    it('draws the gas long round the disk and short across it', () => {
        const [width, height] = [128, 64];
        const gas = bakeDiskTexture(width, height, 7);
        let along = 0;
        let across = 0;
        for (let y = 0; y < height - 1; y += 1) {
            for (let x = 0; x < width - 1; x += 1) {
                const here = gas[(y * width + x) * 4];
                along += Math.abs(here - gas[(y * width + x + 1) * 4]);
                across += Math.abs(here - gas[((y + 1) * width + x) * 4]);
            }
        }
        // Per texel the tile is twice as fine across as round; lanes still vary more across.
        expect(across).toBeGreaterThan(along * 2);
    });

    it('bakes a galaxy with a bright band, a dark pole and stars where the band is', () => {
        const [width, height] = [96, 48];
        const sky = bakeSkyTexture(width, height, 11);
        expect(sky).toHaveLength(width * height * 4);
        expect(Array.from(sky)).toEqual(Array.from(bakeSkyTexture(width, height, 11)));
        const row = (y) => {
            let light = 0;
            let density = 0;
            for (let x = 0; x < width; x += 1) {
                const offset = (y * width + x) * 4;
                light += sky[offset] + sky[offset + 1] + sky[offset + 2];
                density += sky[offset + 3];
            }
            return { light: light / width, density: density / width };
        };
        const pole = row(1);
        const band = row(height / 2);
        expect(band.light).toBeGreaterThan(pole.light * 2);
        expect(band.density).toBeGreaterThan(pole.density * 1.5);
        // Dim enough to stay a backdrop: no channel of the bake is near white.
        let peak = 0;
        for (let i = 0; i < sky.length; i += 4) peak = Math.max(peak, sky[i], sky[i + 1], sky[i + 2]);
        expect(peak).toBeLessThan(250);
        expect(peak).toBeGreaterThan(90);
    });

    it('bakes the same galaxy in slices as it does in one go', async () => {
        const [width, height] = [48, 24];
        const whole = bakeSkyTexture(width, height, 5);
        const sliced = new Uint8Array(width * height * 4);
        for (let row = 0; row < height; row += 5) bakeSkyRows(sliced, width, height, 5, row, Math.min(height, row + 5));
        expect(Array.from(sliced)).toEqual(Array.from(whole));

        const preset = { skySize: [40, 20] };
        const seed = 424242;
        const awaited = await bakeBlackHoleTexturesAsync(preset, seed);
        const direct = bakeBlackHoleTextures(preset, seed);
        expect(awaited.sky.data).toBe(direct.sky.data);
        expect(awaited.disk.data).toBe(direct.disk.data);
        expect(Array.from(awaited.sky.data)).toEqual(Array.from(bakeSkyTexture(40, 20, seed % 9973)));
        expect([awaited.sky.width, awaited.sky.height]).toEqual([40, 20]);
    });

    it('keeps its noise in range and its generator repeatable', () => {
        const random = createRandom(3);
        const again = createRandom(3);
        for (let i = 0; i < 200; i += 1) {
            const x = random() * 40 - 20;
            const y = random() * 40 - 20;
            expect(again()).not.toBeNaN();
            again();
            for (const value of [valueNoise2(x, y, 5, 8, 4), valueNoise3(x, y, x * 0.3, 5)]) {
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(1);
            }
            expect(valueNoise2(x + 8, y + 4, 5, 8, 4)).toBeCloseTo(valueNoise2(x, y, 5, 8, 4), 9);
        }
    });
});

describe('Black Hole world', () => {
    it('builds the same fixed set of layers on every tier', () => {
        for (const tier of TIERS) {
            const { world, scene } = create(tier);
            const preset = QUALITY_PRESETS[tier];
            const meshes = [];
            scene.traverse((object) => { if (object.isMesh) meshes.push(object); });
            expect(meshes.map((mesh) => mesh.name)).toEqual([
                'Black Hole — lens shell',
                'Black Hole — dust',
                'Black Hole — infall',
                'Black Hole — ejecta',
                'Black Hole — jets',
            ]);
            const { matter } = world;
            expect(matter.dust.count).toBe(preset.dustCount);
            expect(matter.infall.count).toBe(preset.infallSlots * preset.infallMotes);
            const perBurst = Math.floor(preset.sparkCount / DIRECTOR_LIMITS.bursts);
            expect(matter.sparks.count).toBe(perBurst * DIRECTOR_LIMITS.bursts);
            expect(matter.jets.count).toBe(2);
            // Event layers stay off the render list until an event needs them.
            expect([matter.infall.visible, matter.sparks.visible, matter.jets.visible]).toEqual([false, false, false]);
            expect(meshes.every((mesh) => mesh.frustumCulled === false)).toBe(true);
            expect(world.getDiagnostics()).toMatchObject({ quality: tier, marchSteps: preset.marchSteps });
        }
    });

    it('shares the uniforms the lens and the matter both read, in the disk frame they agree on', () => {
        const { world } = create();
        const { uniforms, matter } = world;
        expect(matter.uniforms.holePosition).toBe(uniforms.holePosition);
        expect(matter.uniforms.rs).toBe(uniforms.rs);
        expect(uniforms.hotspot.array).toHaveLength(HOTSPOT_SLOTS);
        expect(uniforms.wave.array).toHaveLength(WAVE_SLOTS);
        expect(HOTSPOT_SLOTS).toBe(DIRECTOR_LIMITS.hotspots);
        expect(WAVE_SLOTS).toBe(DIRECTOR_LIMITS.waves);
        // World → disk takes the disk normal to +Y, and the matter's matrix undoes it.
        const normal = new THREE.Vector3(0, DISK_SIN_TILT, DISK_COS_TILT).applyMatrix3(uniforms.worldToDisk.value);
        expect(normal.toArray().map((value) => Math.round(value * 1e6) / 1e6)).toEqual([0, 1, 0]);
        const back = new THREE.Vector3(0.3, -0.4, 0.5).applyMatrix3(uniforms.worldToDisk.value)
            .applyMatrix3(matter.uniforms.diskToWorld.value);
        expect(back.x).toBeCloseTo(0.3, 6);
        expect(back.y).toBeCloseTo(-0.4, 6);
        expect(back.z).toBeCloseTo(0.5, 6);
    });

    it('releases everything it built, once', () => {
        const { world, scene } = create('Low');
        const disposed = [];
        const watch = (target, label) => target.addEventListener('dispose', () => disposed.push(label));
        watch(world.diskTexture, 'gas');
        watch(world.skyTexture, 'sky');
        watch(world.lensMaterial, 'lens');
        watch(world.lens.geometry, 'shell');
        world.matter.materials.forEach((material, index) => watch(material, `matter${index}`));
        world.dispose();
        world.dispose();
        expect(disposed.sort()).toEqual(['gas', 'lens', 'matter0', 'matter1', 'matter2', 'matter3', 'shell', 'sky']);
        expect(scene.children).toHaveLength(0);
        expect(() => world.update(1, STEP)).not.toThrow();
    });

    it('accepts bakes handed to it instead of baking its own', () => {
        const bakes = bakeBlackHoleTextures({ skySize: [24, 12] }, BLACK_HOLE_SEED);
        const scene = new THREE.Scene();
        const world = new BlackHoleWorld({
            scene, camera: new THREE.PerspectiveCamera(60, 1.6, 1, 20000), quality: 'Minimal', bakes,
        });
        worlds.push(world);
        expect(world.skyTexture.image.data).toBe(bakes.sky.data);
        expect(world.diskTexture.image.data).toBe(bakes.disk.data);
        expect(world.skyTexture.colorSpace).toBe(THREE.SRGBColorSpace);
        expect(world.diskTexture.generateMipmaps).toBe(true);
        expect(() => new BlackHoleWorld({ scene: null })).toThrow(TypeError);
    });
});

describe('Black Hole camera', () => {
    it('rests the hole in the gap beside the board and later glides it to the other side', () => {
        const { world, camera } = create();
        expect(onScreen(camera, world.hole).x).toBeCloseTo(-0.6, 0);
        let leftmost = 1;
        let rightmost = -1;
        const visits = { left: 0, behind: 0, right: 0 };
        for (let time = STEP; time < 215; time += STEP) {
            world.update(time, STEP);
            const { x } = onScreen(camera, world.hole);
            leftmost = Math.min(leftmost, x);
            rightmost = Math.max(rightmost, x);
            if (x < -0.42) visits.left += 1;
            else if (x > 0.42) visits.right += 1;
            else visits.behind += 1;
        }
        expect(leftmost).toBeGreaterThan(-0.78);
        expect(rightmost).toBeLessThan(0.78);
        expect(visits.left).toBeGreaterThan(60 * 60);
        expect(visits.right).toBeGreaterThan(60 * 60);
        // It crosses behind the board briskly rather than loitering there.
        expect(visits.behind).toBeLessThan((visits.left + visits.right) * 0.4);
    });

    it('follows the board it is told about, and keeps to the middle when there is no gap', () => {
        const { world, camera } = create();
        world.setBoardRect(0, {
            left: 0.55, right: 0.8, top: 0.1, bottom: 0.9,
        });
        run(world, 0, 6);
        expect(onScreen(camera, world.hole).x).toBeCloseTo(0.55 - 1, 1);
        world.setBoardRect(0, {
            left: 0.05, right: 0.95, top: 0.1, bottom: 0.9,
        });
        run(world, 6, 14);
        expect(Math.abs(onScreen(camera, world.hole).x)).toBeLessThan(0.45);
    });

    it.each([
        [390 / 844, 'Minimal'],
        [320 / 900, 'Minimal'],
    ])('keeps the photon ring in a portrait frame for a full minute at aspect %s', (aspect, tier) => {
        const { world, camera } = create(tier, aspect);
        let extent = 0;
        for (let time = STEP; time < 60; time += STEP) {
            world.update(time, STEP);
            extent = Math.max(extent, ...ringEdges(world, camera).map(Math.abs));
        }
        expect(extent).toBeLessThan(1);
    });

    it('reframes on the first portrait frame after a rotation', () => {
        const { world, camera } = create();
        run(world, 0, 20);
        world.prepareCamera(390 / 844);
        world.update(20 + STEP, STEP);
        expect(ringEdges(world, camera).every((edge) => Math.abs(edge) < 1)).toBe(true);
    });

    it('never comes inside the sphere the lens marches from, and stays aimed at the hole', () => {
        const { world, camera } = create();
        world.director.onLineClear({ lineCount: 4 });
        for (let time = STEP; time < 240; time += STEP * 4) {
            world.update(time, STEP * 4);
            expect(camera.position.distanceTo(world.hole)).toBeGreaterThan(HOLE.BOUND * HOLE.RS_WORLD);
            expect(world.lens.position.equals(camera.position)).toBe(true);
            const hole = onScreen(camera, world.hole);
            expect(Math.abs(hole.x)).toBeLessThan(1);
            expect(Math.abs(hole.y)).toBeLessThan(0.6);
        }
    });

    it('carries an impact as a shake on top of the orbit, not into it', () => {
        const { world, camera } = create();
        run(world, 0, 3);
        world.director.onPieceLock({ piece: piece() });
        world.director.onLineClear({ lineCount: 4 });
        world.update(3 + STEP, STEP);
        expect(world.rig.currentShakeAmount()).toBeGreaterThan(0);
        world.update(3 + STEP * 2, STEP);
        expect(camera.position.distanceTo(world.cameraSmoothed)).toBeGreaterThan(0);
        run(world, 3 + STEP * 2, 4);
        expect(world.rig.currentShakeAmount()).toBe(0);
        expect(camera.position.distanceTo(world.cameraSmoothed)).toBeLessThan(1e-9);
    });

    it('holds the camera still under reduced motion, events and all', () => {
        const { world, camera } = create();
        world.setReducedMotion(true);
        // It eases once onto its resting pose, then stays there.
        run(world, 0, 6);
        const start = camera.position.clone();
        world.director.onPieceLock({ piece: piece() });
        world.director.onLineClear({ lineCount: 4 });
        world.update(6 + STEP, STEP);
        expect(world.director.jets).toBeGreaterThan(0);
        expect(world.rig.currentShakeAmount()).toBe(0);
        run(world, 6 + STEP, 26);
        expect(camera.position.distanceTo(start)).toBeLessThan(0.05);
        expect(world.ripples.every((ripple) => ripple.strength === 0)).toBe(true);
    });

    it('holds a pose for stills', () => {
        const { world, camera } = create();
        world.pose = {
            azimuth: 0.5, elevation: 0.16, radius: 1000, frame: -0.6, up: 0,
        };
        world.reset();
        const first = camera.position.clone();
        run(world, 0, 10);
        expect(camera.position.distanceTo(first)).toBeLessThan(1e-6);
        expect(camera.position.distanceTo(world.hole)).toBeCloseTo(world.hole.distanceTo(first), 6);
        expect(onScreen(camera, world.hole).x).toBeCloseTo(-0.6, 2);
    });
});

describe('Black Hole gas clock', () => {
    it('cross-fades two shear phases so neither is seen resetting', () => {
        const { world } = create();
        const u = world.uniforms;
        let previous = { a: u.flowA.value, b: u.flowB.value };
        let resets = 0;
        for (let time = STEP; time < 120; time += STEP) {
            world.update(time, STEP);
            expect(u.flowMix.value).toBeGreaterThanOrEqual(0);
            expect(u.flowMix.value).toBeLessThanOrEqual(1);
            expect(Math.abs(u.flowA.value)).toBeLessThanOrEqual(1.1001);
            expect(Math.abs(u.flowB.value)).toBeLessThanOrEqual(1.1001);
            expect(u.diskRigid.value).toBeGreaterThanOrEqual(0);
            expect(u.diskRigid.value).toBeLessThan(1);
            // Phase A carries weight (1 - mix), phase B carries mix: a jump is only allowed at zero weight.
            if (Math.abs(u.flowA.value - previous.a) > 0.5) {
                resets += 1;
                expect(u.flowMix.value).toBeGreaterThan(0.97);
            }
            if (Math.abs(u.flowB.value - previous.b) > 0.5) {
                resets += 1;
                expect(u.flowMix.value).toBeLessThan(0.03);
            }
            previous = { a: u.flowA.value, b: u.flowB.value };
        }
        expect(resets).toBeGreaterThanOrEqual(6);
    });

    it('spins the gas up with the director and hands the dust a clock that wraps', () => {
        const { world } = create();
        run(world, 0, 5);
        const calm = world.diskTurns;
        world.director.onLineClear({ lineCount: 4 });
        run(world, 5, 10);
        expect(world.diskTurns - calm).toBeGreaterThan(calm * 1.3);
        world.diskTurns = TURN_WRAP + 3.25;
        world.update(10 + STEP, STEP);
        expect(world.matter.uniforms.turns.value).toBeCloseTo(3.25, 1);
    });
});

describe('Black Hole event wiring', () => {
    it('launches a fed piece from where it landed on screen, one cell each way', () => {
        const { world, camera } = create('Low');
        world.setBoardRect(0, {
            left: 0.4, right: 0.6, top: 0.1, bottom: 0.9,
        });
        run(world, 0, 2);
        world.director.onPieceLock({ piece: piece() });
        world.update(2 + STEP, STEP);
        const [infall] = world.director.infalls.filter((entry) => entry.active);
        expect(infall.fresh).toBe(false);
        const data = world.matter.infallData;
        const origin = new THREE.Vector3(data.origin[0].x, data.origin[0].y, data.origin[0].z);
        const projected = onScreen(camera, origin);
        expect(projected.x * 0.5 + 0.5).toBeCloseTo(infall.u, 3);
        expect(0.5 - projected.y * 0.5).toBeCloseTo(infall.v, 3);
        // It leaves from between the camera and the hole.
        const toHole = camera.position.distanceTo(world.hole);
        expect(camera.position.distanceTo(origin)).toBeGreaterThan(toHole * 0.4);
        expect(camera.position.distanceTo(origin)).toBeLessThan(toHole * 0.75);
        // One cell right and one cell down are a cell apart on screen.
        const right = new THREE.Vector3(data.right[0].x, data.right[0].y, data.right[0].z);
        const down = new THREE.Vector3(data.down[0].x, data.down[0].y, data.down[0].z);
        const cellRight = onScreen(camera, origin.clone().add(right));
        const cellDown = onScreen(camera, origin.clone().add(down));
        expect((cellRight.x - projected.x) / 2).toBeCloseTo(infall.cellWidth, 3);
        expect((projected.y - cellDown.y) / 2).toBeCloseTo(infall.cellHeight, 3);
        expect(data.down[0].w).toBe(infall.strength);
        expect(data.land[0].z).toBe(infall.swirl);
        expect(world.matter.infall.visible).toBe(true);

        // The arc is lit where the stream comes down: its start on the disk's clock plus the sweep.
        const start = origin.clone().sub(world.hole).applyMatrix3(world.uniforms.worldToDisk.value);
        expect(infall.landAzimuth).toBeCloseTo(Math.atan2(start.z, start.x) + infall.swirl, 6);
        run(world, 2 + STEP, 2 + infall.duration * 0.75);
        const lit = world.uniforms.hotspot.array.filter((slot) => slot.w > 0);
        expect(lit).toHaveLength(1);
        expect(lit[0].y).toBeCloseTo(infall.landRadius, 0);
        run(world, 2 + infall.duration * 0.75, 4);
        expect(world.matter.infall.visible).toBe(false);
        expect(data.origin[0].w).toBe(-1);
    });

    it('copies waves, ejecta, jets and ripples to the layers that draw them', () => {
        const { world } = create('Low');
        run(world, 0, 1);
        world.director.onPieceLock({ piece: piece() });
        world.director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20] });
        world.update(1 + STEP, STEP);
        const { uniforms, matter, director } = world;
        expect(uniforms.wave.array[0].y).toBeGreaterThan(0);
        expect(uniforms.wave.array[0].x).toBeCloseTo(director.waves[0].radius, 6);
        expect(uniforms.diskHeat.value).toBe(director.diskHeat);
        expect(uniforms.ringGain.value).toBe(director.ringGain);
        expect(matter.jets.visible).toBe(true);
        expect(matter.sparks.visible).toBe(true);
        expect(matter.burstData.clock[0].x).toBeGreaterThanOrEqual(0);
        expect(matter.uniforms.jets.value).toBe(director.jets);
        expect(director.jets).toBeGreaterThan(0);
        // A ripple from the hole is centred on the hole as the camera sees it.
        const fromHole = director.ripples.findIndex((ripple) => ripple.active && ripple.fromHole);
        expect(fromHole).toBeGreaterThanOrEqual(0);
        expect(world.ripples[fromHole].x).toBeCloseTo(world.holeScreen.x, 6);
        expect(world.ripples[fromHole].y).toBeCloseTo(world.holeScreen.y, 6);
        expect(world.holeScreen.x).toBeLessThan(0.4);
        run(world, 1 + STEP, 12);
        expect([matter.jets.visible, matter.sparks.visible]).toEqual([false, false]);
        expect(uniforms.wave.array.every((wave) => wave.y === 0)).toBe(true);
    });

    it('replays the same frame from reset', () => {
        const { world, camera } = create('Low');
        const play = () => {
            world.reset();
            for (let frame = 1; frame <= 240; frame += 1) {
                if (frame === 60) world.director.onPieceLock({ piece: piece() });
                if (frame === 120) {
                    world.director.onPieceLock({ piece: piece({ x: 6 }) });
                    world.director.onLineClear({ lineCount: 2 });
                }
                world.update(frame * STEP, STEP);
            }
            const u = world.uniforms;
            return JSON.stringify([
                camera.position.toArray(), camera.quaternion.toArray(), u.holePosition.value.toArray(),
                u.diskRigid.value, u.flowA.value, u.flowB.value, u.flowMix.value, u.diskHeat.value,
                u.hotspot.array.map((slot) => slot.toArray()), u.wave.array.map((slot) => slot.toArray()),
                world.matter.infallData.origin.map((slot) => slot.toArray()), world.ripples,
            ]);
        };
        const first = play();
        expect(play()).toBe(first);
    });
});

describe('Black Hole dynamic resolution', () => {
    const VSYNC = 1000 / 60;
    /**
     * A display at 60 Hz in front of a device whose frame costs `fixed + fill × scale²` ms.
     * With `gpu`, the fill is also reported as measured render time.
     */
    function drive(controller, seconds, {
        fill, fixed = 2, gpu = false, from = 0,
    }) {
        const scales = [];
        let time = from;
        while (time < from + seconds) {
            const cost = typeof fill === 'function' ? fill(time, controller.scale) : fill * controller.scale ** 2;
            const frame = Math.max(VSYNC, fixed + cost);
            time += frame / 1000;
            if (gpu) controller.noteGpuTime(cost, time);
            if (controller.update(frame / 1000, time)) scales.push(controller.scale);
        }
        return { scales, time };
    }

    it('waits out the warm-up, then sheds pixels under load and never below its floor', () => {
        const controller = new ResolutionController({ minScale: 0.5, targetFps: 60 });
        expect(drive(controller, 2.4, { fill: 30 }).scales).toHaveLength(0);
        expect(controller.scale).toBe(1);
        const loaded = drive(controller, 24, { fill: 30, from: 2.4 });
        expect(loaded.scales.length).toBeGreaterThan(2);
        // 2 + 30 × scale² fits the frame at about 0.7.
        expect(controller.scale).toBeLessThan(0.8);
        expect(controller.scale).toBeGreaterThan(0.6);
        const crushed = new ResolutionController({ minScale: 0.5, targetFps: 60 });
        drive(crushed, 60, { fill: 200 });
        expect(crushed.scale).toBe(0.5);
    });

    it('climbs back on frame time alone once the load is gone', () => {
        // A frame never arrives early, so "on time" has to be reason enough to try a step up.
        const controller = new ResolutionController({ targetFps: 60 });
        const loaded = drive(controller, 26, { fill: 30 });
        expect(controller.scale).toBeLessThan(0.8);
        drive(controller, 60, { fill: 6, from: loaded.time });
        expect(controller.scale).toBe(1);
        expect(controller.usingGpu).toBe(false);
    });

    it('does not pump: it settles on a scale the device can hold and stays there', () => {
        const controller = new ResolutionController({ targetFps: 60 });
        const settled = drive(controller, 40, { fill: 30 });
        const resting = controller.scale;
        const { scales } = drive(controller, 300, { fill: 30, from: settled.time });
        // Five minutes at steady load: at most a probe or two, never a sawtooth.
        expect(scales.length).toBeLessThanOrEqual(3);
        expect(controller.scale).toBeGreaterThanOrEqual(resting - 0.051);
        expect(controller.scale).toBeLessThanOrEqual(resting + 0.101);
        // And the frame it settles on is one the device makes: 2 + 30 × scale² within the late band.
        expect(2 + 30 * controller.scale ** 2).toBeLessThan((1000 / 60) * 1.13);
    });

    it('keeps a scale that just failed off-limits, for longer when the probe fails again', () => {
        // A device that holds 0.84 with room to spare and fails outright at 0.9.
        const cost = (_time, scale) => (scale > 0.86 ? 26 : 6);
        const controller = new ResolutionController({ targetFps: 60 });
        const { scales } = drive(controller, 240, { fill: cost });
        const above = scales.filter((scale) => scale > 0.86);
        // It tried the higher scale again only a few times in four minutes, backing off each time.
        expect(above.length).toBeGreaterThanOrEqual(2);
        expect(above.length).toBeLessThanOrEqual(5);
        expect(controller.probeHold).toBeGreaterThan(20);
        expect(controller.scale).toBeLessThanOrEqual(0.9);
    });

    it('hands the pixels back when shedding them buys nothing', () => {
        // Frames are late whatever the scale: something other than fill is the cost.
        const controller = new ResolutionController({ targetFps: 60 });
        const { scales, time } = drive(controller, 16, { fill: () => 28 });
        expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.84);
        expect(controller.scale).toBe(1);
        // And it does not try again for a good while.
        expect(drive(controller, 15, { fill: () => 28, from: time }).scales).toHaveLength(0);
        // A short stall behaves the same way and leaves nothing behind.
        const stalled = new ResolutionController({ targetFps: 60 });
        const calm = drive(stalled, 6, { fill: 6 });
        const stall = drive(stalled, 4, { fill: () => 28, from: calm.time });
        drive(stalled, 40, { fill: 6, from: stall.time });
        expect(stalled.scale).toBe(1);
    });

    it('reads the browser\'s cadence, not the spacing of the frames its owner chose to draw', () => {
        // A 144 Hz display under a 60 fps cap: the theme draws every second or third animation
        // frame, 14 to 21 ms apart, while the browser is delivering one every 7 ms.
        const controller = new ResolutionController({ targetFps: 60 });
        let time = 0;
        let changes = 0;
        for (let frame = 0; time < 120; frame += 1) {
            const skipped = frame % 5 < 3 ? 3 : 2;
            const delta = skipped / 144;
            time += delta;
            if (controller.update(delta, time, delta / skipped)) changes += 1;
        }
        expect(changes).toBe(0);
        expect(controller.scale).toBe(1);
        // The same spacing with nothing skipped is a device that cannot keep up: it acts.
        const slow = new ResolutionController({ targetFps: 60 });
        time = 0;
        for (let frame = 0; time < 12; frame += 1) {
            const delta = 3 / 144;
            time += delta;
            if (slow.update(delta, time, delta)) changes += 1;
        }
        expect(changes).toBeGreaterThan(0);
    });

    it('is not fooled by a dropped frame now and then', () => {
        // One frame in fifteen takes two refreshes: the mean is on target, only the spikes are late.
        const controller = new ResolutionController({ targetFps: 60 });
        let time = 0;
        let changes = 0;
        for (let frame = 0; time < 180; frame += 1) {
            const delta = (frame % 15 === 14 ? 2 : 1) / 64;
            time += delta;
            if (controller.update(delta, time)) changes += 1;
        }
        expect(changes).toBe(0);
        expect(controller.scale).toBe(1);
    });

    it('does not let one on-time reading launder a step that bought nothing', () => {
        // Late whatever the scale, with a single on-time reading between steps.
        const controller = new ResolutionController({ targetFps: 60 });
        let time = 0;
        const scales = [];
        for (let frame = 0; time < 40; frame += 1) {
            const calm = time > 5.2 && time < 5.9;
            const delta = (calm ? 15 : 21) / 1000;
            time += delta;
            if (controller.update(delta, time)) scales.push(controller.scale);
        }
        expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.84);
        expect(controller.scale).toBe(1);
    });

    it('ignores a single long frame and holds still on target', () => {
        const controller = new ResolutionController({ targetFps: 60 });
        const warm = drive(controller, 3, { fill: 6 });
        expect(controller.update(0.5, warm.time + 0.5)).toBe(false);
        expect(drive(controller, 10, { fill: 6, from: warm.time + 0.5 }).scales).toHaveLength(0);
        expect(controller.scale).toBe(1);
    });

    it('prefers a fresh GPU measurement to the frame delta, and drops a stale one', () => {
        const controller = new ResolutionController({ targetFps: 60 });
        // Frames arrive on time, but the render alone is over its budget of 13.3 ms.
        const measured = drive(controller, 20, { fill: 15, fixed: 0, gpu: true });
        expect(controller.usingGpu).toBe(true);
        expect(controller.scale).toBeLessThan(1);
        expect(controller.scale).toBeGreaterThan(0.8);
        const { scale } = controller;
        // Real headroom on the GPU signal lifts it again.
        const eased = drive(controller, 80, {
            fill: 6, fixed: 0, gpu: true, from: measured.time,
        });
        expect(controller.scale).toBe(1);
        expect(scale).toBeLessThan(1);
        // The samples stop: back to the frame delta.
        drive(controller, 2, { fill: 6, from: eased.time });
        expect(controller.usingGpu).toBe(false);
        controller.noteGpuTime(0, eased.time);
        controller.noteGpuTime(NaN, eased.time);
        expect(controller.getDiagnostics()).toMatchObject({ enabled: true, usingGpu: false, scale: 1 });
    });

    it('does nothing when switched off and tracks the frame-rate target', () => {
        const off = new ResolutionController({ enabled: false });
        expect(drive(off, 20, { fill: 60 }).scales).toHaveLength(0);
        const controller = new ResolutionController({ targetFps: 144 });
        expect(controller.targetMs).toBeCloseTo(1000 / 144, 6);
        controller.setTargetFps(10);
        expect(controller.targetMs).toBeCloseTo(1000 / 30, 6);
        controller.setTargetFps(NaN);
        expect(controller.targetMs).toBeCloseTo(1000 / 60, 6);
        controller.scale = 0.7;
        controller.reset();
        expect(controller.scale).toBe(1);
    });
});

describe('Black Hole board rectangles', () => {
    const rect = (left, right, top = 90, bottom = 810) => ({
        left, right, top, bottom, width: right - left, height: bottom - top,
    });
    const card = (player, box, visible = true) => ({
        getAttribute: () => player,
        checkVisibility: () => visible,
        querySelector: () => ({ getBoundingClientRect: () => box }),
    });
    const read = (cards) => readBoardRects({ querySelectorAll: () => cards }, { innerWidth: 1000, innerHeight: 900 });

    it('reports the solo board as slot 0, in viewport fractions', () => {
        expect(read([card('solo', rect(400, 600))])).toEqual([{
            slot: 0, left: 0.4, right: 0.6, top: 0.1, bottom: 0.9,
        }]);
    });

    it('gives each multiplayer board its slot and slot 0 the rectangle covering them', () => {
        expect(read([card('1', rect(100, 300, 90, 450)), card('2', rect(700, 900, 180, 810))])).toEqual([
            {
                slot: 0, left: 0.1, right: 0.9, top: 0.1, bottom: 0.9,
            },
            {
                slot: 1, left: 0.1, right: 0.3, top: 0.1, bottom: 0.5,
            },
            {
                slot: 2, left: 0.7, right: 0.9, top: 0.2, bottom: 0.9,
            },
        ]);
    });

    it('ignores hidden, collapsed, off-screen and unknown boards', () => {
        expect(read([
            card('1', rect(100, 300), false),
            card('2', rect(100, 110)),
            card('3', rect(1200, 1500)),
            card('lobby', rect(100, 300)),
            card('9', rect(100, 300)),
        ])).toEqual([]);
        expect(readBoardRects(null, null)).toEqual([]);
        expect(readBoardRects({ querySelectorAll: () => [] }, { innerWidth: 0, innerHeight: 0 })).toEqual([]);
    });
});
