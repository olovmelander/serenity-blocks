import {
    afterAll, afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { float, vec2, vec3 } from 'three/tsl';
import {
    VERDANT_HILLS_VIEWS, verdantHillsGaze, verdantHillsViewFor,
} from '../../src/themes/verdant-hills/verdant-hills-composition.js';
import {
    VERDANT_HILLS_CLOUD_BASE, VERDANT_HILLS_CLOUD_SCHEMA, VERDANT_HILLS_CLOUD_SEED, VERDANT_HILLS_CLOUD_SIZE,
    VERDANT_HILLS_CLOUD_TILE, VERDANT_HILLS_CLOUD_TOP, VERDANT_HILLS_SUN_AZIMUTH_DEGREES,
    VERDANT_HILLS_SUN_DIRECTION, VERDANT_HILLS_SUN_ELEVATION_DEGREES, VERDANT_HILLS_WAVE_SPEED,
    VERDANT_HILLS_WIND_DIRECTION, VerdantHillsLight, createVerdantHillsCloudData, prepareVerdantHillsClouds,
} from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import { VerdantHillsRings } from '../../src/themes/verdant-hills/verdant-hills-rings.js';
import { VERDANT_HILLS_CROWN } from '../../src/themes/verdant-hills/verdant-hills-terrain.js';

// Every rig makes its own noise, and its own cloud field when it is handed none: a moment each,
// longer on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const STEP = 1 / 60;
const { degToRad, radToDeg } = THREE.MathUtils;
const owned = [];
function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

let pack = null;

/** The cloud field as the asset loader hands it over: the theme's own, made once for every test. */
function bakedClouds() {
    if (!pack) {
        const size = VERDANT_HILLS_CLOUD_SIZE;
        const { data, edges } = createVerdantHillsCloudData(VERDANT_HILLS_CLOUD_SEED, size);
        pack = { texture: prepareVerdantHillsClouds(new THREE.DataTexture(data, size, size, THREE.RGBAFormat)), edges };
    }
    return pack;
}

/** A rig as the world builds it with its assets loaded; pass `clouds: null` for one that makes its own field. */
function createLight(quality = 'Minimal', seed = 5, clouds = bakedClouds()) {
    const light = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS[quality], rng: seededRandom(seed), clouds });
    owned.push(light);
    return light;
}

/** The share of a cloud field's texels that stand higher than a threshold. */
function shareAbove(data, edge) {
    let above = 0;
    for (let offset = 0; offset < data.length; offset += 4) if (data[offset] / 255 > edge) above += 1;
    return above / (data.length / 4);
}

/** A calm frame, as the reactions give it when nothing is happening. */
const CALM = Object.freeze({
    wind: 0, gust: 0, warmth: 0, glow: 0, shimmer: 0, settled: false,
});

/** The wind's bearing over the ground, as a unit vector (x, z). */
const WINDWARD = new THREE.Vector2(VERDANT_HILLS_WIND_DIRECTION.x, VERDANT_HILLS_WIND_DIRECTION.z).normalize();

/** Let the wind dial settle on a frame. */
function settle(light, frame, frames = 400) {
    for (let count = 0; count < frames; count++) light.update(count * STEP, frame);
}

afterEach(() => {
    owned.splice(0).forEach((light) => light.dispose());
});

afterAll(() => {
    pack?.texture.dispose();
});

describe('Verdant Hills sun and wind', () => {
    it('puts the sun above the horizon, ahead of the lens and to its right', () => {
        expect(Object.isFrozen(VERDANT_HILLS_SUN_DIRECTION)).toBe(true);
        expect(VERDANT_HILLS_SUN_DIRECTION.length()).toBeCloseTo(1, 12);
        expect(VERDANT_HILLS_SUN_DIRECTION.y).toBeGreaterThan(0.2);
        expect(VERDANT_HILLS_SUN_DIRECTION.z).toBeLessThan(0);
        expect(VERDANT_HILLS_SUN_DIRECTION.x).toBeGreaterThan(0);
        // It is the azimuth and elevation it says it is, in degrees, measured as the views are.
        const { x, y, z } = VERDANT_HILLS_SUN_DIRECTION;
        expect(radToDeg(Math.asin(y))).toBeCloseTo(VERDANT_HILLS_SUN_ELEVATION_DEGREES, 9);
        expect(radToDeg(Math.atan2(x, -z))).toBeCloseTo(VERDANT_HILLS_SUN_AZIMUTH_DEGREES, 9);
        // A sun of the middle of the day, not of the evening, and not straight overhead.
        expect(VERDANT_HILLS_SUN_ELEVATION_DEGREES).toBeGreaterThan(15);
        expect(VERDANT_HILLS_SUN_ELEVATION_DEGREES).toBeLessThan(75);
    });

    it('keeps the sun out of the top of the landscape frame, so its glare is not in the picture', () => {
        const view = verdantHillsViewFor(16 / 9);
        expect(view).toBe(VERDANT_HILLS_VIEWS.landscape);
        const gaze = verdantHillsGaze(view);
        expect(VERDANT_HILLS_SUN_DIRECTION.dot(new THREE.Vector3(...gaze))).toBeGreaterThan(0);
        // Higher than the top edge of the frame.
        expect(VERDANT_HILLS_SUN_ELEVATION_DEGREES).toBeGreaterThan(view.pitch + view.fov / 2);
    });

    it('blows out over the valley, level, away from the lens and to the right', () => {
        expect(Object.isFrozen(VERDANT_HILLS_WIND_DIRECTION)).toBe(true);
        expect(VERDANT_HILLS_WIND_DIRECTION.length()).toBeCloseTo(1, 4);
        expect(VERDANT_HILLS_WIND_DIRECTION.y).toBe(0);
        expect(VERDANT_HILLS_WIND_DIRECTION.z).toBeLessThan(-0.3);
        expect(VERDANT_HILLS_WIND_DIRECTION.x).toBeGreaterThan(0.1);
        // Gusts cross the grass at a brisk walk to a gallop, and the clouds stand over the hills.
        expect(VERDANT_HILLS_WAVE_SPEED).toBeGreaterThan(2);
        expect(VERDANT_HILLS_WAVE_SPEED).toBeLessThan(40);
        expect(VERDANT_HILLS_CLOUD_BASE).toBeGreaterThan(VERDANT_HILLS_CROWN + 300);
        expect(VERDANT_HILLS_CLOUD_TOP).toBeGreaterThan(VERDANT_HILLS_CLOUD_BASE + 200);
        expect(VERDANT_HILLS_CLOUD_TILE).toBeGreaterThan(2000);
    });
});

describe('Verdant Hills cloud field', () => {
    const SIZE = 96;
    const field = createVerdantHillsCloudData(7, SIZE);

    it('fills three channels of a square, opaque field and a table of 256 edges', () => {
        expect(field.data).toBeInstanceOf(Uint8Array);
        expect(field.data).toHaveLength(SIZE * SIZE * 4);
        expect(field.edges).toBeInstanceOf(Float32Array);
        expect(field.edges).toHaveLength(256);
        // Opaque throughout, so the baked copy decodes like any picture: nothing can premultiply it away.
        for (let offset = 3; offset < field.data.length; offset += 4) {
            if (field.data[offset] !== 255) throw new Error(`texel ${(offset - 3) / 4} is not opaque`);
        }
        for (let channel = 0; channel < 3; channel++) {
            let low = 255;
            let high = 0;
            for (let offset = channel; offset < field.data.length; offset += 4) {
                low = Math.min(low, field.data[offset]);
                high = Math.max(high, field.data[offset]);
            }
            // Every channel carries a picture, not a flat value.
            expect(high - low, `channel ${channel}`).toBeGreaterThan(100);
            expect(low).toBeGreaterThanOrEqual(0);
            expect(high).toBeLessThanOrEqual(255);
        }
        // The heaps reach the top of their channel and leave clear sky between them.
        expect(shareAbove(field.data, 0.99)).toBeGreaterThan(0);
        expect(shareAbove(field.data, 0.99)).toBeLessThan(0.05);
        expect(1 - shareAbove(field.data, 0)).toBeGreaterThan(0.02);
    });

    it('is the same field for the same seed and another for another', () => {
        const again = createVerdantHillsCloudData(7, SIZE);
        expect(Array.from(again.data)).toEqual(Array.from(field.data));
        expect(Array.from(again.edges)).toEqual(Array.from(field.edges));
        const other = createVerdantHillsCloudData(8, SIZE);
        let differing = 0;
        for (let offset = 0; offset < other.data.length; offset += 4) {
            if (other.data[offset] !== field.data[offset]) differing += 1;
        }
        expect(differing).toBeGreaterThan(SIZE * SIZE * 0.5);
        // It builds at the size it is asked for, and at its own by default.
        expect(createVerdantHillsCloudData(3, 16).data).toHaveLength(16 * 16 * 4);
        const plain = createVerdantHillsCloudData();
        expect(plain.data).toHaveLength(VERDANT_HILLS_CLOUD_SIZE * VERDANT_HILLS_CLOUD_SIZE * 4);
    });

    it('names the field the theme ships: its seed, its size and the version of its encoding', () => {
        expect(Number.isInteger(VERDANT_HILLS_CLOUD_SEED)).toBe(true);
        expect(Number.isInteger(VERDANT_HILLS_CLOUD_SIZE)).toBe(true);
        // A power of two, so it tiles and mip-maps cleanly on both backends.
        expect(Math.log2(VERDANT_HILLS_CLOUD_SIZE) % 1).toBe(0);
        expect(VERDANT_HILLS_CLOUD_SIZE).toBeGreaterThanOrEqual(128);
        expect(Number.isInteger(VERDANT_HILLS_CLOUD_SCHEMA)).toBe(true);
        expect(VERDANT_HILLS_CLOUD_SCHEMA).toBeGreaterThan(0);
    });

    it('prepares a field to be sampled as tiling, linear, mip-mapped data, baked or not', () => {
        const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4, THREE.RGBAFormat);
        texture.flipY = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        const { version } = texture;
        expect(prepareVerdantHillsClouds(texture)).toBe(texture);
        expect(texture.wrapS).toBe(THREE.RepeatWrapping);
        expect(texture.wrapT).toBe(THREE.RepeatWrapping);
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
        // Row 0 of the data is v = 0: the field and its shadow must not be mirrored against each other.
        expect(texture.flipY).toBe(false);
        expect(texture.magFilter).toBe(THREE.LinearFilter);
        expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(texture.generateMipmaps).toBe(true);
        expect(texture.version).toBeGreaterThan(version);
        texture.dispose();
    });

    it('tiles: the field wraps without a seam', () => {
        // Neighbours across the edge differ no more than neighbours inside the field do.
        const at = (x, y) => field.data[(((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)) * 4];
        let inside = 0;
        let across = 0;
        for (let line = 0; line < SIZE; line++) {
            for (let step = 1; step < SIZE; step++) {
                inside = Math.max(inside, Math.abs(at(step, line) - at(step - 1, line)));
            }
            across = Math.max(across, Math.abs(at(0, line) - at(-1, line)), Math.abs(at(line, 0) - at(line, -1)));
        }
        expect(across).toBeLessThanOrEqual(inside);
    });

    it('lists its edges in rising order from clear sky to the highest heap', () => {
        for (let index = 0; index < 256; index++) {
            expect(field.edges[index]).toBeGreaterThanOrEqual(0);
            expect(field.edges[index]).toBeLessThanOrEqual(1);
            if (index > 0) expect(field.edges[index]).toBeGreaterThanOrEqual(field.edges[index - 1]);
        }
        expect(field.edges[0]).toBe(0);
        expect(field.edges[255]).toBeGreaterThan(0.9);
    });

    it.each([7, 38, 2011])('finds the threshold that leaves a given share of the sky under cloud (seed %i)', (seed) => {
        const { data, edges } = createVerdantHillsCloudData(seed, 128);
        // No threshold can cloud the sky the heaps never reach.
        const reachable = shareAbove(data, 0);
        expect(reachable).toBeGreaterThan(0.6);
        let previous = 0;
        for (const cover of [0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
            const share = shareAbove(data, edges[Math.round((1 - cover) * 255)]);
            expect(share, `cover ${cover}`).toBeLessThan(cover + 0.03);
            expect(share, `cover ${cover}`).toBeGreaterThan(Math.min(cover, reachable) - 0.03);
            // More cover asked for is never less cover given.
            expect(share).toBeGreaterThanOrEqual(previous);
            previous = share;
        }
    });
});

describe('Verdant Hills light rig', () => {
    describe('construction', () => {
        it('builds without a renderer: uniforms, a sun that casts, and two textures of its own', () => {
            const light = createLight('Minimal', 5, null);
            expect(light.tier).toBe(VERDANT_HILLS_TIERS.Minimal);
            expect(light.sun.isDirectionalLight).toBe(true);
            expect(light.sun.castShadow).toBe(true);
            expect(light.sun.shadow.mapSize.toArray()).toEqual(VERDANT_HILLS_TIERS.Minimal.shadowMap);
            // Drawn once: nothing that casts moves under a fixed sun.
            expect(light.sun.shadow.autoUpdate).toBe(false);
            expect(light.shadowNode).toBeTruthy();
            for (const texture of [light.noiseTexture, light.cloudTexture]) {
                expect(texture.isDataTexture).toBe(true);
                expect(texture.wrapS).toBe(THREE.RepeatWrapping);
                expect(texture.wrapT).toBe(THREE.RepeatWrapping);
                expect(texture.colorSpace).toBe(THREE.NoColorSpace);
                expect(texture.image.data).toHaveLength(texture.image.width * texture.image.height * 4);
            }
            expect(light.ownsClouds).toBe(true);
            expect(light.cloudTexture.flipY).toBe(false);
            expect(light.cloudEdges).toBeInstanceOf(Float32Array);
            expect(light.cloudEdges).toHaveLength(256);
            // The uniforms hold copies: the shared constants cannot be moved through them.
            expect(light.uSunDir.value).not.toBe(VERDANT_HILLS_SUN_DIRECTION);
            expect(light.uSunDir.value.toArray()).toEqual(VERDANT_HILLS_SUN_DIRECTION.toArray());
            expect(light.uWindDir.value).not.toBe(VERDANT_HILLS_WIND_DIRECTION);
            expect(light.uWindDir.value.toArray()).toEqual(VERDANT_HILLS_WIND_DIRECTION.toArray());
        });

        it('starts every gameplay envelope at rest', () => {
            const light = createLight();
            for (const name of ['uTime', 'uGust', 'uWindClock', 'uWarmth', 'uGlow', 'uShimmer']) {
                expect(light[name].value, name).toBe(0);
            }
            // The front and the pool of sunlight have a place and a width but no strength.
            expect(light.uFront.value).toBeInstanceOf(THREE.Vector4);
            expect(light.uFront.value.y).toBe(0);
            expect(light.uFront.value.z).toBeGreaterThan(0);
            expect(light.uSunPool.value).toBeInstanceOf(THREE.Vector4);
            expect(light.uSunPool.value.w).toBe(0);
            expect(light.uSunPool.value.z).toBeGreaterThan(0);
            // A breeze is always blowing.
            expect(light.uWind.value).toBeGreaterThan(0);
            expect(light.uWind.value).toBeLessThan(1);
        });

        it('hands the grass a pool of gusts that is all zero: four components each, not a default vector', () => {
            // One tier for each size of pool the table asks for.
            const sizes = new Map(Object.entries(VERDANT_HILLS_TIERS).map(([quality, tier]) => [tier.waves, quality]));
            expect(sizes.size).toBeGreaterThan(0);
            for (const quality of sizes.values()) {
                const light = createLight(quality);
                expect(light.waves).toBeInstanceOf(VerdantHillsRings);
                expect(light.waves.count).toBe(VERDANT_HILLS_TIERS[quality].waves);
                expect(light.waves.active()).toBe(0);
                // The shader reads the pool's own vectors.
                expect(light.uWaves.array).toBe(light.waves.rings);
                expect(light.uWaves.array).toHaveLength(light.waves.count);
                for (const ring of light.uWaves.array) {
                    expect(ring).toBeInstanceOf(THREE.Vector4);
                    expect(ring.toArray()).toEqual([0, 0, 0, 0]);
                }
            }
        });

        it('draws one seed from its random source, for the grain of everything but the clouds', () => {
            let calls = 0;
            const clouds = bakedClouds();
            const light = new VerdantHillsLight({
                tier: VERDANT_HILLS_TIERS.Minimal,
                clouds,
                rng: () => {
                    calls += 1;
                    return 0.42;
                },
            });
            owned.push(light);
            // One draw, so the rest of the world keeps its place in the stream.
            expect(calls).toBe(1);
            const grain = (rig) => Array.from(rig.noiseTexture.image.data.subarray(0, 4000));
            const twin = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS.Minimal, rng: () => 0.42, clouds });
            owned.push(twin);
            expect(grain(twin)).toEqual(grain(light));
            const other = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS.Minimal, rng: () => 0.77, clouds });
            owned.push(other);
            expect(grain(other)).not.toEqual(grain(light));
        });

        it('makes the same clouds every day, whatever the generator: the field of the theme\'s own seed', () => {
            const first = createLight('Minimal', 5, null);
            const second = createLight('Minimal', 977, null);
            const { data, edges } = createVerdantHillsCloudData(VERDANT_HILLS_CLOUD_SEED, VERDANT_HILLS_CLOUD_SIZE);
            for (const light of [first, second]) {
                expect(light.ownsClouds).toBe(true);
                expect(light.cloudTexture.image.width).toBe(VERDANT_HILLS_CLOUD_SIZE);
                expect(light.cloudTexture.image.height).toBe(VERDANT_HILLS_CLOUD_SIZE);
                expect(Buffer.from(light.cloudTexture.image.data).equals(Buffer.from(data))).toBe(true);
                expect(Array.from(light.cloudEdges)).toEqual(Array.from(edges));
            }
            // Each rig's field is its own to release.
            expect(first.cloudTexture).not.toBe(second.cloudTexture);
            // The grain of the grass and the bark still follows the generator.
            expect(Array.from(first.noiseTexture.image.data.subarray(0, 4000)))
                .not.toEqual(Array.from(second.noiseTexture.image.data.subarray(0, 4000)));
        });

        it('uses a baked cloud field it is handed, and leaves it to the pack it came from', () => {
            const clouds = bakedClouds();
            const released = [];
            const listener = () => released.push('clouds');
            clouds.texture.addEventListener('dispose', listener);
            const light = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS.Minimal, rng: seededRandom(5), clouds });
            expect(light.ownsClouds).toBe(false);
            expect(light.cloudTexture).toBe(clouds.texture);
            expect(light.cloudEdges).toBe(clouds.edges);
            light.noiseTexture.addEventListener('dispose', () => released.push('noise'));
            light.dispose();
            // The asset pack outlives a rebuild of the world.
            expect(released).toEqual(['noise']);
            clouds.texture.removeEventListener('dispose', listener);
        });

        it('reads its thresholds from the level table that came with the field', () => {
            // A table of its own: level i for the i-th 255th of the sky.
            const edges = Float32Array.from({ length: 256 }, (_, index) => index / 255);
            const { texture } = bakedClouds();
            const light = new VerdantHillsLight({
                tier: VERDANT_HILLS_TIERS.Minimal, rng: seededRandom(5), clouds: { texture, edges },
            });
            owned.push(light);
            for (const cover of [0.1, 0.4, 0.8]) {
                light.setCloudCover(cover);
                expect(light.uCloudEdge.value).toBe(edges[Math.round((1 - cover) * 255)]);
            }
        });

        it('makes a field of its own when what it is handed is not a whole one', () => {
            const { texture, edges } = bakedClouds();
            for (const clouds of [undefined, null, {}, { texture }, { edges }, { texture, edges: [0, 0.5, 1] },
                { texture: null, edges }, { texture, edges: null }]) {
                const tier = VERDANT_HILLS_TIERS.Minimal;
                const light = new VerdantHillsLight({ tier, rng: seededRandom(5), clouds });
                owned.push(light);
                expect(light.ownsClouds, JSON.stringify(clouds && Object.keys(clouds))).toBe(true);
                expect(light.cloudTexture).not.toBe(texture);
                expect(light.cloudTexture.isDataTexture).toBe(true);
                expect(light.cloudEdges).toHaveLength(256);
                expect(Number.isFinite(light.uCloudEdge.value)).toBe(true);
            }
        });

        it('warms the haze toward the sun by itself where the tier has no shafts to do it', () => {
            const plain = createLight('Minimal');
            const shafted = createLight('High');
            expect(VERDANT_HILLS_TIERS.Minimal.shafts).toBe(0);
            expect(VERDANT_HILLS_TIERS.High.shafts).toBeGreaterThan(0);
            expect(plain.uHazeSun.value).toBeGreaterThan(shafted.uHazeSun.value);
            // A coarser shadow map is given more bias.
            expect(Math.abs(plain.sun.shadow.bias)).toBeGreaterThan(Math.abs(shafted.sun.shadow.bias));
            expect(plain.sun.shadow.bias).toBeLessThan(0);
        });

        it('joins a group with its sun and the sun\'s target, and aims the shadow box at the home hill', () => {
            const light = createLight();
            const group = new THREE.Group();
            light.addTo(group);
            expect(group.children).toEqual([light.sun, light.sun.target]);
            light.shadowFrames = 99;
            light.sun.shadow.needsUpdate = false;
            light.frameShadows();
            // The light stands off the hill along the sun's own direction and looks back at it.
            const toSun = light.sun.position.clone().sub(light.sun.target.position);
            expect(toSun.length()).toBeGreaterThan(50);
            expect(toSun.normalize().dot(VERDANT_HILLS_SUN_DIRECTION)).toBeCloseTo(1, 9);
            expect(light.sun.target.position.y).toBeGreaterThan(VERDANT_HILLS_CROWN - 15);
            expect(light.sun.target.position.y).toBeLessThan(VERDANT_HILLS_CROWN + 15);
            const { camera } = light.sun.shadow;
            expect(camera.right).toBe(-camera.left);
            expect(camera.top).toBe(-camera.bottom);
            expect(camera.right).toBeGreaterThan(20);
            expect(camera.far).toBeGreaterThan(toSun.length());
            // The map is asked for again, and the count of early redraws starts over.
            expect(light.sun.shadow.needsUpdate).toBe(true);
            expect(light.shadowFrames).toBe(0);
            const centre = new THREE.Vector3(3, 50, -9);
            light.frameShadows({
                centre, halfWidth: 10, halfHeight: 7, depth: 80,
            });
            expect(light.sun.target.position.toArray()).toEqual([3, 50, -9]);
            expect(light.sun.position.distanceTo(centre)).toBeCloseTo(40, 9);
            expect([camera.left, camera.right, camera.top, camera.bottom, camera.far]).toEqual([-10, 10, 7, -7, 80]);
        });

        it('builds its shading nodes without a renderer', () => {
            const light = createLight();
            const world = vec3(1, 60, -5);
            const nodes = {
                noise: light.noise(vec2(0.1, 0.2)),
                cloudShadow: light.cloudShadow(),
                sunlight: light.sunlight(),
                cloudField: light.cloudField(world.xz),
                blurredField: light.cloudField(world.xz, 2),
                cloudDensity: light.cloudDensity(world),
                coarseDensity: light.cloudDensity(world, { detail: false }),
                sunFoot: light.sunFoot(world),
                sunGap: light.sunGap(world),
                sky: light.sky(vec3(0, 1, 0)),
                ambient: light.ambient(vec3(0, 1, 0)),
                haze: light.haze(vec3(1, 1, 1)),
                hazeAt: light.haze(vec3(1, 1, 1), { world, strength: 0.5 }),
                windBand: light.windBand(world.xz),
                windFront: light.windFront(world.xz),
                wind: light.wind({
                    world, base: vec3(0, 58, 0), height: 12, treePhase: float(0.3), sway: float(0.5), phase: float(0.1),
                }),
            };
            for (const [name, node] of Object.entries(nodes)) expect(node?.isNode, name).toBe(true);
            // The grass is told what the air is doing in four terms it can use.
            const air = light.meadowWind(world, float(0.4));
            for (const name of ['push', 'gust', 'bloom', 'front']) expect(air[name]?.isNode, name).toBe(true);
        });
    });

    describe('cloud cover', () => {
        it('opens on a fair day and keeps edge and span in step with the cover', () => {
            const light = createLight();
            const edges = light.cloudEdges;
            expect(light.uCloudCover.value).toBeGreaterThan(0.05);
            expect(light.uCloudCover.value).toBeLessThan(0.6);
            for (const cover of [0.05, 0.2, 0.33, 0.5, 0.75, 0.9]) {
                light.setCloudCover(cover);
                expect(light.uCloudCover.value).toBe(cover);
                expect(light.uCloudEdge.value).toBe(edges[Math.round((1 - cover) * 255)]);
                // The span runs from the edge to the highest heap, and is never nothing.
                expect(light.uCloudSpan.value).toBeGreaterThan(0);
                expect(light.uCloudSpan.value).toBeGreaterThanOrEqual(1 - light.uCloudEdge.value - 1e-6);
                expect(light.uCloudEdge.value + light.uCloudSpan.value).toBeLessThanOrEqual(1.1);
            }
            // More cover is a lower threshold.
            light.setCloudCover(0.1);
            const thin = light.uCloudEdge.value;
            light.setCloudCover(0.8);
            expect(light.uCloudEdge.value).toBeLessThan(thin);
        });

        it('covers about the share of the sky it is asked for', () => {
            const light = createLight();
            const { data } = light.cloudTexture.image;
            for (const cover of [0.1, 0.25, 0.4, 0.6]) {
                light.setCloudCover(cover);
                const share = shareAbove(data, light.uCloudEdge.value);
                expect(share).toBeGreaterThan(cover - 0.03);
                expect(share).toBeLessThan(cover + 0.03);
            }
        });

        it('clamps the cover between a few clouds and an overcast sky, and falls back for nonsense', () => {
            const light = createLight();
            const fair = light.uCloudCover.value;
            light.setCloudCover(-3);
            const least = light.uCloudCover.value;
            light.setCloudCover(7);
            const most = light.uCloudCover.value;
            expect(least).toBeGreaterThan(0);
            expect(least).toBeLessThan(0.1);
            expect(most).toBeGreaterThan(0.6);
            expect(most).toBeLessThan(1);
            light.setCloudCover(0);
            expect(light.uCloudCover.value).toBe(least);
            light.setCloudCover(1);
            expect(light.uCloudCover.value).toBe(most);
            for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'half', {}]) {
                light.setCloudCover(0.5);
                light.setCloudCover(junk);
                expect(light.uCloudCover.value, String(junk)).toBeGreaterThanOrEqual(least);
                expect(light.uCloudCover.value, String(junk)).toBeLessThanOrEqual(most);
                expect(Number.isFinite(light.uCloudEdge.value)).toBe(true);
                expect(light.uCloudSpan.value).toBeGreaterThan(0);
            }
            // What is not a number is a fair day.
            light.setCloudCover(NaN);
            expect(Math.abs(light.uCloudCover.value - fair)).toBeLessThan(0.1);
        });

        it('follows a cover written straight into the uniform on the next frame', () => {
            const light = createLight();
            light.uCloudCover.value = 0.7;
            light.update(0, CALM);
            expect(light.uCloudEdge.value).toBe(light.cloudEdges[Math.round((1 - 0.7) * 255)]);
            light.uCloudCover.value = 44;
            light.update(0, CALM);
            expect(light.uCloudCover.value).toBeLessThan(1);
        });
    });

    describe('a frame', () => {
        it('takes the clock, and keeps the last good one for a time that is not a number', () => {
            const light = createLight();
            light.update(12.5, CALM);
            expect(light.uTime.value).toBe(12.5);
            for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'now']) {
                light.update(junk, CALM);
                expect(light.uTime.value, String(junk)).toBe(12.5);
            }
            light.update(-4, CALM);
            expect(light.uTime.value).toBe(0);
            // No frame at all is a calm one.
            expect(() => light.update(1)).not.toThrow();
            expect(light.uTime.value).toBe(1);
        });

        it('passes the envelopes through, clamped to their range', () => {
            const light = createLight();
            light.update(0, {
                ...CALM, gust: 0.5, warmth: 0.25, glow: 0.75, shimmer: 1,
            });
            expect(light.uWarmth.value).toBe(0.25);
            expect(light.uGlow.value).toBe(0.75);
            expect(light.uShimmer.value).toBe(1);
            const half = light.uGust.value;
            expect(half).toBeGreaterThan(0);
            light.update(0, {
                ...CALM, gust: 9, warmth: 9, glow: 9, shimmer: 9,
            });
            expect([light.uWarmth.value, light.uGlow.value, light.uShimmer.value]).toEqual([1, 1, 1]);
            // A gust is felt in proportion, and a full one is the most there is.
            expect(light.uGust.value).toBeCloseTo(half * 2, 9);
            light.update(0, { ...CALM, gust: 1 });
            expect(light.uGust.value).toBeCloseTo(half * 2, 9);
            for (const junk of [NaN, Infinity, -Infinity, -3, undefined, null, 'strong', {}]) {
                light.update(0, {
                    wind: junk, gust: junk, warmth: junk, glow: junk, shimmer: junk,
                });
                expect([light.uGust.value, light.uWarmth.value, light.uGlow.value, light.uShimmer.value], String(junk))
                    .toEqual([0, 0, 0, 0]);
                expect(Number.isFinite(light.uWind.value)).toBe(true);
            }
        });

        it('eases the breeze toward the wind dial, and lets it drop when the game is over', () => {
            const light = createLight();
            const resting = light.uWind.value;
            settle(light, CALM);
            // At rest it stays where it started.
            expect(light.uWind.value).toBeCloseTo(resting, 6);
            light.update(0, { ...CALM, wind: 1 });
            const first = light.uWind.value;
            // Eased, not jumped.
            expect(first).toBeGreaterThan(resting);
            settle(light, { ...CALM, wind: 1 });
            const blowing = light.uWind.value;
            expect(blowing).toBeGreaterThan(first);
            expect(blowing).toBeLessThanOrEqual(1);
            settle(light, { ...CALM, wind: 0.5 });
            expect(light.uWind.value).toBeGreaterThan(resting);
            expect(light.uWind.value).toBeLessThan(blowing);
            // A dial beyond its range blows no harder than a full one.
            settle(light, { ...CALM, wind: 50 });
            expect(light.uWind.value).toBeCloseTo(blowing, 6);
            settle(light, { ...CALM, settled: true });
            expect(light.uWind.value).toBeLessThan(resting);
            expect(light.uWind.value).toBeGreaterThan(0);
            // Anything but `true` is still play.
            for (const settled of ['true', 1, {}, null]) {
                settle(light, { ...CALM, settled });
                expect(light.uWind.value).toBeCloseTo(resting, 6);
            }
        });

        it('eases the breeze over the same time whatever the frame rate', () => {
            const rise = (fps) => {
                const light = createLight();
                const resting = light.uWind.value;
                for (let frame = 1; frame <= fps / 2; frame++) light.update(frame / fps, { ...CALM, wind: 1 });
                return light.uWind.value - resting;
            };
            const [slow, smooth, fast] = [rise(30), rise(60), rise(144)];
            expect(slow).toBeGreaterThan(0);
            expect(Math.abs(slow - smooth) / smooth).toBeLessThan(0.1);
            expect(Math.abs(fast - smooth) / smooth).toBeLessThan(0.1);
        });

        it('lays the valley\'s front where the frame says, and takes it away when there is none', () => {
            const light = createLight();
            light.update(0, { ...CALM, front: { along: 320, strength: 0.5, width: 61 } });
            expect(light.uFront.value.x).toBe(320);
            expect(light.uFront.value.z).toBe(61);
            const half = light.uFront.value.y;
            expect(half).toBeGreaterThan(0);
            light.update(0, { ...CALM, front: { along: -40, strength: 7, width: 20 } });
            expect(light.uFront.value.x).toBe(-40);
            expect(light.uFront.value.y).toBeCloseTo(half * 2, 9);
            // No width given: one of its own, never none.
            light.update(0, { ...CALM, front: { along: 10, strength: 1 } });
            expect(light.uFront.value.z).toBeGreaterThan(0);
            light.update(0, { ...CALM, front: { along: 10, strength: 1, width: NaN } });
            expect(light.uFront.value.z).toBeGreaterThan(0);
            // A strength that is not a number is none.
            light.update(0, { ...CALM, front: { along: 10, strength: NaN, width: 30 } });
            expect(light.uFront.value.y).toBe(0);
            light.update(0, { ...CALM, front: { along: 10, strength: 1, width: 30 } });
            for (const front of [null, undefined, {}, { along: NaN, strength: 1 }, { strength: 1 }]) {
                light.update(0, { ...CALM, front: { along: 10, strength: 1, width: 30 } });
                light.update(0, { ...CALM, front });
                expect(light.uFront.value.y, JSON.stringify(front)).toBe(0);
                expect(light.uFront.value.toArray().every(Number.isFinite)).toBe(true);
            }
        });

        it('opens the clouds over the pool the frame gives, and closes them when there is none', () => {
            const light = createLight();
            light.update(0, {
                ...CALM,
                pool: {
                    x: -420, z: -330, radius: 500, strength: 0.4,
                },
            });
            expect(light.uSunPool.value.toArray()).toEqual([-420, -330, 500, 0.4]);
            light.update(0, {
                ...CALM,
                pool: {
                    x: 90, z: -1200, radius: 300, strength: 12,
                },
            });
            expect(light.uSunPool.value.toArray()).toEqual([90, -1200, 300, 1]);
            light.update(0, { ...CALM, pool: { x: 1, z: 2, strength: 1 } });
            expect(light.uSunPool.value.z).toBeGreaterThan(0);
            for (const pool of [null, undefined, {}, { x: NaN, z: 0, strength: 1 }, { z: 4, strength: 1 }]) {
                light.update(0, {
                    ...CALM,
                    pool: {
                        x: 90, z: -1200, radius: 300, strength: 1,
                    },
                });
                light.update(0, { ...CALM, pool });
                expect(light.uSunPool.value.w, JSON.stringify(pool)).toBe(0);
                expect(light.uSunPool.value.toArray().every(Number.isFinite)).toBe(true);
            }
        });

        it('redraws the static shadow map over the first frames and then leaves it alone', () => {
            const light = createLight();
            const asked = [];
            for (let frame = 1; frame <= 400; frame++) {
                light.sun.shadow.needsUpdate = false;
                light.update(frame * STEP, CALM);
                if (light.sun.shadow.needsUpdate) asked.push(frame);
            }
            // While pipelines may still be compiling, and a couple of times after for late arrivals.
            expect(asked.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
            expect(asked.length).toBeGreaterThan(5);
            expect(asked.length).toBeLessThan(30);
            expect(asked[asked.length - 1]).toBeLessThan(300);
            // Framing the shadows again starts the redraws over.
            light.frameShadows();
            light.sun.shadow.needsUpdate = false;
            light.update(0, CALM);
            expect(light.sun.shadow.needsUpdate).toBe(true);
        });
    });

    describe('time', () => {
        /** How far the cloud field has slid since the session began, in tiles. */
        const drift = (light, start) => light.uCloudOffset.value.clone().sub(start);

        it('slides the cloud field against the wind, so the clouds travel with it', () => {
            const light = createLight();
            const start = light.uCloudOffset.value.clone();
            light.update(0, CALM);
            light.step(1);
            const moved = drift(light, start);
            expect(moved.length()).toBeGreaterThan(0);
            // Straight against the wind: the sampling point moves upwind, the picture downwind.
            expect(moved.clone().normalize().dot(WINDWARD)).toBeCloseTo(-1, 9);
            // A few metres to a few tens of metres a second, for clouds a kilometre up.
            const metres = moved.length() * VERDANT_HILLS_CLOUD_TILE;
            expect(metres).toBeGreaterThan(2);
            expect(metres).toBeLessThan(60);
        });

        it('moves the clouds in proportion to the time that passes, at any frame rate', () => {
            const light = createLight();
            const run = (fps, seconds) => {
                light.rewind();
                const start = light.uCloudOffset.value.clone();
                light.update(0, CALM);
                for (let frame = 0; frame < fps * seconds; frame++) light.step(1 / fps);
                return { moved: drift(light, start), clock: light.uWindClock.value };
            };
            const reference = run(60, 4);
            for (const fps of [30, 144]) {
                const other = run(fps, 4);
                expect(other.moved.x).toBeCloseTo(reference.moved.x, 9);
                expect(other.moved.y).toBeCloseTo(reference.moved.y, 9);
                expect(other.clock).toBeCloseTo(reference.clock, 9);
            }
            const longer = run(60, 8);
            expect(longer.moved.length()).toBeCloseTo(reference.moved.length() * 2, 9);
            expect(longer.clock).toBeCloseTo(reference.clock * 2, 9);
            expect(reference.clock).toBeGreaterThan(0);
        });

        it('hurries the clouds and the bands of the breeze when it blows, and slows them when the game is over', () => {
            const light = createLight();
            const run = (frame) => {
                light.rewind();
                settle(light, frame);
                const start = light.uCloudOffset.value.clone();
                const clock = light.uWindClock.value;
                for (let count = 0; count < 60; count++) light.step(STEP);
                return { moved: drift(light, start).length(), clock: light.uWindClock.value - clock };
            };
            const calm = run(CALM);
            const windy = run({ ...CALM, wind: 1 });
            const gusty = run({ ...CALM, gust: 1 });
            const over = run({ ...CALM, settled: true });
            expect(windy.moved).toBeGreaterThan(calm.moved * 1.5);
            expect(gusty.moved).toBeGreaterThan(calm.moved);
            expect(over.moved).toBeLessThan(calm.moved);
            expect(over.moved).toBeGreaterThan(0);
            expect(windy.clock).toBeGreaterThan(calm.clock);
            expect(gusty.clock).toBeGreaterThan(calm.clock);
            expect(over.clock).toBeLessThan(calm.clock);
        });

        it('ignores a step that is no time at all', () => {
            const light = createLight();
            light.update(0, CALM);
            light.waves.add(1, 2, 1);
            light.step(0.5);
            const offset = light.uCloudOffset.value.clone();
            const clock = light.uWindClock.value;
            const age = light.waves.rings[0].z;
            for (const dt of [0, -0, -1, NaN, -Infinity, undefined, null, 'x', {}]) light.step(dt);
            expect(light.uCloudOffset.value.toArray()).toEqual(offset.toArray());
            expect(light.uWindClock.value).toBe(clock);
            expect(light.waves.rings[0].z).toBe(age);
        });

        it('ages the gusts in the grass and lets each one die', () => {
            const light = createLight();
            const ring = light.waves.add(4, -6, 1.5);
            expect(light.waves.active()).toBe(1);
            light.step(0.25);
            expect(ring.toArray()).toEqual([4, -6, 0.25, 1.5]);
            // A gust lives long enough to cross the grass in front of the lens, and no longer.
            expect(light.waves.life * VERDANT_HILLS_WAVE_SPEED).toBeGreaterThan(15);
            for (let count = 0; count < 60 * 30 && light.waves.active() > 0; count++) light.step(STEP);
            expect(light.waves.active()).toBe(0);
            expect(ring.toArray()).toEqual([0, 0, 0, 0]);
        });

        it('never wraps the cloud field and stays finite through an afternoon of play', () => {
            const light = createLight();
            const start = light.uCloudOffset.value.clone();
            const random = seededRandom(17);
            let previous = 0;
            // Four hours in coarse steps, the wind rising and falling all the while.
            for (let count = 0; count < 4 * 3600; count++) {
                if (count % 600 === 0) {
                    settle(light, { ...CALM, wind: random(), gust: random() * 0.5 }, 60);
                }
                light.step(1);
                const moved = drift(light, start).length();
                // Always further from where it began: a wrap would bring it back.
                if (!(moved > previous)) throw new Error(`the field came back at ${count} s`);
                previous = moved;
            }
            expect(light.uCloudOffset.value.toArray().every(Number.isFinite)).toBe(true);
            expect(Number.isFinite(light.uWindClock.value)).toBe(true);
            // Tens of tiles, as the rig's own comment says: far inside what a float holds exactly.
            expect(previous).toBeGreaterThan(2);
            expect(previous).toBeLessThan(500);
            expect(drift(light, start).normalize().dot(WINDWARD)).toBeCloseTo(-1, 9);
        });
    });

    describe('starting over', () => {
        it('clears the gusts, the front and the pool of light on reset, and nothing else', () => {
            const light = createLight();
            light.update(3, {
                ...CALM,
                wind: 1,
                gust: 0.5,
                front: { along: 100, strength: 1, width: 40 },
                pool: {
                    x: 5, z: -900, radius: 350, strength: 1,
                },
            });
            for (let count = 0; count < 5; count++) light.waves.add(count, -count, 1);
            light.step(0.5);
            const kept = {
                offset: light.uCloudOffset.value.toArray(),
                clock: light.uWindClock.value,
                wind: light.uWind.value,
                time: light.uTime.value,
                cover: light.uCloudCover.value,
            };
            const { rings } = light.waves;
            light.reset();
            expect(light.waves.active()).toBe(0);
            expect(light.waves.rings).toBe(rings);
            for (const ring of rings) expect(ring.toArray()).toEqual([0, 0, 0, 0]);
            expect(light.uFront.value.y).toBe(0);
            expect(light.uSunPool.value.w).toBe(0);
            // The day itself goes on.
            expect(light.uCloudOffset.value.toArray()).toEqual(kept.offset);
            expect(light.uWindClock.value).toBe(kept.clock);
            expect(light.uWind.value).toBe(kept.wind);
            expect(light.uTime.value).toBe(kept.time);
            expect(light.uCloudCover.value).toBe(kept.cover);
        });

        it('puts the clouds and the wind back where a session starts on rewind', () => {
            const light = createLight();
            const start = {
                offset: light.uCloudOffset.value.toArray(),
                wind: light.uWind.value,
                clock: light.uWindClock.value,
                speed: light.cloudSpeed,
            };
            const session = () => {
                const seen = [];
                for (let frame = 0; frame < 300; frame++) {
                    const [wind, gust] = [frame < 150 ? 0.8 : 0.1, frame % 90 < 10 ? 0.6 : 0];
                    light.update(frame * STEP, { ...CALM, wind, gust });
                    light.step(STEP);
                    if (frame % 60 === 0) {
                        seen.push([...light.uCloudOffset.value.toArray(), light.uWind.value, light.uWindClock.value]);
                    }
                }
                return seen;
            };
            const first = session();
            light.waves.add(1, 1, 1);
            light.update(0, { ...CALM, front: { along: 3, strength: 1 }, pool: { x: 1, z: 1, strength: 1 } });
            expect(light.uCloudOffset.value.toArray()).not.toEqual(start.offset);
            light.rewind();
            expect(light.uCloudOffset.value.toArray()).toEqual(start.offset);
            expect(light.uWind.value).toBe(start.wind);
            expect(light.uWindClock.value).toBe(start.clock);
            expect(light.cloudSpeed).toBe(start.speed);
            // And everything in flight is dropped with it.
            expect(light.waves.active()).toBe(0);
            expect(light.uFront.value.y).toBe(0);
            expect(light.uSunPool.value.w).toBe(0);
            // A replay from here is the same replay.
            expect(session()).toEqual(first);
        });
    });

    describe('ownership', () => {
        it('releases its textures and its shadow, and leaves the group it joined', () => {
            const light = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS.Minimal, rng: seededRandom(5) });
            const group = new THREE.Group();
            light.addTo(group);
            const released = [];
            light.noiseTexture.addEventListener('dispose', () => released.push('noise'));
            light.cloudTexture.addEventListener('dispose', () => released.push('clouds'));
            light.sun.addEventListener('dispose', () => released.push('sun'));
            light.dispose();
            expect(released.sort()).toEqual(['clouds', 'noise', 'sun']);
            expect(group.children).toHaveLength(0);
            expect(light.sun.parent).toBeNull();
            expect(light.sun.target.parent).toBeNull();
        });

        it('takes degrees for the sun, as its names say', () => {
            // A sun given in radians by mistake would stand a degree or so off the horizon.
            const elevation = radToDeg(Math.asin(VERDANT_HILLS_SUN_DIRECTION.y));
            expect(elevation).toBeGreaterThan(10);
            expect(degToRad(elevation)).toBeCloseTo(Math.asin(VERDANT_HILLS_SUN_DIRECTION.y), 12);
        });
    });
});
