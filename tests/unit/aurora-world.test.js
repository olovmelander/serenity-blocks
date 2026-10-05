import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import {
    SHORE_Z, bakeRidgeProfile, bankHeight, rangeHeight,
} from '../../src/themes/aurora/aurora-landscape.js';
import { bakeAuroraNoise, createRandom } from '../../src/themes/aurora/aurora-noise.js';
import {
    QUALITY_PRESETS, normalizeAuroraQuality, resolveAuroraQuality,
} from '../../src/themes/aurora/aurora-quality.js';
import { buildStarCatalogue } from '../../src/themes/aurora/aurora-sky.js';
import { AURORA_SEED, AuroraWorld } from '../../src/themes/aurora/aurora-world.js';

const TIERS = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const worlds = [];
/** The landscape seed the world derives from the artwork seed. */
const RANGE_SEED = AURORA_SEED % 9973;

function create(quality = 'Low', aspect = 16 / 9) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, aspect, 0.5, 12000);
    const world = new AuroraWorld({ scene, camera, quality });
    worlds.push(world);
    return { world, scene, camera };
}

function resources(scene) {
    const geometries = new Set();
    const materials = new Set();
    let objects = 0;
    scene.traverse((object) => {
        objects += 1;
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
    });
    return { objects, geometries: geometries.size, materials: materials.size };
}

/** Highest elevation of the range, in degrees, along one view azimuth from the eye. */
function skyline(azimuthDegrees, seed = RANGE_SEED) {
    const azimuth = (azimuthDegrees * Math.PI) / 180;
    let best = -90;
    for (let reach = -SHORE_Z; reach < 3300; reach += 24) {
        const height = rangeHeight(Math.sin(azimuth) * reach, -Math.cos(azimuth) * reach, seed);
        best = Math.max(best, (Math.atan2(height - 8, reach) * 180) / Math.PI);
    }
    return best;
}

afterEach(() => {
    for (const world of worlds) world.dispose();
    worlds.length = 0;
});

describe('Aurora quality tiers', () => {
    it('scales every budget down the tiers and keeps the whole picture on each', () => {
        for (let i = 1; i < TIERS.length; i += 1) {
            const above = QUALITY_PRESETS[TIERS[i - 1]];
            const below = QUALITY_PRESETS[TIERS[i]];
            for (const key of ['arcCount', 'marchSteps', 'curtainScale', 'curtainHz', 'starCount', 'terrainColumns',
                'terrainRows', 'treeCount', 'meteorSlots', 'rippleSlots', 'mirrorScale', 'bloomScale', 'pixelRatio']) {
                expect(below[key], `${TIERS[i]}.${key}`).toBeLessThanOrEqual(above[key]);
            }
            expect(below.arcCount).toBeGreaterThanOrEqual(2);
            expect(below.rippleSlots).toBeGreaterThanOrEqual(3);
            expect(below.meteorSlots).toBeGreaterThanOrEqual(2);
        }
        for (const tier of ['Low', 'Minimal']) {
            expect(QUALITY_PRESETS[tier]).toMatchObject({ enablePost: false, mirrorScale: 0, hdrCurtains: false });
        }
        expect(Object.isFrozen(QUALITY_PRESETS) && Object.isFrozen(QUALITY_PRESETS.High)).toBe(true);
    });

    it('accepts the legacy label for the cheapest tier and falls back to High', () => {
        expect(normalizeAuroraQuality('Minimum')).toBe('Minimal');
        expect(normalizeAuroraQuality(' minimum ')).toBe('Minimal');
        expect(normalizeAuroraQuality('ultra')).toBe('Ultra');
        expect(normalizeAuroraQuality(undefined)).toBe('High');
        expect(normalizeAuroraQuality('Custom')).toBe('High');
        expect(resolveAuroraQuality('Low')).toEqual({ name: 'Low', preset: QUALITY_PRESETS.Low });
    });
});

describe('Aurora landscape bakes', () => {
    it('raises two framing massifs and keeps the saddle behind the board low', () => {
        const centre = Math.max(skyline(-4), skyline(0), skyline(4));
        const left = Math.max(skyline(-36), skyline(-32), skyline(-28));
        const right = Math.max(skyline(28), skyline(32), skyline(36));
        expect(left).toBeGreaterThan(centre + 4);
        expect(right).toBeGreaterThan(centre + 4);
        expect(centre).toBeGreaterThan(1);
        expect(Math.max(left, right)).toBeLessThan(20);
        expect(rangeHeight(0, SHORE_Z + 10)).toBeLessThan(0);
        expect(rangeHeight(300, SHORE_Z - 5)).toBeLessThan(2);
    });

    it('leaves a channel of open water between the two snow banks', () => {
        for (const z of [-10, -40, -90, -150]) {
            expect(bankHeight(0, z)).toBeLessThan(0);
            expect(bankHeight(4, z)).toBeLessThan(0);
        }
        expect(bankHeight(-70, -30)).toBeGreaterThan(1);
        expect(bankHeight(70, -30)).toBeGreaterThan(1);
        expect(bankHeight(-70, -400)).toBeLessThan(0);
    });

    it('bakes a skyline profile that rises under a peak and stays zero under water', () => {
        const positions = new Float32Array([0, 300, -1500, 900, -5, -1500, -900, 120, -1500]);
        const profile = bakeRidgeProfile(positions, 8);
        const bin = (azimuth) => Math.round((azimuth / Math.PI + 0.5) * 511) * 4;
        expect(profile[bin(0)]).toBeGreaterThan(profile[bin(Math.atan2(-900, 1500))]);
        expect(profile[bin(Math.atan2(-900, 1500))]).toBeGreaterThan(0);
        expect(profile[bin(Math.atan2(900, 1500))]).toBe(0);
    });

    it('bakes a tileable, full-range noise tile and a repeatable star catalogue', () => {
        const noise = bakeAuroraNoise(32, 7);
        expect(noise).toHaveLength(32 * 32 * 4);
        expect(Array.from(noise)).toEqual(Array.from(bakeAuroraNoise(32, 7)));
        for (let channel = 0; channel < 4; channel += 1) {
            const values = Array.from({ length: 32 * 32 }, (_, i) => noise[i * 4 + channel]);
            expect(Math.min(...values)).toBe(0);
            expect(Math.max(...values)).toBe(255);
        }
        const stars = buildStarCatalogue(600, createRandom(3));
        const again = buildStarCatalogue(600, createRandom(3));
        expect(stars.count).toBe(600);
        expect(Array.from(stars.directions)).toEqual(Array.from(again.directions));
        for (let i = 0; i < stars.count; i += 1) {
            const [x, y, z] = stars.directions.subarray(i * 3, i * 3 + 3);
            expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
            expect(y).toBeGreaterThan(-0.06);
            expect(z).toBeLessThan(0.2);
        }
    });
});

describe('Aurora world', () => {
    it.each(TIERS)('builds the whole scene at %s from its preset', (tier) => {
        const { world, scene } = create(tier);
        const report = world.getDiagnostics();
        const preset = QUALITY_PRESETS[tier];
        expect(report.quality).toBe(tier);
        expect(report.curtains.arcs).toHaveLength(preset.arcCount + 1);
        expect(report.curtains.arcs.at(-1)).toBe('corona');
        expect(report.curtains.marchSteps).toBe(preset.marchSteps);
        expect(report.curtains.hdr).toBe(preset.hdrCurtains);
        expect(report.sky.stars).toBe(preset.starCount);
        expect(report.landscape.mirror).toBe(preset.mirrorScale > 0 ? preset.mirrorScale : 'analytic');
        expect(report.landscape.terrain).toEqual([preset.terrainColumns, preset.terrainRows]);
        const names = [];
        scene.traverse((object) => { if (object.name) names.push(object.name); });
        for (const part of ['sky dome', 'star catalogue', 'meteor pool', 'snow range', 'snow banks', 'spruces', 'mirror lake']) {
            expect(names.some((name) => name.includes(part)), part).toBe(true);
        }
    });

    it('creates nothing at event time: a storm reuses every object, geometry and material', () => {
        const { world, scene } = create('Low');
        world.setViewport(1280, 720);
        const before = resources(scene);
        const ripples = world.landscape.rippleData.slice();
        const meteors = world.sky.meteorStart.slice();
        for (let i = 0; i < 400; i += 1) {
            const { director } = world;
            director.onHardDrop({ distance: i % 18 });
            director.onPieceLock({
                piece: {
                    x: i % 10, y: 18, shape: [[1, 1]], color: '#ff88ee',
                },
            });
            if (i % 2 === 0) director.onLineClear({ lineCount: 1 + (i % 4), clearedRows: [23] });
            if (i % 9 === 0) director.onPerfectClear({});
            world.update((i + 1) / 60, 1 / 60, { x: 0.2, y: -0.1 });
        }
        expect(resources(scene)).toEqual(before);
        world.landscape.rippleData.forEach((slot, i) => expect(slot).toBe(ripples[i]));
        world.sky.meteorStart.forEach((slot, i) => expect(slot).toBe(meteors[i]));
        expect(world.landscape.rippleData.some((slot) => slot.w > 0)).toBe(true);
        expect(world.sky.meteorStart.some((slot) => slot.w > 0)).toBe(true);
        const { uniforms } = world.curtains;
        expect([uniforms.height.value, uniforms.sway.value, uniforms.crown.value, uniforms.fringe.value,
            uniforms.tau.value, uniforms.rayPhase.value].every(Number.isFinite)).toBe(true);
        expect(uniforms.arcGain.array.at(-1)).toBeGreaterThan(0);
        expect(world.uniforms.auroraLight.value.toArray().every((value) => value > 0 && value < 1)).toBe(true);
    });

    it('rewinds every stateful layer on reset', () => {
        const { world } = create('Minimal');
        world.director.onPieceLock({ piece: { x: 4, shape: [[1]], color: '#6cf5ff' } });
        world.director.onLineClear({ lineCount: 4 });
        world.update(0.5, 0.05);
        world.reset();
        expect(world.director.activity).toBe(0);
        expect(world.landscape.rippleData.every((slot) => slot.w === 0 && slot.z === -1000)).toBe(true);
        expect(world.sky.meteorStart.every((slot) => slot.w === -100)).toBe(true);
        expect(world.curtains.uniforms.surge.value).toBe(0);
    });

    it('frames landscape and portrait differently and maps board spans to view azimuth', () => {
        const { world, camera } = create('Minimal', 16 / 9);
        const landscapePitch = world.pitch;
        expect(camera.fov).toBe(55);
        world.setBoardSpan(0, 0.4, 0.6);
        expect(world.director.boards[0].azimuth).toBeCloseTo(0, 9);
        expect(world.director.boards[0].halfWidth).toBeGreaterThan(0.1);
        world.setBoardSpan(1, 0.05, 0.25);
        expect(world.director.boards[1].azimuth).toBeLessThan(-0.3);
        const untouched = { ...world.director.boards[1] };
        world.setBoardSpan(1, 0.6, 0.2);
        world.setBoardSpan(1, NaN, 0.2);
        expect(world.director.boards[1].azimuth).toBe(untouched.azimuth);

        world.prepareCamera(390 / 844);
        expect(camera.fov).toBe(68);
        expect(world.pitch).toBeGreaterThan(landscapePitch);
        expect(camera.far).toBeGreaterThan(9500);
        expect(world.director.boards[0].halfWidth).toBeGreaterThan(0.2);
    });

    it('holds the camera still under reduced motion', () => {
        const { world, camera } = create('Minimal');
        world.setReducedMotion(true);
        world.update(1, 1 / 60, { x: 1, y: 1 });
        const rest = camera.position.clone();
        for (let i = 0; i < 120; i += 1) world.update(1 + i / 60, 1 / 60, { x: 1, y: -1 });
        expect(camera.position.distanceTo(rest)).toBeLessThan(1e-9);
        expect(world.director.reducedMotion).toBe(true);
    });

    it('sizes the curtain buffer from the tier and refreshes it at the tier cadence', () => {
        const { world } = create('Low');
        world.setViewport(1000, 500);
        expect(world.curtains.renderTarget.width).toBe(Math.round(1000 * QUALITY_PRESETS.Low.curtainScale));
        expect(world.curtains.renderTarget.height).toBe(Math.round(500 * QUALITY_PRESETS.Low.curtainScale));
        expect(world.curtains.due(0)).toBe(true);
        world.curtains.lastRefresh = 1;
        expect(world.curtains.due(1.01)).toBe(false);
        expect(world.curtains.due(1 + 1 / QUALITY_PRESETS.Low.curtainHz)).toBe(true);
        // A rewound clock must never leave the buffer waiting for the old time.
        expect(world.curtains.due(0.2)).toBe(true);
    });

    it('disposes once, leaves the scene empty and goes inert', () => {
        const { world, scene } = create('Low');
        const { curtains, landscape, sky } = world;
        world.dispose();
        world.dispose();
        expect(scene.children).toHaveLength(0);
        expect(curtains.disposed && landscape.disposed && sky.disposed).toBe(true);
        expect(() => {
            world.update(3, 1 / 60);
            world.reset();
            world.renderBuffers({});
        }).not.toThrow();
        expect(landscape.ripple(1, 0, 0, 1, [1, 1, 1])).toBe(false);
        expect(sky.launchMeteor(1, [0, 1, 0], [1, 0, 0])).toBe(false);
        expect(() => new AuroraWorld({})).toThrow(TypeError);
    });
});
