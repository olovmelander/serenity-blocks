import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FluidDreamsWorld, REST_RIG, SITE, fovForAspect, horizonY, restBounds, restProject, restRay,
} from '../../src/themes/fluid-dreams/fluid-dreams-world.js';
import {
    DEG, DREAMFIRE, DREAM_HOLD, DREAM_SECONDS, FLIGHT_TIME, FLUID_PALETTES, GROUP_COUNT, GROUP_HERO, GROUP_KIN,
    GROUP_LEFT, GROUP_RIGHT, GROUP_START, HERO, HUSH_HOLD, JET_TIME, PALETTE_KEYS, PLUNGE, dreamDrift, paletteAt,
    pieceColor, powerForCombo, sceneAnchors,
} from '../../src/themes/fluid-dreams/fluid-dreams-core.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/fluid-dreams/fluid-dreams-quality.js';
import {
    BOARD_GRID, PLAYER_SLOTS, boardPoint, cardUnion, fallbackLayout,
} from '../../src/themes/fluid-dreams/fluid-dreams-composition.js';
import { POST_LOOK } from '../../src/themes/fluid-dreams/fluid-dreams-post.js';
import {
    MOTE_BOX, SPRAY_KINDS, createSpray, sprayHeight,
} from '../../src/themes/fluid-dreams/fluid-dreams-spray.js';
import { NOISE_SIZE, bakeNoise, createNoiseTexture } from '../../src/themes/fluid-dreams/fluid-dreams-tsl.js';
import {
    AIRS, AIR_LEVEL_STEP, AIR_SECONDS, BUBBLE_SLOTS, FAR_COUNT, SKY_ROWS, SUN, airDrift, airNear, happeningOf,
} from '../../src/themes/fluid-dreams/fluid-dreams-sky.js';
import { REDUCED_FLASH_SCALE, holdFlashing } from '../../src/utils/photosensitivity.js';

const PARTS = ['liquid', 'motes', 'spray'];

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, live = true, capture = true, layout = null,
} = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new FluidDreamsWorld({ scene, quality, capture }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(layout || (live ? fallbackLayout(width, height) : null), width / height);
    world.seek(10);
    world.updateCamera(camera, { time: 10, delta: 0 });
    world.update({ time: 10, delta: 0 }, camera);
    return { scene, camera, world };
}

/** Advance the world from its current time by `seconds` in `steps` equal frames. */
function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60)), pointer = {}) {
    const t0 = world.u.time.value;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: t0 + (seconds * i) / steps, delta: seconds / steps, ...pointer };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

/** The camera the composition is measured in: a little above the sea, looking out and slightly up. */
function restCamera(aspect) {
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    camera.position.set(0, REST_RIG.height, 0);
    camera.lookAt(0, REST_RIG.height + Math.tan(REST_RIG.pitch) * 10, -10);
    camera.updateMatrixWorld();
    return camera;
}

/** Hold the camera on the rest rig exactly (reduced motion: no drift), so screen positions are exact. */
function atRest(world, camera) {
    world.setReducedMotion(true);
    world.updateCamera(camera, { time: world.u.time.value, delta: 0 });
}

/** Where a world point stands on screen (fractions, y down); `depth` < 1 means in front of the camera. */
function onScreen(camera, x, y, z) {
    const p = new THREE.Vector3(x, y, z).project(camera);
    return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5, depth: p.z };
}

/** Record what the world asks of its choreography (the world reuses its scratch arrays: copy). */
function recordLocks(world) {
    const locks = [];
    const lock = world.choreo.lock.bind(world.choreo);
    vi.spyOn(world.choreo, 'lock').mockImplementation((request) => {
        locks.push({ ...request, from: [...request.from], to: [...request.to] });
        lock(request);
    });
    return locks;
}

function recordClears(world) {
    const clears = [];
    const clear = world.choreo.clear.bind(world.choreo);
    vi.spyOn(world.choreo, 'clear').mockImplementation((request) => {
        clears.push({ ...request, origin: [...request.origin], site: request.site ? [...request.site] : null });
        return clear(request);
    });
    return clears;
}

function recordSpray(world) {
    const bursts = [];
    const emit = world.parts.spray.emit.bind(world.parts.spray);
    vi.spyOn(world.parts.spray, 'emit').mockImplementation((burst) => {
        bursts.push({ ...burst, color: [...burst.color], dir: burst.dir ? [...burst.dir] : null });
        emit(burst);
    });
    return bursts;
}

/** Slots of the spray pool that have been thrown (their birth time is no longer the dormant one). */
function thrown(spray) {
    const births = spray.geometry.getAttribute('aBirth').array;
    let used = 0;
    for (let i = 3; i < births.length; i += 4) if (births[i] > -50) used += 1;
    return used;
}

/** A layout as the theme reads it from the page. */
const layoutOf = (cards, boards, hud = null) => ({
    cardCount: cards.length,
    cards,
    hud,
    boards: Array.from({ length: PLAYER_SLOTS }, (_, i) => boards[i] ?? null),
});

afterEach(() => {
    vi.restoreAllMocks();
    holdFlashing(false);
});

describe('fluid dreams tiers', () => {
    it('defines every quality tier for the world and the post', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        for (const name of QUALITY_NAMES) {
            expect(QUALITY[name]).toBeTruthy();
            expect(tierFor(name)).toBe(QUALITY[name]);
            expect(POST_LOOK[name]).toBeTruthy();
        }
        expect(tierFor('nope')).toBe(QUALITY.High);
        expect(tierFor(undefined)).toBe(QUALITY.High);
    });

    it('scales every budget monotonically with the tier', () => {
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const a = QUALITY[QUALITY_NAMES[i - 1]];
            const b = QUALITY[QUALITY_NAMES[i]];
            // Every tier answers the same questions.
            expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
            for (const key of [
                'steps', 'bounceSteps', 'bounces', 'lobes', 'satellites', 'crownSpokes', 'bubbles', 'motes', 'spray',
            ]) {
                expect(b[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(a[key]);
            }
            for (const key of Object.keys(b).filter((name) => typeof b[name] === 'boolean')) {
                expect(Number(b[key]), `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(Number(a[key]));
            }
            const lookA = POST_LOOK[QUALITY_NAMES[i - 1]];
            const lookB = POST_LOOK[QUALITY_NAMES[i]];
            for (const key of ['shafts', 'bloomResolution', 'bloomStrength']) {
                expect(lookB[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(lookA[key]);
            }
        }
    });

    it('keeps the whole picture and every event on every tier, inside what the Drop can show', () => {
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            expect(tier.steps, name).toBeGreaterThan(0);
            expect(tier.bounceSteps, name).toBeGreaterThan(0);
            expect(tier.bounces, name).toBeGreaterThanOrEqual(1);
            expect(tier.lobes, name).toBeGreaterThanOrEqual(2);
            expect(tier.lobes, name).toBeLessThanOrEqual(HERO.lobes);
            // A chain shows on every tier...
            expect(tier.satellites, name).toBeGreaterThan(0);
            expect(tier.satellites, name).toBeLessThanOrEqual(HERO.satellites);
            // ...and so does a splash: the pool holds the largest burst there is.
            const largest = Math.max(...Object.values(SPRAY_KINDS).map((kind) => kind.n));
            expect(tier.spray, name).toBeGreaterThan(largest * 2);
            expect(tier.motes, name).toBeGreaterThanOrEqual(0);
        }
        expect(QUALITY.High.lobes).toBe(HERO.lobes);
        expect(QUALITY.High.satellites).toBe(HERO.satellites);
    });

    it('says on every tier what the sky pays for: its light, its bars, its bubbles, its mirror', () => {
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            for (const key of ['skyLit', 'strata', 'mirrorSky', 'mirrorExtras']) {
                expect(typeof tier[key], `${name}.${key}`).toBe('boolean');
            }
            // A whole number of bubbles, never more than the sky's table has rows for.
            expect(Number.isInteger(tier.bubbles), `${name}.bubbles`).toBe(true);
            expect(tier.bubbles, `${name}.bubbles`).toBeGreaterThanOrEqual(0);
            expect(tier.bubbles, `${name}.bubbles`).toBeLessThanOrEqual(BUBBLE_SLOTS);
        }
        // From Minimal to Extreme the sky only gains (the monotone gate above holds the rest).
        const bubbles = QUALITY_NAMES.map((name) => QUALITY[name].bubbles);
        for (let i = 1; i < bubbles.length; i++) expect(bubbles[i]).toBeGreaterThanOrEqual(bubbles[i - 1]);
        expect(bubbles[bubbles.length - 1]).toBeGreaterThan(bubbles[0]);
    });
});

describe('fluid dreams noise', () => {
    const noise = bakeNoise();

    it('bakes four tileable channels in the unit range, the same every time', () => {
        expect(noise).toHaveLength(NOISE_SIZE * NOISE_SIZE * 4);
        const lo = [Infinity, Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity, -Infinity];
        for (let i = 0; i < noise.length; i++) {
            lo[i % 4] = Math.min(lo[i % 4], noise[i]);
            hi[i % 4] = Math.max(hi[i % 4], noise[i]);
        }
        for (let c = 0; c < 4; c++) {
            expect(lo[c]).toBeGreaterThanOrEqual(0);
            expect(hi[c]).toBeLessThanOrEqual(1);
            expect(hi[c] - lo[c]).toBeGreaterThan(0.5); // it uses its range
        }
        // The height and the ink are stretched to the whole of it.
        for (const c of [0, 3]) {
            expect(lo[c]).toBeCloseTo(0, 5);
            expect(hi[c]).toBeCloseTo(1, 5);
        }
        const again = bakeNoise();
        for (let i = 0; i < noise.length; i += 997) expect(again[i]).toBe(noise[i]);
        const other = bakeNoise(99);
        let differs = 0;
        for (let i = 0; i < noise.length; i += 997) if (other[i] !== noise[i]) differs += 1;
        expect(differs).toBeGreaterThan(100);
    });

    it('stores the ripple\'s slopes beside its height, and tiles', () => {
        const wrap = (v) => (v + NOISE_SIZE) % NOISE_SIZE;
        const at = (x, y, c) => noise[(wrap(y) * NOISE_SIZE + wrap(x)) * 4 + c];
        // Green and blue are the height's central differences along x and y, about 0.5.
        let agree = 0;
        let total = 0;
        for (let y = 3; y < NOISE_SIZE; y += 17) {
            for (let x = 5; x < NOISE_SIZE; x += 13) {
                const dx = at(x + 1, y, 0) - at(x - 1, y, 0);
                const dy = at(x, y + 1, 0) - at(x, y - 1, 0);
                if (Math.abs(dx) > 1e-4) {
                    total += 1;
                    if (Math.sign(dx) === Math.sign(at(x, y, 1) - 0.5)) agree += 1;
                }
                if (Math.abs(dy) > 1e-4) {
                    total += 1;
                    if (Math.sign(dy) === Math.sign(at(x, y, 2) - 0.5)) agree += 1;
                }
            }
        }
        expect(total).toBeGreaterThan(200);
        expect(agree).toBe(total);
        // Across the seam the field is as smooth as anywhere else.
        let seam = 0;
        let inside = 0;
        for (let y = 0; y < NOISE_SIZE; y++) {
            seam = Math.max(seam, Math.abs(at(NOISE_SIZE - 1, y, 3) - at(0, y, 3)));
            inside = Math.max(inside, Math.abs(at(100, y, 3) - at(101, y, 3)));
        }
        expect(seam).toBeLessThan(inside * 3 + 1e-3);
    });

    it('uploads it as a repeating half-float texture with its own mip chain', () => {
        const texture = createNoiseTexture(noise);
        expect(texture.isDataTexture).toBe(true);
        expect(texture.type).toBe(THREE.HalfFloatType);
        expect(texture.format).toBe(THREE.RGBAFormat);
        expect(texture.wrapS).toBe(THREE.RepeatWrapping);
        expect(texture.wrapT).toBe(THREE.RepeatWrapping);
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
        // The mips are built on the CPU (half-float mip generation is not portable to every WebGL2 device).
        expect(texture.generateMipmaps).toBe(false);
        expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(texture.mipmaps).toHaveLength(Math.log2(NOISE_SIZE) + 1);
        texture.mipmaps.forEach((level, i) => {
            expect(level.width).toBe(NOISE_SIZE >> i);
            expect(level.height).toBe(NOISE_SIZE >> i);
            expect(level.data).toHaveLength(level.width * level.height * 4);
        });
        expect(texture.image.data).toBe(texture.mipmaps[0].data);
        texture.dispose();
    });
});

describe('fluid dreams world: build', () => {
    it('builds every tier from node materials only, with the pools its tier pays for', () => {
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            const materials = new Set();
            const meshes = [];
            scene.traverse((object) => {
                if (object.material) {
                    materials.add(object.material);
                    meshes.push(object);
                }
            });
            // The liquid (one material for everything liquid in the picture), the mist, the spray.
            expect(meshes).toHaveLength(PARTS.length);
            expect(materials.size).toBe(PARTS.length);
            for (const material of materials) {
                expect(material.isNodeMaterial, material.name).toBe(true);
                expect(material.isShaderMaterial, material.name).not.toBe(true);
                expect(material.fog, material.name).toBe(false); // the air is in the liquid's own shading
                expect(material.depthTest, material.name).toBe(false);
                expect(material.depthWrite, material.name).toBe(false);
            }
            expect(Object.keys(world.parts).sort()).toEqual([...PARTS].sort());
            for (const name of PARTS) {
                const part = world.parts[name];
                expect(part.mesh.material, name).toBe(part.material);
                expect(part.mesh.geometry, name).toBe(part.geometry);
                expect(part.mesh.frustumCulled, name).toBe(false);
                expect(part.mesh.visible, name).toBe(true);
                expect(part.mesh.parent, name).toBe(world.group);
            }
            expect(scene.children).toContain(world.group);
            // The liquid is drawn first, the sprites over it.
            expect(world.parts.liquid.mesh.renderOrder).toBeLessThan(world.parts.motes.mesh.renderOrder);
            expect(world.parts.liquid.mesh.renderOrder).toBeLessThan(world.parts.spray.mesh.renderOrder);
            // Pools are sized once, by the tier, and always drawn (dormant slots collapse to nothing).
            expect(world.parts.spray.count, quality).toBe(tier.spray);
            expect(world.parts.spray.geometry.instanceCount, quality).toBe(tier.spray);
            expect(world.parts.motes.count, quality).toBe(tier.motes);
            expect(world.parts.motes.geometry.instanceCount, quality).toBe(tier.motes);
            // The choreography shows what the tier pays for.
            expect(world.choreo.maxSatellites, quality).toBe(tier.satellites);
            expect(world.choreo.lobes, quality).toBe(tier.lobes);
            expect(world.choreo.crown, quality).toBe(tier.crown);
            expect(world.getState()).toMatchObject({
                quality, level: 1, palette: FLUID_PALETTES[0].name, combo: 0, charge: 0, stains: 0, waves: 0,
            });
            expect(world.getState().layoutLive).toBe(true);
            expect(world.getState().balls).toHaveLength(GROUP_COUNT);
            expect(world.getState().balls[GROUP_HERO]).toBeGreaterThan(tier.lobes);
            world.dispose();
        }
    });

    it('hands the liquid the choreography\'s own tables, and every palette key a colour', () => {
        const { world } = makeWorld('Low');
        const { u, choreo } = world;
        for (const name of ['balls', 'groups', 'rings', 'dye', 'waves']) {
            expect(u[name].array, name).toBe(choreo.tables[name]);
        }
        for (const key of PALETTE_KEYS) {
            expect(u[key].value.toArray(), key).toEqual(FLUID_PALETTES[0][key]);
        }
        expect(u.noise).toBe(world.noise);
        expect(u.noise.isDataTexture).toBe(true);
        world.dispose();
    });

    it('scatters its mist through the volume the camera looks into', () => {
        const { world } = makeWorld('Medium');
        const seeds = world.parts.motes.geometry.getAttribute('aSeed');
        expect(seeds.count).toBe(QUALITY.Medium.motes);
        for (let i = 0; i < seeds.count; i++) {
            expect(Math.abs(seeds.getX(i))).toBeLessThanOrEqual(MOTE_BOX.halfWidth);
            expect(seeds.getY(i)).toBeGreaterThanOrEqual(0);
            expect(seeds.getY(i)).toBeLessThanOrEqual(MOTE_BOX.height);
            expect(seeds.getZ(i)).toBeLessThanOrEqual(MOTE_BOX.near);
            expect(seeds.getZ(i)).toBeGreaterThanOrEqual(MOTE_BOX.far);
        }
        world.dispose();
    });

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['liquid', 'spray', 'no-such-part']);
        PARTS.forEach((name) => {
            expect(world.parts[name].mesh.visible, name).toBe(name !== 'motes');
        });
        world.showOnlyParts(PARTS);
        expect(Object.values(world.parts).every((part) => part.mesh.visible)).toBe(true);
        world.dispose();
    });

    it('releases every geometry, material and texture, leaves the scene and survives a second dispose', () => {
        const { scene, camera, world } = makeWorld('Medium');
        expect(scene.children).toContain(world.group);
        const disposals = [];
        Object.values(world.parts).forEach((part) => {
            disposals.push(vi.spyOn(part.geometry, 'dispose'), vi.spyOn(part.material, 'dispose'));
        });
        const noise = vi.spyOn(world.noise, 'dispose');
        world.dispose();
        expect(scene.children).toHaveLength(0);
        expect(disposals).toHaveLength(PARTS.length * 2);
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        expect(noise).toHaveBeenCalledOnce();
        expect(world.parts).toEqual({});
        expect(world.group).toBeNull();
        expect(world.u).toBeNull();
        expect(world.choreo).toBeNull();
        expect(world.sky).toBeNull();
        expect(world.noise).toBeNull();
        expect(() => world.dispose()).not.toThrow();
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        expect(noise).toHaveBeenCalledOnce();
        // A late frame or a late event after retirement is harmless.
        expect(() => {
            world.updateCamera(camera, { time: 11, delta: 0.016 });
            world.update({ time: 11, delta: 0.016 }, camera);
            world.onLock({ u: 0.5 });
            world.onClear({ lines: 4 });
            world.onClear({ lines: 1, screen: { x: 0.3, y: 0.8 } });
            world.onCombo(3);
            world.levelUp(2);
            world.setViewport(800, 600, 800 / 600);
            world.setLayout(null);
            world.setReducedMotion(true);
            world.showOnlyParts(['liquid']);
            world.resetSession();
            world.endRun();
            world.onSpin();
            world.setAirHold(2);
            world.setHappenings(false);
            world.onChoreography('impact', 1, -20, 0);
            world.seek(3);
        }).not.toThrow();
        expect(world.happen('star', 3)).toBeNull();
        expect(world.combo).toBe(0);
        expect(world.getState()).toMatchObject({ combo: 0, charge: 0, balls: [] });
        expect(world.getState().air).toBeUndefined();
        expect(world.getPostState()).toBeTruthy();
    });

    it('takes a new run or a seek before it is built, as after it is retired', () => {
        const world = new FluidDreamsWorld({ scene: new THREE.Scene(), quality: 'Low' });
        expect(() => {
            world.resetSession();
            world.seek(12);
            world.onCombo(2);
            world.levelUp(3);
            world.setReducedMotion(true);
            world.setAirHold(1);
            world.setHappenings(false);
            world.endRun();
        }).not.toThrow();
        expect(world.happen('shoal')).toBeNull();
        expect(world.getState()).toMatchObject({ combo: 0, charge: 0, balls: [] });
        // Built afterwards, it is a world like any other.
        world.build();
        expect(world.getState().balls).toHaveLength(GROUP_COUNT);
        expect(() => {
            world.resetSession();
            world.seek(12);
        }).not.toThrow();
        expect(world.getState()).toMatchObject({ level: 1, palette: FLUID_PALETTES[0].name });
        world.dispose();
    });

    it('has nothing to download', async () => {
        const load = vi.spyOn(THREE.TextureLoader.prototype, 'load');
        const { world } = makeWorld('High');
        expect(world.loadTextures).toBeUndefined();
        expect(load).not.toHaveBeenCalled();
        world.dispose();
    });
});

describe('fluid dreams world: camera and composition', () => {
    it('keeps some width of sea on a narrow screen, inside a sane lens', () => {
        const aspects = [0.3, 0.46, 0.6, 0.75, 0.9, 1, 1.2, 4 / 3, 16 / 9, 21 / 9, 32 / 9];
        const fovs = aspects.map(fovForAspect);
        for (let i = 0; i < aspects.length; i++) {
            expect(fovs[i], `aspect ${aspects[i]}`).toBeGreaterThanOrEqual(REST_RIG.fov);
            expect(fovs[i], `aspect ${aspects[i]}`).toBeLessThan(100);
            // The narrower the frame, the wider the lens: never the other way.
            if (i > 0) expect(fovs[i]).toBeLessThanOrEqual(fovs[i - 1]);
        }
        // Wide frames rest on the authored lens; an upright phone gets a wider one.
        expect(fovForAspect(16 / 9)).toBe(REST_RIG.fov);
        expect(fovForAspect(32 / 9)).toBe(REST_RIG.fov);
        expect(fovForAspect(9 / 19.5)).toBeGreaterThan(REST_RIG.fov);
        // Between its limits it holds the horizontal view.
        const widest = Math.max(...fovs);
        const free = aspects.filter((aspect, i) => fovs[i] > REST_RIG.fov && fovs[i] < widest);
        const across = free.map((aspect) => Math.tan((fovForAspect(aspect) * DEG) / 2) * aspect);
        expect(free.length).toBeGreaterThan(1);
        for (const width of across) expect(width).toBeCloseTo(across[0], 9);
        // Nonsense falls back to a 16:9 frame; a sliver is treated as the narrowest frame.
        expect(fovForAspect(NaN)).toBe(fovForAspect(16 / 9));
        expect(fovForAspect(undefined)).toBe(fovForAspect(16 / 9));
        expect(fovForAspect(Infinity)).toBe(fovForAspect(16 / 9));
        expect(fovForAspect(0)).toBe(fovForAspect(0.3));
        expect(fovForAspect(-1)).toBe(fovForAspect(0.3));
    });

    it('casts the rest camera\'s rays and knows where its sea line is', () => {
        for (const aspect of [16 / 9, 21 / 9, 1, 430 / 932]) {
            const camera = restCamera(aspect);
            for (const [sx, sy] of [[0.5, 0.5], [0, 0], [1, 1], [0.215, 0.33], [0.9, 0.62]]) {
                const ray = restRay(sx, sy, aspect);
                expect(Math.hypot(...ray)).toBeCloseTo(1, 12);
                // The same ray three would cast through that pixel.
                const three = new THREE.Vector3(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera)
                    .sub(camera.position).normalize();
                expect(ray[0]).toBeCloseTo(three.x, 6);
                expect(ray[1]).toBeCloseTo(three.y, 6);
                expect(ray[2]).toBeCloseTo(three.z, 6);
            }
            // Through the middle of the frame it looks along the rig's pitch.
            const centre = restRay(0.5, 0.5, aspect);
            expect(centre[0]).toBeCloseTo(0, 12);
            expect(centre[1]).toBeCloseTo(Math.sin(REST_RIG.pitch), 12);
            expect(centre[2]).toBeCloseTo(-Math.cos(REST_RIG.pitch), 12);
            // The sea line: where a ray is level. The camera looks a little up, so it is below centre.
            const sea = horizonY(aspect);
            expect(sea).toBeGreaterThan(0.5);
            expect(sea).toBeLessThan(0.8);
            expect(restRay(0.5, sea, aspect)[1]).toBeCloseTo(0, 12);
            expect(restRay(0.1, sea, aspect)[1]).toBeCloseTo(0, 12);
            expect(restRay(0.5, sea + 0.05, aspect)[1]).toBeLessThan(0);
        }
        // It writes into the array it is handed.
        const out = [0, 0, 0];
        expect(restRay(0.3, 0.3, 1.5, out)).toBe(out);
    });

    it('stands a little above the sea, looking out and slightly up', () => {
        const { camera, world } = makeWorld('Minimal');
        expect(Math.abs(camera.position.x)).toBeLessThan(1.5);
        expect(Math.abs(camera.position.y - REST_RIG.height)).toBeLessThan(0.3);
        expect(camera.position.z).toBe(0);
        expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 3);
        expect(camera.near).toBe(REST_RIG.near);
        expect(camera.far).toBe(REST_RIG.far);
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        expect(forward.z).toBeLessThan(-0.95);
        expect(forward.y).toBeGreaterThan(0); // looking up
        expect(forward.y).toBeLessThan(0.3);
        // The liquid's shell is centred on the eye and reaches inside the far plane.
        const shell = world.parts.liquid.mesh;
        expect(shell.position.toArray()).toEqual(camera.position.toArray());
        expect(shell.scale.x).toBeLessThan(REST_RIG.far);
        expect(shell.scale.x).toBeGreaterThan(REST_RIG.near * 10);
        // A pixel's angle follows the lens and the buffer.
        expect(world.u.pixelAngle.value).toBeCloseTo((2 * Math.tan((camera.fov * DEG) / 2)) / 900, 12);
        world.dispose();
    });

    it('stands the Great Drop, its kin and the dream sun where the composition wants them', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [1024, 768], [430, 932]]) {
            const aspect = width / height;
            const frame = `${width}x${height}`;
            const { camera, world } = makeWorld('Minimal', { width, height });
            world.setReducedMotion(true); // the rest camera, exactly
            world.updateCamera(camera, { time: 10, delta: 0 });
            const anchors = sceneAnchors(aspect);
            const { scene } = world.choreo;
            const hero = onScreen(camera, ...scene.hero);
            expect(hero.depth, frame).toBeLessThan(1);
            expect(hero.x, frame).toBeCloseTo(anchors.hero.x, 3);
            // Where the frame is too low for it, it is raised: never so low that the thread has no room.
            expect(hero.y, frame).toBeLessThanOrEqual(anchors.hero.y + 1e-3);
            expect(scene.heroScale, frame).toBe(anchors.heroScale);
            expect(scene.hero[1] - HERO.radius * scene.heroScale, frame).toBeGreaterThan(1);
            expect(Math.hypot(scene.hero[0], scene.hero[1] - REST_RIG.height, scene.hero[2]), frame)
                .toBeGreaterThanOrEqual(HERO.distance - 1e-6);
            const kin = onScreen(camera, ...scene.kin);
            expect(kin.x, frame).toBeCloseTo(anchors.kin.x, 3);
            expect(kin.y, frame).toBeLessThanOrEqual(anchors.kin.y + 1e-3);
            expect(scene.kin[1], frame).toBeGreaterThan(0);
            // The dream sun: its bearing is the composition's (give or take the sky's small wander,
            // a share of the frame's width), its height the sky's: it rides the sea line.
            const sun = world.u.sunDir.value;
            expect(sun.length(), frame).toBeCloseTo(1, 9);
            expect(sun.y, frame).toBe(world.sky.sun.height);
            expect(sun.y, frame).toBeGreaterThanOrEqual(SUN.low);
            expect(sun.y, frame).toBeLessThanOrEqual(SUN.high);
            const stood = restRay(anchors.sun.x, anchors.sun.y, aspect);
            const across = 2 * Math.atan(Math.tan((fovForAspect(aspect) * DEG) / 2) * aspect);
            const wander = Math.atan2(sun.x, -sun.z) - Math.atan2(stood[0], -stood[2]);
            expect(wander, frame).toBeCloseTo(world.sky.sun.sway * across, 9);
            expect(Math.abs(world.sky.sun.sway), frame).toBeLessThanOrEqual(SUN.sway);
            // The post's shafts stream from where it shows on screen: over the sea line, no higher
            // than a sun at its highest on that bearing, on the anchor's side of the picture.
            const far = (direction) => direction.clone().multiplyScalar(1000).add(camera.position).toArray();
            const shown = onScreen(camera, ...far(sun));
            expect(world.heart.x, frame).toBeCloseTo(shown.x, 9);
            expect(world.heart.y, frame).toBeCloseTo(shown.y, 9);
            const level = Math.hypot(sun.x, sun.z);
            const lift = Math.sqrt(1 - SUN.high * SUN.high) / level;
            const highest = onScreen(camera, ...far(new THREE.Vector3(sun.x * lift, SUN.high, sun.z * lift)));
            expect(world.heart.y, frame).toBeLessThan(horizonY(aspect));
            expect(world.heart.y, frame).toBeGreaterThanOrEqual(highest.y - 1e-9);
            expect(Math.abs(world.heart.x - anchors.sun.x), frame).toBeLessThan(0.05);
            expect(world.getPostState().heart).toBe(world.heart);
            // The board's foot: the sea just under the board, in front of the camera.
            const board = world.layout.boards[0];
            const foot = onScreen(camera, scene.foot[0], 0, scene.foot[1]);
            expect(scene.foot[1], frame).toBeLessThan(0);
            expect(foot.x, frame).toBeCloseTo((board.x0 + board.x1) / 2, 3);
            expect(foot.y, frame).toBeGreaterThan(horizonY(aspect));
            expect(foot.y, frame).toBeGreaterThanOrEqual(Math.min(board.y1, 0.975) - 1e-6);
            expect(foot.y, frame).toBeLessThan(1);
            world.dispose();
        }
    });

    it('leaves the board clear of the Great Drop in a wide frame', () => {
        for (const [width, height] of [[1600, 900], [1920, 1080], [2560, 1080]]) {
            const { camera, world } = makeWorld('Minimal', { width, height });
            world.setReducedMotion(true);
            world.updateCamera(camera, { time: 10, delta: 0 });
            const { hero, heroScale, kin } = world.choreo.scene;
            const board = world.layout.boards[0];
            // The Drop's silhouette at rest ends left of the playfield; its kin hang right of it.
            const edge = onScreen(camera, hero[0] + HERO.radius * heroScale, hero[1], hero[2]);
            expect(edge.x, `${width}x${height}`).toBeLessThan(board.x0);
            expect(onScreen(camera, ...kin).x, `${width}x${height}`).toBeGreaterThan(board.x1);
            world.dispose();
        }
    });

    it('recomposes the picture when the frame changes shape', () => {
        const { world } = makeWorld('Minimal');
        const wide = [...world.choreo.scene.hero];
        const sun = world.u.sunDir.value.clone();
        const { viewport } = world.u;
        world.setViewport(430, 932, 430 / 932);
        expect(viewport.value.toArray()).toEqual([430, 932]);
        expect(world.aspect).toBeCloseTo(430 / 932, 9);
        expect(Math.hypot(...world.choreo.scene.hero.map((v, i) => v - wide[i]))).toBeGreaterThan(1);
        expect(world.u.sunDir.value.distanceTo(sun)).toBeGreaterThan(0.01);
        expect(world.choreo.scene.heroScale).toBeLessThan(1);
        // A degenerate aspect is ignored; a degenerate buffer is still a buffer.
        const tall = [...world.choreo.scene.hero];
        world.setViewport(0, 0, NaN);
        expect(world.aspect).toBeCloseTo(430 / 932, 9);
        expect(world.choreo.scene.hero).toEqual(tall);
        expect(viewport.value.x).toBeGreaterThanOrEqual(1);
        expect(viewport.value.y).toBeGreaterThanOrEqual(1);
        world.setViewport(1200, 800, -3);
        expect(world.aspect).toBeCloseTo(430 / 932, 9);
        // The layout watch hands over the live rects, or none: the world aims at a board either way.
        world.setLayout(null);
        expect(world.getState().layoutLive).toBe(false);
        expect(world.layout.boards[0]).toBeTruthy();
        const live = fallbackLayout(1600, 900);
        world.setLayout(live, 1600 / 900);
        expect(world.getState().layoutLive).toBe(true);
        expect(world.layout).toBe(live);
        expect(world.aspect).toBeCloseTo(1600 / 900, 9);
        expect(world.choreo.scene.hero[0]).toBeCloseTo(wide[0], 9);
        world.dispose();
    });

    it('leans the view with the pointer', () => {
        const { camera, world } = makeWorld('Minimal');
        world.updateCamera(camera, {
            time: 10, delta: 0, pointerX: 0, pointerY: 0,
        });
        const rest = camera.position.clone();
        world.updateCamera(camera, {
            time: 10, delta: 0, pointerX: 1, pointerY: 0,
        });
        expect(camera.position.x).toBeGreaterThan(rest.x + 0.1);
        world.updateCamera(camera, {
            time: 10, delta: 0, pointerX: 0, pointerY: 1,
        });
        expect(camera.position.y).toBeLessThan(rest.y);
        world.dispose();
    });

    it('keeps the camera still under reduced motion, and keeps the feedback', () => {
        const { camera, world } = makeWorld('Low');
        world.setReducedMotion(true);
        expect(world.choreo.reducedMotion).toBe(true);
        run(world, camera, 3);
        const still = () => {
            expect(camera.position.toArray()).toEqual([0, REST_RIG.height, 0]);
            expect(camera.up.toArray()).toEqual([0, 1, 0]);
            expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 9);
        };
        still();
        const pose = camera.quaternion.clone();
        const spray = recordSpray(world);
        // No sway, no pointer lean, no impact punch.
        world.onLock({
            u: 0.2, rows: [8], hardDrop: true, color: '#FF2D95',
        });
        const home = [...world.choreo.scene.hero];
        world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        // Four lines drop the Drop where it hangs: it does not leap across the frame.
        expect(world.getState().site).toBeNull();
        expect(world.choreo.plunge.reach).toBe(0);
        expect(world.choreo.scene.hero).toEqual(home);
        world.onCombo(8);
        let flash = 0;
        for (let i = 0; i < 120; i++) {
            run(world, camera, 1 / 60, 1, { pointerX: 1, pointerY: -1 });
            still();
            expect(camera.quaternion.angleTo(pose)).toBeLessThan(1e-9);
            // The post gets no lens jump, and a flash no brighter than the sea's own.
            expect(world.getPostState().kick).toBe(0);
            expect(world.getPostState().flash).toBeLessThanOrEqual(world.choreo.flash);
            flash = Math.max(flash, world.getPostState().flash);
        }
        expect(flash).toBeGreaterThan(0);
        // Feedback stays: the droplets and their landings, the packet, the charge, the plunge.
        expect(world.getState().waves).toBeGreaterThan(0);
        expect(world.getState().charge).toBeGreaterThan(0.5);
        expect(spray.some((burst) => burst.kind === 'splash')).toBe(true);
        expect(spray.some((burst) => burst.kind === 'crown')).toBe(true);
        expect(world.getPostState().bloomBoost).toBeGreaterThan(0);
        // Only `true` asks for it.
        world.setReducedMotion(1);
        expect(world.reducedMotion).toBe(false);
        expect(world.choreo.reducedMotion).toBe(false);
        world.dispose();
    });
});

describe('fluid dreams world: locks', () => {
    it('sends a droplet from where the piece locked into the sea beside the card, on the piece\'s side', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [1280, 1024]]) {
            const frame = `${width}x${height}`;
            const { camera, world } = makeWorld('Low', { width, height });
            const locks = recordLocks(world);
            const card = cardUnion(world.layout);
            const board = world.layout.boards[0];
            const sea = horizonY(width / height);
            for (let i = 0; i < 24; i++) {
                const left = i % 2 === 0;
                const u = left ? 0.05 + 0.03 * (i % 5) : 0.95 - 0.03 * (i % 5);
                const row = 2 + (i % 6);
                world.onLock({ u, rows: [row], color: '#00E5FF' });
                const lock = locks[locks.length - 1];
                // It lands on the sea, in view, beside the card on the side the piece locked.
                const land = onScreen(camera, lock.to[0], 0, lock.to[1]);
                expect(land.depth, frame).toBeLessThan(1);
                if (left) {
                    expect(land.x, frame).toBeLessThan(card.x0);
                    expect(land.x, frame).toBeGreaterThan(0);
                    expect(lock.to[0], frame).toBeLessThan(world.choreo.scene.foot[0]);
                } else {
                    expect(land.x, frame).toBeGreaterThan(card.x1);
                    expect(land.x, frame).toBeLessThan(1);
                    expect(lock.to[0], frame).toBeGreaterThan(world.choreo.scene.foot[0]);
                }
                expect(land.y, frame).toBeGreaterThan(sea);
                expect(land.y, frame).toBeLessThan(1);
                // Out on the water: never at the viewer's feet.
                expect(Math.hypot(lock.to[0] - camera.position.x, lock.to[1] - camera.position.z), frame)
                    .toBeGreaterThan(REST_RIG.height * 2);
                // It leaves the card on the lock's own view ray, in front of the camera.
                const start = boardPoint(board, u, row);
                const from = onScreen(camera, ...lock.from);
                expect(from.depth, frame).toBeLessThan(1);
                expect(from.x, frame).toBeCloseTo(start.x, 3);
                expect(from.y, frame).toBeCloseTo(start.y, 3);
                expect(lock.color).toEqual(pieceColor('#00E5FF'));
                expect(lock.hardDrop).toBe(false);
                run(world, camera, 0.05, 3);
            }
            expect(locks).toHaveLength(24);
            // No two land on the same spot.
            expect(new Set(locks.map((lock) => lock.to.map((v) => v.toFixed(3)).join())).size).toBe(24);
            world.dispose();
        }
    });

    it('flies the droplet on that side and leaves its colour in the sea', () => {
        const { camera, world } = makeWorld('Low');
        const spray = recordSpray(world);
        world.onLock({ u: 0.1, rows: [12], color: '#B14CFF' });
        run(world, camera, 1 / 60, 1);
        expect(world.getState().balls[GROUP_LEFT]).toBe(1);
        expect(world.getState().balls[GROUP_RIGHT]).toBe(0);
        world.onLock({ u: 0.9, rows: [12], color: '#FFD93D' });
        run(world, camera, 1 / 60, 1);
        expect(world.getState().balls[GROUP_RIGHT]).toBe(1);
        expect(world.getState().stains).toBe(0);
        run(world, camera, FLIGHT_TIME + 0.1);
        expect(world.getState().stains).toBe(2);
        // The choreography's bursts reach the spray pool, stamped with its clock.
        const splashes = spray.filter((burst) => burst.kind === 'splash');
        expect(splashes).toHaveLength(2);
        expect(splashes[0].color).toEqual(pieceColor('#B14CFF'));
        expect(splashes[1].color).toEqual(pieceColor('#FFD93D'));
        for (const burst of spray) {
            expect(Number.isFinite(burst.time), burst.kind).toBe(true);
            expect(burst.time, burst.kind).toBeLessThanOrEqual(world.u.time.value);
            expect(SPRAY_KINDS[burst.kind], burst.kind).toBeTruthy();
        }
        expect(thrown(world.parts.spray)).toBeGreaterThan(0);
        expect(world.u.counts.value.y).toBe(2);
        // And it all comes to rest: only the stains stay.
        run(world, camera, JET_TIME * 2);
        expect(world.choreo.isBusy()).toBe(false);
        expect(world.getState().balls[GROUP_LEFT] + world.getState().balls[GROUP_RIGHT]).toBe(0);
        expect(world.getState().stains).toBe(2);
        world.dispose();
    });

    it('hits harder on a hard drop, kicks the lens, and takes the valley\'s own colour when a piece has none', () => {
        const soft = makeWorld('Low');
        const hard = makeWorld('Low');
        const softLocks = recordLocks(soft.world);
        const hardLocks = recordLocks(hard.world);
        const softSpray = recordSpray(soft.world);
        const hardSpray = recordSpray(hard.world);
        const splashes = (spray) => spray.filter((burst) => burst.kind === 'splash').length;
        soft.world.onLock({ u: 0.3, rows: [10] });
        hard.world.onLock({ u: 0.3, rows: [10], hardDrop: true });
        expect(softLocks[0].hardDrop).toBe(false);
        expect(hardLocks[0].hardDrop).toBe(true);
        // The same lock aims at the same place.
        expect(hardLocks[0].to).toEqual(softLocks[0].to);
        // A lock without a colour still flies, in a colour of the theme's.
        expect(softLocks[0].color).toEqual(pieceColor(undefined));
        expect(softLocks[0].color.every((channel) => channel > 0 && channel <= 1)).toBe(true);
        const { fov } = hard.camera;
        run(soft.world, soft.camera, 1 / 60, 1);
        run(hard.world, hard.camera, 1 / 60, 1);
        expect(hard.world.getPostState().kick).toBeGreaterThan(soft.world.getPostState().kick);
        expect(hard.world.getPostState().kick).toBeGreaterThan(0);
        run(hard.world, hard.camera, 1 / 60, 1);
        expect(hard.camera.fov).toBeLessThan(fov);
        run(soft.world, soft.camera, FLIGHT_TIME * 2);
        run(hard.world, hard.camera, FLIGHT_TIME * 2);
        // One droplet lands for a lock, three for a hard drop.
        expect(splashes(softSpray)).toBe(1);
        expect(splashes(hardSpray)).toBe(3);
        expect(soft.world.getState().stains).toBe(1);
        expect(hard.world.getState().stains).toBeGreaterThanOrEqual(1);
        // The punch passes: the lens comes back.
        run(hard.world, hard.camera, 4);
        expect(hard.camera.fov).toBeCloseTo(fov, 3);
        soft.world.dispose();
        hard.world.dispose();
    });

    it('alternates sides for a piece locked in the middle of the board', () => {
        const { camera, world } = makeWorld('Low');
        const locks = recordLocks(world);
        const card = cardUnion(world.layout);
        const sides = [];
        for (let i = 0; i < 6; i++) {
            world.onLock({ u: 0.5, rows: [15] });
            const land = onScreen(camera, locks[i].to[0], 0, locks[i].to[1]);
            sides.push(land.x < card.x0 ? -1 : 1);
            expect(land.x < card.x0 || land.x > card.x1).toBe(true);
        }
        for (let i = 1; i < sides.length; i++) expect(sides[i]).toBe(-sides[i - 1]);
        world.dispose();
    });

    it('lands under the card when there is no sea beside it: a phone\'s card, a row of boards', () => {
        const wideCard = {
            x0: 0.04, y0: 0.08, x1: 0.96, y1: 0.8,
        };
        const phone = layoutOf([wideCard], [{
            x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.78,
        }]);
        const row = layoutOf([
            {
                x0: 0.03, y0: 0.2, x1: 0.33, y1: 0.82,
            },
            {
                x0: 0.35, y0: 0.2, x1: 0.65, y1: 0.82,
            },
            {
                x0: 0.67, y0: 0.2, x1: 0.97, y1: 0.82,
            },
        ], [null, {
            x0: 0.06, y0: 0.3, x1: 0.3, y1: 0.8,
        }, {
            x0: 0.38, y0: 0.3, x1: 0.62, y1: 0.8,
        }, {
            x0: 0.7, y0: 0.3, x1: 0.94, y1: 0.8,
        }]);
        for (const [label, layout, width, height, player] of [
            ['phone', phone, 430, 932, 0], ['row of boards', row, 1920, 1080, 2],
        ]) {
            const { camera, world } = makeWorld('Low', { width, height, layout });
            const locks = recordLocks(world);
            const card = cardUnion(layout);
            const board = layout.boards[player];
            const landings = { left: [], right: [] };
            for (let i = 0; i < 16; i++) {
                const left = i % 2 === 0;
                world.onLock({ u: left ? 0.1 : 0.9, rows: [6], player });
                const land = onScreen(camera, locks[i].to[0], 0, locks[i].to[1]);
                expect(land.depth, label).toBeLessThan(1);
                // On the sea under the card's foot, in view.
                expect(land.y, label).toBeGreaterThan(card.y1);
                expect(land.y, label).toBeLessThan(1);
                expect(land.x, label).toBeGreaterThanOrEqual(-1e-6);
                expect(land.x, label).toBeLessThanOrEqual(1 + 1e-6);
                landings[left ? 'left' : 'right'].push(land.x);
                // It still leaves from the piece, on the board that played it.
                const from = onScreen(camera, ...locks[i].from);
                const start = boardPoint(board, left ? 0.1 : 0.9, 6);
                expect(from.x, label).toBeCloseTo(start.x, 3);
                expect(from.y, label).toBeCloseTo(start.y, 3);
            }
            // Under the board that played it, the piece's side of it.
            const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
            expect(mean(landings.left), label).toBeLessThan(mean(landings.right));
            expect(mean(landings.left), label).toBeGreaterThan(board.x0 - 0.2);
            expect(mean(landings.right), label).toBeLessThan(board.x1 + 0.2);
            world.dispose();
        }
    });

    it('starts the droplet at the click when a mode supplies a screen position, and needs a camera to aim', () => {
        const { camera, world } = makeWorld('Low', { live: false });
        const locks = recordLocks(world);
        expect(world.getState().layoutLive).toBe(false);
        world.onLock({ screen: { x: 0.2, y: 0.3 }, color: '#FFA84C' });
        const from = onScreen(camera, ...locks[0].from);
        expect(from.x).toBeCloseTo(0.2, 3);
        expect(from.y).toBeCloseTo(0.3, 3);
        // With no board on screen a lock still lands where the solo board would stand.
        world.onLock({ u: 0.9, rows: [19] });
        expect(locks).toHaveLength(2);
        expect(locks[1].to.every(Number.isFinite)).toBe(true);
        expect(locks[1].from[1]).toBeGreaterThan(0); // never from under the sea
        // Nonsense is a lock in the middle of the board, on its floor.
        expect(() => world.onLock({})).not.toThrow();
        expect(() => world.onLock({ u: NaN, rows: [] })).not.toThrow();
        expect(locks).toHaveLength(4);
        for (const lock of locks) expect([...lock.from, ...lock.to].every(Number.isFinite)).toBe(true);
        // Before a camera is bound there is nothing to aim through.
        const unbound = new FluidDreamsWorld({ scene: new THREE.Scene(), quality: 'Minimal' }).build();
        const none = recordLocks(unbound);
        unbound.onLock({ u: 0.3 });
        unbound.onClear({ lines: 2 });
        expect(none).toHaveLength(0);
        unbound.dispose();
        world.dispose();
    });
});

describe('fluid dreams world: clears, combos and levels', () => {
    it('sends the packet from the sea under the board and pours the cleared rows out of the card', () => {
        const { camera, world } = makeWorld('Low');
        atRest(world, camera);
        const clears = recordClears(world);
        const spray = recordSpray(world);
        const card = cardUnion(world.layout);
        const board = world.layout.boards[0];
        world.onClear({ rows: [19, 18], lines: 2 });
        expect(clears).toHaveLength(1);
        expect(clears[0]).toMatchObject({ lines: 2, twist: false, perfect: false });
        // The packet leaves the foot of the board.
        const origin = onScreen(camera, clears[0].origin[0], 0, clears[0].origin[1]);
        expect(origin.x).toBeCloseTo(0.5, 3);
        expect(origin.y).toBeGreaterThan(board.y1 - 0.02);
        expect(origin.y).toBeLessThan(1);
        expect(clears[0].origin[0]).toBeCloseTo(world.choreo.scene.foot[0], 6);
        expect(clears[0].origin[1]).toBeCloseTo(world.choreo.scene.foot[1], 6);
        // Each cleared row pours out of both sides of the card, at the row's height, outward.
        const pours = spray.filter((burst) => burst.kind === 'pour');
        expect(pours).toHaveLength(4);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        [19, 18].forEach((row, i) => {
            const rowY = boardPoint(board, 0.5, row).y;
            const [leftPour, rightPour] = pours.slice(i * 2, i * 2 + 2);
            const leftAt = onScreen(camera, leftPour.x, leftPour.y, leftPour.z);
            const rightAt = onScreen(camera, rightPour.x, rightPour.y, rightPour.z);
            expect(leftAt.x).toBeCloseTo(card.x0, 2);
            expect(rightAt.x).toBeCloseTo(card.x1, 2);
            // (A row low on the board is lifted to stay above the sea.)
            expect(leftAt.y).toBeLessThanOrEqual(rowY + 1e-3);
            expect(rightAt.y).toBeLessThanOrEqual(rowY + 1e-3);
            expect(leftPour.y).toBeGreaterThan(0);
            expect(leftPour.dir[0]).toBeCloseTo(-right.x, 9);
            expect(leftPour.dir[1]).toBeCloseTo(-right.z, 9);
            expect(rightPour.dir[0]).toBeCloseTo(right.x, 9);
            expect(rightPour.dir[0]).toBeGreaterThan(0.9); // away from the card
        });
        for (const pour of pours) {
            expect(pour.time).toBe(world.u.time.value);
            expect(pour.power).toBeGreaterThan(0);
            expect(pour.color).toEqual(world.palette.horizon);
        }
        expect(thrown(world.parts.spray)).toBeGreaterThan(0);
        run(world, camera, 0.2);
        expect(world.getState().waves).toBe(1);
        world.dispose();
    });

    it('pours a row high on the board from exactly its height', () => {
        const { camera, world } = makeWorld('Low');
        const spray = recordSpray(world);
        const board = world.layout.boards[0];
        const card = cardUnion(world.layout);
        world.onClear({ rows: [3], lines: 1 });
        const pours = spray.filter((burst) => burst.kind === 'pour');
        expect(pours).toHaveLength(2);
        const rowY = boardPoint(board, 0.5, 3).y;
        pours.forEach((pour, side) => {
            const at = onScreen(camera, pour.x, pour.y, pour.z);
            expect(at.x).toBeCloseTo(side === 0 ? card.x0 : card.x1, 3);
            expect(at.y).toBeCloseTo(rowY, 3);
        });
        world.dispose();
    });

    it('pours harder and in dreamfire for four lines, and from the floor row when no rows are named', () => {
        const { camera, world } = makeWorld('Low');
        const clears = recordClears(world);
        const spray = recordSpray(world);
        world.onClear({ lines: 1 });
        expect(spray.filter((burst) => burst.kind === 'pour')).toHaveLength(2);
        const single = spray[0];
        const floorY = boardPoint(world.layout.boards[0], 0.5, BOARD_GRID.rows - 1).y;
        expect(onScreen(camera, single.x, single.y, single.z).y).toBeLessThanOrEqual(floorY + 1e-3);
        spray.length = 0;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const pours = spray.filter((burst) => burst.kind === 'pour');
        expect(pours).toHaveLength(8);
        for (const pour of pours) {
            expect(pour.color).toEqual([...DREAMFIRE]);
            expect(pour.power).toBeGreaterThan(single.power);
        }
        // More rows than a piece can clear: four pour, no more.
        spray.length = 0;
        world.onClear({ rows: [19, 18, 17, 16, 15, 14], lines: 9 });
        expect(spray.filter((burst) => burst.kind === 'pour')).toHaveLength(8);
        // The line count is clamped to what a piece can clear; none named is one.
        world.onClear({});
        world.onClear({ lines: 2.4, twist: true, perfect: true });
        expect(clears.map((clear) => clear.lines)).toEqual([1, 4, 4, 1, 2]);
        expect(clears[4]).toMatchObject({ twist: true, perfect: true });
        expect(clears[3]).toMatchObject({ twist: false, perfect: false });
        world.dispose();
    });

    it('leaves each local-multiplayer board\'s packet from under that board', () => {
        const layout = layoutOf([
            {
                x0: 0.05, y0: 0.15, x1: 0.45, y1: 0.85,
            },
            {
                x0: 0.55, y0: 0.15, x1: 0.95, y1: 0.85,
            },
        ], [null, {
            x0: 0.1, y0: 0.25, x1: 0.4, y1: 0.8,
        }, {
            x0: 0.6, y0: 0.25, x1: 0.9, y1: 0.8,
        }]);
        const { camera, world } = makeWorld('Low', { layout });
        atRest(world, camera);
        const clears = recordClears(world);
        world.onClear({ lines: 1, rows: [19], player: 1 });
        world.onClear({ lines: 1, rows: [19], player: 2 });
        const first = onScreen(camera, clears[0].origin[0], 0, clears[0].origin[1]);
        const second = onScreen(camera, clears[1].origin[0], 0, clears[1].origin[1]);
        expect(first.x).toBeCloseTo(0.25, 3);
        expect(second.x).toBeCloseTo(0.75, 3);
        expect(clears[0].origin[0]).toBeLessThan(clears[1].origin[0]);
        // A board that is not on screen clears as the first board that is.
        world.onClear({ lines: 1, rows: [19], player: 4 });
        expect(clears[2].origin).toEqual(clears[0].origin);
        world.dispose();
    });

    it('pours a board\'s rows out of the card that holds it, not out of the row of cards', () => {
        const cards = [
            {
                x0: 0.05, y0: 0.15, x1: 0.45, y1: 0.85,
            },
            {
                x0: 0.55, y0: 0.15, x1: 0.95, y1: 0.85,
            },
        ];
        const boards = [null, {
            x0: 0.1, y0: 0.25, x1: 0.4, y1: 0.8,
        }, {
            x0: 0.6, y0: 0.25, x1: 0.9, y1: 0.8,
        }];
        const { camera, world } = makeWorld('Low', { layout: layoutOf(cards, boards) });
        atRest(world, camera);
        const spray = recordSpray(world);
        for (const player of [1, 2]) {
            spray.length = 0;
            world.onClear({ lines: 1, rows: [4], player });
            const pours = spray.filter((burst) => burst.kind === 'pour');
            expect(pours).toHaveLength(2);
            const card = cards[player - 1];
            const rowY = boardPoint(boards[player], 0.5, 4).y;
            const [leftAt, rightAt] = pours.map((pour) => onScreen(camera, pour.x, pour.y, pour.z));
            // Its own card's two sides, at the row's height: never the far side of the other board.
            expect(leftAt.x, `player ${player}`).toBeCloseTo(card.x0, 3);
            expect(rightAt.x, `player ${player}`).toBeCloseTo(card.x1, 3);
            expect(leftAt.y, `player ${player}`).toBeCloseTo(rowY, 3);
            expect(rightAt.y, `player ${player}`).toBeCloseTo(rowY, 3);
            expect(pours[0].dir[0]).toBeLessThan(0);
            expect(pours[1].dir[0]).toBeGreaterThan(0);
        }
        // A board no card holds (a layout read mid-transition) pours from round all the cards.
        world.setLayout(layoutOf(cards, [{
            x0: 0.46, y0: 0.88, x1: 0.54, y1: 0.98,
        }]), 1600 / 900);
        atRest(world, camera);
        spray.length = 0;
        world.onClear({ lines: 1, rows: [4] });
        const outer = spray.filter((burst) => burst.kind === 'pour')
            .map((pour) => onScreen(camera, pour.x, pour.y, pour.z));
        expect(outer).toHaveLength(2);
        expect(outer[0].x).toBeCloseTo(0.05, 2);
        expect(outer[1].x).toBeCloseTo(0.95, 2);
        world.dispose();
    });

    it('starts a click\'s packet in the sea under the click, and pours nothing out of thin air', () => {
        const sea = horizonY(1600 / 900);
        for (const live of [false, true]) {
            const { camera, world } = makeWorld('Low', { live });
            atRest(world, camera);
            const clears = recordClears(world);
            const spray = recordSpray(world);
            const clicks = [{ x: 0.15, y: 0.9 }, { x: 0.85, y: 0.8 }, { x: 0.3, y: 0.2 }];
            const reach = [];
            for (const click of clicks) {
                world.onClear({ lines: 1, rows: [], screen: click });
                const { origin } = clears[clears.length - 1];
                const at = onScreen(camera, origin[0], 0, origin[1]);
                const label = `live ${live}, click ${click.x},${click.y}`;
                expect(origin.every(Number.isFinite), label).toBe(true);
                expect(at.depth, label).toBeLessThan(1);
                // Under the click...
                expect(at.x, label).toBeCloseTo(click.x, 3);
                if (click.y > sea + 0.15) expect(at.y, label).toBeCloseTo(click.y, 3);
                // ...or, for a click in the sky, out on the sea beneath it.
                expect(at.y, label).toBeGreaterThan(sea);
                expect(at.y, label).toBeLessThan(1);
                reach.push(Math.hypot(origin[0] - camera.position.x, origin[1] - camera.position.z));
            }
            expect(clears[0].origin[0]).toBeLessThan(clears[1].origin[0]);
            expect(reach[2]).toBeGreaterThan(reach[0]);
            expect(reach[2]).toBeGreaterThan(reach[1]);
            // A click is not a row of a board: nothing pours, board or no board.
            expect(spray.filter((burst) => burst.kind === 'pour')).toHaveLength(0);
            // The packets themselves do run.
            run(world, camera, 0.2);
            expect(world.getState().waves).toBeGreaterThan(0);
            world.dispose();
        }
    });

    it('pours rows only out of a card that is really on screen', () => {
        const { camera, world } = makeWorld('Low', { live: false });
        const clears = recordClears(world);
        const spray = recordSpray(world);
        const pours = () => spray.filter((burst) => burst.kind === 'pour').length;
        expect(world.getState().layoutLive).toBe(false);
        // No board on screen: the packet still leaves where the solo board would stand...
        world.onClear({ lines: 2, rows: [19, 18] });
        world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        expect(clears).toHaveLength(2);
        expect(clears[0].origin[0]).toBeCloseTo(world.choreo.scene.foot[0], 9);
        expect(clears[0].origin[1]).toBeCloseTo(world.choreo.scene.foot[1], 9);
        // ...but no rows pour out of a card that is not there.
        expect(pours()).toBe(0);
        // The board comes on screen: now they do.
        world.setLayout(fallbackLayout(1600, 900), 1600 / 900);
        world.onClear({ lines: 2, rows: [19, 18] });
        expect(pours()).toBe(4);
        // And it leaves again.
        world.setLayout(null);
        world.onClear({ lines: 2, rows: [19, 18] });
        expect(pours()).toBe(4);
        run(world, camera, 0.2);
        expect(world.getState().waves).toBeGreaterThan(0);
        world.dispose();
    });

    it('drops the Great Drop on four lines and tells the post about it', () => {
        const { camera, world } = makeWorld('High');
        const spray = recordSpray(world);
        const rest = { ...world.getPostState() };
        expect(rest).toMatchObject({
            flash: 0, kick: 0, bloomBoost: 0, exposure: 1,
        });
        expect(rest.shafts).toBeGreaterThan(0);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(world.choreo.isBusy()).toBe(true);
        // It is carried somewhere new, so it leaps there: a longer fall than a straight drop.
        expect(world.getState().site).not.toBeNull();
        const { fall } = world.choreo.plunge;
        expect(fall).toBeGreaterThan(PLUNGE.fall);
        // The breath it holds dims the picture a little.
        run(world, camera, HUSH_HOLD * 0.9);
        expect(world.getPostState().exposure).toBeLessThan(1);
        expect(world.getPostState().exposure).toBeGreaterThan(0.5);
        expect(world.u.swell.value).toBeLessThan(1);
        expect(spray.some((burst) => burst.kind === 'crown')).toBe(false);
        // The Drop meets the sea: the crown, the flash, the shafts, the overdrive.
        run(world, camera, HUSH_HOLD * 0.1 + fall * 0.9);
        const falling = { ...world.getPostState() };
        run(world, camera, fall * 0.1 + 2 / 60);
        const crowns = spray.filter((burst) => burst.kind === 'crown');
        expect(crowns).toHaveLength(1);
        // Under its new home, give or take the idle sway it fell with (well inside its own
        // footprint), and where the thread will stand again.
        expect(Math.hypot(crowns[0].x - world.choreo.scene.hero[0], crowns[0].z - world.choreo.scene.hero[2]))
            .toBeLessThan(HERO.radius * 0.5);
        expect(Math.hypot(crowns[0].x - world.u.hero.value.x, crowns[0].z - world.u.hero.value.z))
            .toBeLessThan(0.05);
        expect(crowns[0].color).toEqual([...DREAMFIRE]);
        // What the crown throws is spray of a kind the pool knows; later it comes back down as rain.
        for (const burst of spray) expect(SPRAY_KINDS[burst.kind], burst.kind).toBeTruthy();
        const post = world.getPostState();
        expect(post.flash).toBeGreaterThan(falling.flash);
        expect(post.kick).toBeGreaterThan(falling.kick);
        expect(post.bloomBoost).toBeGreaterThan(rest.bloomBoost);
        expect(post.shafts).toBeGreaterThan(rest.shafts);
        expect(world.u.surge.value).toBeGreaterThan(0);
        expect(world.u.stemShape.value.w).toBeGreaterThan(0); // the thread is out of the field
        expect(world.u.hero.value.y).toBeLessThan(0);
        expect(world.u.skyFlash.value).toBeGreaterThan(0);
        expect(world.getState().waves).toBe(2);
        // A ring of split light opens from where the Drop hung.
        run(world, camera, 0.3);
        expect(world.u.prism.value.y).toBeGreaterThan(0);
        const toHero = new THREE.Vector3(...world.choreo.scene.hero).sub(camera.position).normalize();
        expect(world.u.heroDir.value.distanceTo(toHero)).toBeLessThan(1e-6);
        // And it comes back, and the picture cools to its resting look.
        run(world, camera, PLUNGE.total);
        expect(world.choreo.isBusy()).toBe(false);
        expect(world.u.stemShape.value.w).toBe(0);
        expect(world.u.hero.value.y).toBeGreaterThan(0);
        expect(spray.some((burst) => burst.kind === 'rain')).toBe(true);
        for (const burst of spray) {
            expect(SPRAY_KINDS[burst.kind], burst.kind).toBeTruthy();
            expect(burst.time, burst.kind).toBeLessThanOrEqual(world.u.time.value);
        }
        run(world, camera, 30, 600);
        expect(world.u.prism.value.y).toBe(0);
        const cooled = world.getPostState();
        expect(cooled.flash).toBeLessThan(1e-6);
        expect(cooled.kick).toBeLessThan(1e-6);
        expect(cooled.exposure).toBeCloseTo(1, 6);
        expect(cooled.bloomBoost).toBeCloseTo(rest.bloomBoost, 3);
        expect(cooled.shafts).toBeCloseTo(rest.shafts, 3);
        expect(world.u.swell.value).toBeCloseTo(1, 3);
        world.dispose();
    });

    it('carries the Great Drop somewhere new on every four-line clear, never behind the board', () => {
        for (const [width, height] of [[1600, 900], [1920, 1080], [2560, 1080], [1600, 769]]) {
            const frame = `${width}x${height}`;
            const { camera, world } = makeWorld('Minimal', { width, height });
            const aspect = width / height;
            const layout = fallbackLayout(width, height);
            const card = layout.cards[0];
            const middle = (card.x0 + card.x1) / 2;
            const sides = { left: 0, right: 0 };
            let before = [...world.choreo.scene.hero];
            for (let i = 0; i < 10; i++) {
                const label = `${frame}, clear ${i + 1}`;
                world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
                const { site } = world.getState();
                expect(site, label).not.toBeNull();
                const home = [...world.choreo.scene.hero];
                // It travels: far enough that the move reads.
                const moved = Math.hypot(home[0] - before[0], home[1] - before[1], home[2] - before[2]);
                expect(moved, label).toBeGreaterThanOrEqual(SITE.move * HERO.radius * world.choreo.scene.heroScale);
                // Its whole silhouette (lobes and all, drawn wider off to the side) clears the card,
                // the stats bar and the frame.
                const r = SITE.footprint * HERO.radius * world.choreo.scene.heroScale;
                const box = restBounds(...home, r, aspect);
                expect(box, label).not.toBeNull();
                expect(box[0], label).toBeGreaterThan(0);
                expect(box[2], label).toBeLessThan(1);
                expect(box[1], label).toBeGreaterThan(0);
                for (const rect of [card, layout.hud]) {
                    const apart = box[2] < rect.x0 || box[0] > rect.x1 || box[3] < rect.y0 || box[1] > rect.y1;
                    expect(apart, `${label}: clear of ${JSON.stringify(rect)}`).toBe(true);
                }
                // Its thread stands in open sea, and it is no lower than the thread needs.
                expect(home[1] - HERO.radius * world.choreo.scene.heroScale, label).toBeGreaterThan(1);
                const centre = restProject(...home, aspect);
                sides[centre[0] < middle ? 'left' : 'right'] += 1;
                // Its kin keep to the other side of the board.
                const kin = restProject(...world.choreo.scene.kin, aspect);
                expect(kin[0] < middle, label).toBe(centre[0] >= middle);
                // It dives in there and comes up there.
                const spray = recordSpray(world);
                run(world, camera, HUSH_HOLD + world.choreo.plunge.total + 0.2);
                const [crown] = spray.filter((burst) => burst.kind === 'crown');
                expect(Math.hypot(crown.x - home[0], crown.z - home[2]), label).toBeLessThan(HERO.radius * 0.5);
                expect(world.choreo.isBusy(), label).toBe(false);
                expect(Math.hypot(world.u.hero.value.x - home[0], world.u.hero.value.z - home[2]), label)
                    .toBeLessThan(0.6);
                vi.restoreAllMocks();
                before = home;
            }
            // It does not keep to one side.
            expect(sides.left, frame).toBeGreaterThanOrEqual(2);
            expect(sides.right, frame).toBeGreaterThanOrEqual(2);
            world.dispose();
        }
    });

    it('lets the kin drift over to make room instead of jumping', () => {
        const { camera, world } = makeWorld('Minimal');
        // the largest of the kin (it does not bob sideways: its x is where the kin are)
        const kinX = () => world.choreo.tables.balls[GROUP_START[GROUP_KIN] * 2].x;
        let crossings = 0;
        for (let i = 0; i < 10; i++) {
            const anchor = [...world.choreo.scene.kin];
            world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
            const target = [...world.choreo.scene.kin];
            if (Math.abs(target[0] - anchor[0]) < 1) {
                run(world, camera, 7);
                continue;
            }
            crossings += 1;
            // Their anchor went across the board; they set off from where they floated...
            let last = kinX();
            expect(Math.abs(last - anchor[0])).toBeLessThan(0.1); // (still settling from the last time)
            let step = 0;
            for (let k = 0; k < 12 * 60; k++) {
                run(world, camera, 1 / 60, 1);
                step = Math.max(step, Math.abs(kinX() - last));
                last = kinX();
            }
            // ...drift (never a jump, at 60 fps)...
            expect(step).toBeGreaterThan(0.02);
            expect(step).toBeLessThan(0.4);
            // ...and are there a few seconds later.
            expect(Math.abs(kinX() - target[0])).toBeLessThan(0.1);
        }
        expect(crossings).toBeGreaterThanOrEqual(2);
        // A seek stands them at their anchor at once.
        world.seek(30);
        world.update({ time: 30, delta: 0 }, camera);
        expect(kinX()).toBeCloseTo(world.choreo.scene.kin[0], 9);
        world.dispose();
    });

    it('lets a Drop that cannot be moved fall where it hangs: a frame with no open sea', () => {
        const { camera, world } = makeWorld('Minimal');
        const anchor = [...world.choreo.scene.hero];
        // One card across the whole frame: nowhere to go.
        const wall = {
            x0: 0.01, y0: 0.01, x1: 0.99, y1: 0.99,
        };
        world.setLayout(layoutOf([wall], [wall]), 16 / 9);
        expect(world.choreo.scene.hero).toEqual(anchor);
        const spray = recordSpray(world);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(world.getState().site).toBeNull();
        expect(world.choreo.plunge.reach).toBe(0);
        expect(world.choreo.plunge.fall).toBe(PLUNGE.fall);
        run(world, camera, HUSH_HOLD + PLUNGE.total + 0.2);
        const [crown] = spray.filter((burst) => burst.kind === 'crown');
        expect(Math.hypot(crown.x - anchor[0], crown.z - anchor[2])).toBeLessThan(HERO.radius * 0.5);
        expect(world.choreo.scene.hero).toEqual(anchor);
        world.dispose();
    });

    it('keeps the Drop where it was carried through a new run, and stands it home again on a seek', () => {
        const { camera, world } = makeWorld('Minimal');
        const home = [...world.choreo.scene.hero];
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        run(world, camera, HUSH_HOLD + world.choreo.plunge.total + 0.2);
        const carried = [...world.choreo.scene.hero];
        expect(Math.hypot(carried[0] - home[0], carried[2] - home[2])).toBeGreaterThan(1);
        // A new run: the sea goes back to rest, the picture stays where it stood.
        world.resetSession();
        run(world, camera, 0.5);
        expect(world.choreo.scene.hero).toEqual(carried);
        expect(world.getState().site).not.toBeNull();
        // The frame changes shape and there is no room where it was: it is stood up at home.
        const wall = {
            x0: 0.01, y0: 0.01, x1: 0.99, y1: 0.99,
        };
        world.setLayout(layoutOf([wall], [wall]), 16 / 9);
        expect(world.getState().site).toBeNull();
        expect(world.choreo.scene.hero).toEqual(home);
        // A seek (a capture) starts its travels over: the same clear sends it to the same place.
        world.setLayout(fallbackLayout(1600, 900), 1600 / 900);
        world.seek(10);
        expect(world.choreo.scene.hero).toEqual(home);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(world.choreo.scene.hero).toEqual(carried);
        world.dispose();
    });

    it('charges the sea to the chain, and lets it go when the chain breaks', () => {
        const { camera, world } = makeWorld('Low');
        const rest = { ...world.getPostState() };
        const body = world.getState().balls[GROUP_HERO];
        expect(world.combo).toBe(0);
        world.onCombo(3);
        expect(world.combo).toBe(3);
        run(world, camera, 8);
        expect(world.getState()).toMatchObject({ combo: 3, charge: Number(powerForCombo(3).toFixed(3)) });
        expect(world.u.charge.value).toBeCloseTo(powerForCombo(3), 3);
        // One satellite for each step of the chain, as many as the tier raises.
        expect(world.getState().balls[GROUP_HERO] - body).toBe(Math.min(3, QUALITY.Low.satellites));
        expect(world.getPostState().bloomBoost).toBeGreaterThan(rest.bloomBoost);
        expect(world.getPostState().shafts).toBeGreaterThan(rest.shafts);
        expect(world.u.hero.value.w).toBeGreaterThan(HERO.radius);
        world.onCombo(99);
        run(world, camera, 8);
        expect(world.getState().balls[GROUP_HERO] - body).toBe(QUALITY.Low.satellites);
        expect(world.u.charge.value).toBeLessThanOrEqual(1);
        world.onCombo(0);
        run(world, camera, 25, 500);
        expect(world.getState().balls[GROUP_HERO]).toBe(body);
        expect(world.u.charge.value).toBeLessThan(0.01);
        expect(world.getPostState().bloomBoost).toBeLessThan(0.01);
        // Nonsense is no chain.
        world.onCombo(NaN);
        expect(world.combo).toBe(0);
        world.onCombo(-4);
        expect(world.combo).toBe(0);
        world.onCombo('3');
        expect(world.combo).toBe(3);
        world.dispose();
    });

    it('changes the sea\'s colours with the level and cycles through its palettes', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({ level: 1, palette: FLUID_PALETTES[0].name });
        const before = world.u.horizon.value.clone();
        world.levelUp(2);
        expect(world.getState()).toMatchObject({ level: 2, palette: FLUID_PALETTES[1].name });
        // The sea marks it: a packet leaves the foot of the board, with a breath of light.
        run(world, camera, 1 / 60, 1);
        expect(world.getState().waves).toBe(1);
        expect(world.getPostState().flash).toBeGreaterThan(0);
        expect(world.u.skyFlash.value).toBeGreaterThan(0);
        // The colours ease across, they do not snap.
        const target = new THREE.Vector3(...FLUID_PALETTES[1].horizon);
        const whole = before.distanceTo(target);
        expect(whole).toBeGreaterThan(0.1);
        const moved = world.u.horizon.value.distanceTo(before);
        expect(moved).toBeGreaterThan(0);
        expect(moved).toBeLessThan(whole * 0.25);
        run(world, camera, 30, 600);
        // (on top of the clock's turn by now)
        const second = paletteAt(1 + dreamDrift(world.time));
        for (const key of PALETTE_KEYS) {
            expect(world.u[key].value.distanceTo(new THREE.Vector3(...second[key])), key).toBeLessThan(1e-3);
        }
        // Past the last palette it starts again.
        for (let level = 1; level <= FLUID_PALETTES.length * 2 + 1; level++) {
            world.levelUp(level);
            expect(world.getState().palette).toBe(FLUID_PALETTES[(level - 1) % FLUID_PALETTES.length].name);
        }
        // A capture rests on a level's palette at once, without the sea marking it.
        run(world, camera, 10, 200);
        const clears = vi.spyOn(world.choreo, 'levelUp');
        world.levelUp(3, { silent: true });
        expect(clears).not.toHaveBeenCalled();
        world.update({ time: world.u.time.value, delta: 0 }, camera);
        expect(world.getState()).toMatchObject({ level: 3, palette: FLUID_PALETTES[2].name });
        const third = paletteAt(2 + dreamDrift(world.time));
        for (const key of PALETTE_KEYS) {
            expect(world.u[key].value.distanceTo(new THREE.Vector3(...third[key])), key).toBeLessThan(1e-9);
        }
        // Nonsense is level one.
        world.levelUp(NaN);
        expect(world.getState().level).toBe(1);
        world.levelUp(-3);
        expect(world.getState().level).toBe(1);
        world.dispose();
    });

    it('turns through its palettes by the clock alone, a level a step on top', () => {
        const { camera, world } = makeWorld('Low');
        const count = FLUID_PALETTES.length;
        const expectPalette = (index, label) => {
            for (const key of PALETTE_KEYS) {
                const want = new THREE.Vector3(...FLUID_PALETTES[index][key]);
                expect(world.u[key].value.distanceTo(want), `${label} ${key}`).toBeLessThan(1e-9);
            }
        };
        const at = (time) => {
            world.seek(time);
            world.updateCamera(camera, { time, delta: 0 });
            world.update({ time, delta: 0 }, camera);
        };
        // No level-up at all (Infinity, a match, the menus): each palette rests pure for its hold,
        // then melts into the next; the round comes back to the first.
        at(DREAM_SECONDS * DREAM_HOLD * 0.5);
        expectPalette(0, 'rest');
        for (let k = 1; k <= count; k++) {
            at(DREAM_SECONDS * k);
            expectPalette(k % count, `palette ${k}`);
            expect(world.getState()).toMatchObject({ level: 1, palette: FLUID_PALETTES[k % count].name });
        }
        // Mid-melt it is neither.
        at(DREAM_SECONDS * (DREAM_HOLD + (1 - DREAM_HOLD) / 2));
        const horizon = (index) => new THREE.Vector3(...FLUID_PALETTES[index].horizon);
        expect(world.u.horizon.value.distanceTo(horizon(0))).toBeGreaterThan(0.05);
        expect(world.u.horizon.value.distanceTo(horizon(1))).toBeGreaterThan(0.05);

        // A level steps on a palette, on top of the clock's, eased; the sea still marks it.
        at(DREAM_SECONDS);
        const marks = vi.spyOn(world.choreo, 'levelUp');
        world.levelUp(2);
        expect(marks).toHaveBeenCalledTimes(1);
        expect(world.getState().palette).toBe(FLUID_PALETTES[2].name);
        run(world, camera, 1 / 60, 1);
        expect(world.getState().waves).toBe(1);
        expect(world.getPostState().flash).toBeGreaterThan(0);
        expect(world.paletteStep).toBeGreaterThan(0);
        expect(world.paletteStep).toBeLessThan(0.25);
        run(world, camera, 12, 240);
        expect(world.time).toBeLessThan(DREAM_SECONDS * (1 + DREAM_HOLD));
        expectPalette(2, 'level 2 on palette 1');
        // A new run drops the level's share and keeps the clock's.
        world.resetSession();
        run(world, camera, 12, 240);
        expectPalette(1, 'new run');
        world.dispose();
    });
});

describe('fluid dreams world: time', () => {
    /** A capture's script: locks either side, clears, a chain, a new level. */
    const script = (world, camera, fps = 60) => {
        world.onLock({
            u: 0.2, rows: [12], hardDrop: true, color: '#FF2D95',
        });
        world.onClear({ rows: [19, 18], lines: 2 });
        world.onCombo(3);
        world.levelUp(2);
        run(world, camera, 1.5, Math.round(1.5 * fps));
        world.onLock({ u: 0.8, rows: [15], color: '#00E5FF' });
        world.onLock({ u: 0.5, rows: [18], color: '#FFD93D' });
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        world.onCombo(4);
        run(world, camera, 2.5, Math.round(2.5 * fps));
    };

    /** What a frame is drawn from: every uniform the world writes, the spray pool, the camera. */
    const snapshot = (world, camera) => {
        const { u, choreo } = world;
        const rows = (table, count) => table.slice(0, count * 2).flatMap((row) => [row.x, row.y, row.z, row.w]);
        const out = [
            ...Object.values(world.getState()).flat(),
            ...['flash', 'kick', 'bloomBoost', 'exposure', 'shafts'].map((key) => world.getPostState()[key]),
            world.heart.x,
            world.heart.y,
            ...camera.matrixWorld.toArray(),
            camera.fov,
            ...rows(choreo.tables.rings, choreo.counts.rings),
            ...rows(choreo.tables.dye, choreo.counts.dye),
            ...rows(choreo.tables.waves, choreo.counts.waves),
            ...choreo.tables.groups.flatMap((row) => [row.x, row.y, row.z, row.w]),
            u.prism.value.y,
        ];
        // The spray that has been thrown (a dormant slot keeps whatever it last held: it is not drawn).
        const spray = world.parts.spray.geometry;
        const births = spray.getAttribute('aBirth').array;
        for (let i = 0; i < births.length; i += 4) {
            if (births[i + 3] > -50) {
                out.push(i, ...births.subarray(i, i + 4));
                for (const name of ['aVel', 'aTint']) out.push(...spray.getAttribute(name).array.subarray(i, i + 4));
            }
        }
        for (const key of ['time', 'swell', 'charge', 'surge', 'skyFlash', 'pixelAngle']) out.push(u[key].value);
        for (const key of [
            'counts', 'stem', 'stemShape', 'stemBeads', 'stemTint', 'hero', 'heroBlend', 'heroDir', 'sunDir', 'film',
            'viewport', ...PALETTE_KEYS,
        ]) {
            out.push(...u[key].value.toArray());
        }
        return out;
    };

    it('replays a frame: seek, then the same steps, gives the same sea whatever came before', () => {
        const { camera, world } = makeWorld('Low');
        script(world, camera);
        const first = snapshot(world, camera);
        expect(first.length).toBeGreaterThan(500);
        expect(world.getState().stains).toBeGreaterThan(0);
        // Something else entirely in between...
        world.onCombo(9);
        world.onLock({ u: 0.5, hardDrop: true });
        world.onClear({ lines: 3, twist: true });
        world.setReducedMotion(true);
        run(world, camera, 3);
        world.setReducedMotion(false);
        // ...then the capture's recipe again.
        world.seek(10);
        world.updateCamera(camera, { time: 10, delta: 0 });
        world.update({ time: 10, delta: 0 }, camera);
        script(world, camera);
        const again = snapshot(world, camera);
        expect(again).toHaveLength(first.length);
        let worst = 0;
        for (let i = 0; i < first.length; i++) {
            if (typeof first[i] === 'number') worst = Math.max(worst, Math.abs(first[i] - again[i]));
            else expect(again[i]).toBe(first[i]);
        }
        expect(worst).toBeLessThan(1e-9);
        world.dispose();
    });

    it('builds two worlds that play the same script to the same frame', () => {
        const a = makeWorld('Medium');
        const b = makeWorld('Medium');
        script(a.world, a.camera);
        script(b.world, b.camera);
        expect(snapshot(a.world, a.camera)).toEqual(snapshot(b.world, b.camera));
        a.world.dispose();
        b.world.dispose();
    });

    it('drops every event in flight when it seeks', () => {
        const { camera, world } = makeWorld('High');
        script(world, camera);
        world.levelUp(4);
        run(world, camera, 0.5);
        expect(world.choreo.isBusy()).toBe(true);
        expect(thrown(world.parts.spray)).toBeGreaterThan(0);
        expect(world.getState()).toMatchObject({ level: 4, palette: FLUID_PALETTES[3].name });
        world.seek(40);
        expect(thrown(world.parts.spray)).toBe(0);
        world.updateCamera(camera, { time: 40, delta: 0 });
        world.update({ time: 40, delta: 0 }, camera);
        expect(world.u.time.value).toBe(40);
        expect(world.choreo.isBusy()).toBe(false);
        expect(world.getState()).toMatchObject({
            combo: 0, charge: 0, stains: 0, waves: 0, rings: 0, layoutLive: true,
        });
        // A capture starts from the clock's colours, at once: whatever level was played before.
        expect(world.getState()).toMatchObject({ level: 1, palette: FLUID_PALETTES[0].name });
        expect(world.paletteStep).toBe(0);
        const clock = paletteAt(dreamDrift(40));
        for (const key of PALETTE_KEYS) {
            expect(world.u[key].value.toArray(), key).toEqual(clock[key]);
        }
        expect(world.u.prism.value.y).toBe(0);
        expect(thrown(world.parts.spray)).toBe(0);
        const { balls } = world.getState();
        expect(balls[GROUP_LEFT] + balls[GROUP_RIGHT]).toBe(0);
        expect(world.u.stemShape.value.w).toBe(0);
        expect(world.u.surge.value).toBe(0);
        expect(world.getPostState()).toMatchObject({
            flash: 0, kick: 0, bloomBoost: 0, exposure: 1,
        });
        // The same locks land where they did the first time: the aim is seeded with the clock.
        const fresh = makeWorld('High');
        const mine = recordLocks(world);
        const theirs = recordLocks(fresh.world);
        fresh.world.seek(40);
        fresh.world.updateCamera(fresh.camera, { time: 40, delta: 0 });
        fresh.world.update({ time: 40, delta: 0 }, fresh.camera);
        for (const u of [0.2, 0.5, 0.5, 0.8]) {
            world.onLock({ u, rows: [14] });
            fresh.world.onLock({ u, rows: [14] });
        }
        expect(mine).toEqual(theirs);
        fresh.world.dispose();
        world.dispose();
    });

    it('starts a new run with the sea at rest, and the picture where it stood', () => {
        const { camera, world } = makeWorld('High');
        script(world, camera);
        world.levelUp(4);
        run(world, camera, 12);
        expect(world.getState()).toMatchObject({ level: 4, palette: FLUID_PALETTES[3].name });
        const played = new THREE.Vector3(...FLUID_PALETTES[3].horizon);
        const first = new THREE.Vector3(...FLUID_PALETTES[0].horizon);
        expect(world.u.horizon.value.distanceTo(played)).toBeLessThan(0.01);
        const time = world.u.time.value;
        const anchor = [...world.choreo.scene.hero];
        const locks = recordLocks(world);
        world.resetSession();
        expect(world.combo).toBe(0);
        expect(world.choreo.isBusy()).toBe(false);
        expect(thrown(world.parts.spray)).toBe(0);
        // A new run starts on the first level again...
        expect(world.getState()).toMatchObject({ level: 1, palette: FLUID_PALETTES[0].name });
        // The next frame carries on from the same clock, with nothing in flight.
        run(world, camera, 1 / 60, 1);
        expect(world.u.time.value).toBeCloseTo(time + 1 / 60, 9);
        expect(thrown(world.parts.spray)).toBe(0);
        expect(world.u.prism.value.y).toBe(0);
        // ...and its colours ease back to it: nothing is cut on screen.
        const whole = played.distanceTo(first);
        expect(whole).toBeGreaterThan(0.1);
        expect(world.u.horizon.value.distanceTo(played)).toBeLessThan(whole * 0.25);
        expect(world.u.horizon.value.distanceTo(played)).toBeGreaterThan(0);
        expect(world.getState()).toMatchObject({
            combo: 0, charge: 0, stains: 0, waves: 0, layoutLive: true,
        });
        const { balls } = world.getState();
        expect(balls[GROUP_LEFT] + balls[GROUP_RIGHT]).toBe(0);
        expect(world.u.stemShape.value.w).toBe(0);
        expect(world.choreo.scene.hero).toEqual(anchor);
        // The board is still where it was, and a lock in its middle starts on the left again.
        world.onLock({ u: 0.5, rows: [10] });
        world.onLock({ u: 0.5, rows: [10] });
        expect(locks[0].to[0]).toBeLessThan(world.choreo.scene.foot[0]);
        expect(locks[1].to[0]).toBeGreaterThan(world.choreo.scene.foot[0]);
        run(world, camera, 1 / 60, 1);
        expect(world.getState().balls[GROUP_LEFT]).toBe(1);
        // The first level's colours, in the end (as far as the clock has turned them by now).
        run(world, camera, 30, 600);
        const clock = paletteAt(dreamDrift(world.time));
        for (const key of PALETTE_KEYS) {
            expect(world.u[key].value.distanceTo(new THREE.Vector3(...clock[key])), key).toBeLessThan(1e-3);
        }
        expect(world.getState()).toMatchObject({ level: 1, palette: FLUID_PALETTES[0].name });
        world.dispose();
    });

    it('replays a level change the same way after a seek', () => {
        const { camera, world } = makeWorld('Low');
        const play = () => {
            world.seek(10);
            world.updateCamera(camera, { time: 10, delta: 0 });
            world.update({ time: 10, delta: 0 }, camera);
            // What the playground's capture does for `event=levelUp`.
            run(world, camera, 2);
            world.levelUp(2);
            run(world, camera, 0.1);
            return PALETTE_KEYS.flatMap((key) => world.u[key].value.toArray());
        };
        const first = play();
        const second = play();
        expect(second).toEqual(first);
        // Part of the way across: it was easing from the first level's colours both times.
        const horizon = world.u.horizon.value;
        const from = new THREE.Vector3(...FLUID_PALETTES[0].horizon);
        const to = new THREE.Vector3(...FLUID_PALETTES[1].horizon);
        expect(horizon.distanceTo(from)).toBeGreaterThan(0);
        expect(horizon.distanceTo(to)).toBeGreaterThan(0);
        expect(horizon.distanceTo(to)).toBeLessThan(from.distanceTo(to));
        world.dispose();
    });

    it('holds a frame still when the clock does not advance', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.3, rows: [9] });
        world.onCombo(4);
        run(world, camera, 0.2);
        const frame = snapshot(world, camera);
        for (let i = 0; i < 5; i++) {
            const sim = { time: world.u.time.value, delta: 0 };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        }
        expect(snapshot(world, camera)).toEqual(frame);
        world.dispose();
    });
});

describe('fluid dreams spray', () => {
    const uniforms = () => {
        const { world } = makeWorld('Minimal');
        return world;
    };

    it('throws a droplet up and lets it fall: the shader\'s closed form', () => {
        expect(sprayHeight(4, 3, 0)).toBe(4);
        expect(sprayHeight(4, 3, 0.2)).toBeGreaterThan(4);
        let previous = sprayHeight(4, 3, 0.4);
        for (let tau = 0.6; tau <= 3; tau += 0.2) {
            expect(sprayHeight(4, 3, tau)).toBeLessThan(previous);
            previous = sprayHeight(4, 3, tau);
        }
        // It comes back to where it left after twice its rise time.
        const g = (2 * (sprayHeight(0, 0, 0) - sprayHeight(0, 0, 1)));
        expect(g).toBeGreaterThan(0);
        expect(sprayHeight(1, 5, (2 * 5) / g)).toBeCloseTo(1, 9);
    });

    it('describes every kind of burst the world throws', () => {
        const named = [
            'splash', 'drip', 'crown', 'pour', 'trail', 'rain', 'fountain', 'pop', 'coronet', 'sheaf', 'bridge',
        ];
        for (const kind of new Set([...named, ...Object.keys(SPRAY_KINDS)])) {
            const spec = SPRAY_KINDS[kind];
            expect(spec, kind).toBeTruthy();
            expect(spec.n, kind).toBeGreaterThan(0);
            expect(spec.size, kind).toBeGreaterThan(0);
            expect(spec.gain, kind).toBeGreaterThan(0);
            for (const range of [spec.out, spec.up, spec.life]) {
                expect(range, kind).toHaveLength(2);
                expect(range[1], kind).toBeGreaterThanOrEqual(range[0]);
            }
            expect(spec.life[0], kind).toBeGreaterThan(0);
        }
    });

    it('writes a burst into a ring of preallocated slots and never grows', () => {
        const world = uniforms();
        const count = 64;
        const spray = createSpray(world.u, count);
        const births = spray.geometry.getAttribute('aBirth');
        const velocities = spray.geometry.getAttribute('aVel');
        const tints = spray.geometry.getAttribute('aTint');
        for (const attribute of [births, velocities, tints]) {
            expect(attribute.isInstancedBufferAttribute).toBe(true);
            expect(attribute.count).toBe(count);
            expect(attribute.itemSize).toBe(4);
            expect(attribute.usage).toBe(THREE.DynamicDrawUsage);
        }
        expect(thrown(spray)).toBe(0);
        const { version } = births;
        spray.emit({
            kind: 'splash', x: 3, y: 0.05, z: -9, color: [1, 0.5, 0.25], power: 1, time: 20,
        });
        const first = thrown(spray);
        expect(first).toBe(Math.min(count, SPRAY_KINDS.splash.n));
        expect(births.version).toBeGreaterThan(version);
        for (let i = 0; i < first; i++) {
            // Born at the burst, now or a moment later, near where it was thrown...
            expect(births.getW(i)).toBeGreaterThanOrEqual(20);
            expect(births.getW(i)).toBeLessThan(20.5);
            expect(Math.hypot(births.getX(i) - 3, births.getZ(i) + 9)).toBeLessThan(2);
            // ...thrown upward, to live a while, in the burst's hue.
            expect(velocities.getY(i)).toBeGreaterThan(0);
            expect(velocities.getW(i)).toBeGreaterThan(0);
            expect(tints.getY(i) / tints.getX(i)).toBeCloseTo(0.5, 5);
            expect(tints.getZ(i) / tints.getX(i)).toBeCloseTo(0.25, 5);
            expect(tints.getW(i)).toBeGreaterThan(0);
        }
        // A stronger burst throws more; a huge one fills the pool and stops there.
        spray.reset();
        spray.emit({
            kind: 'splash', x: 0, y: 0, z: -5, color: [1, 1, 1], power: 2, time: 21,
        });
        expect(thrown(spray)).toBeGreaterThan(first);
        for (let i = 0; i < 20; i++) {
            spray.emit({
                kind: 'crown', x: 0, y: 0, z: -5, color: [1, 1, 1], power: 3.3, time: 22 + i,
            });
        }
        expect(thrown(spray)).toBe(count);
        expect(births.count).toBe(count);
        expect(spray.geometry.instanceCount).toBe(count);
        for (const attribute of [births, velocities, tints]) {
            expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
        }
        // An unknown kind is thrown as a splash; a pour is aimed.
        spray.reset();
        expect(thrown(spray)).toBe(0);
        expect(() => spray.emit({
            kind: 'no-such-kind', x: 0, y: 0, z: 0, color: [1, 1, 1], time: 1,
        })).not.toThrow();
        expect(thrown(spray)).toBe(Math.min(count, SPRAY_KINDS.splash.n));
        spray.reset();
        spray.emit({
            kind: 'pour', x: 0, y: 2, z: -6, color: [1, 1, 1], power: 1, time: 5, dir: [1, 0],
        });
        const poured = thrown(spray);
        expect(poured).toBeGreaterThan(0);
        for (let i = 0; i < poured; i++) expect(velocities.getX(i)).toBeGreaterThan(0);
        spray.geometry.dispose();
        spray.material.dispose();
        world.dispose();
    });

    it('throws the same burst the same way after a reset', () => {
        const world = uniforms();
        const spray = createSpray(world.u, 96);
        const burst = {
            kind: 'crown', x: -4, y: 0.2, z: -20, color: [1, 0.86, 0.62], power: 1, time: 12,
        };
        spray.emit(burst);
        const first = Array.from(spray.geometry.getAttribute('aVel').array);
        spray.emit({ ...burst, kind: 'drip' });
        spray.reset();
        spray.emit(burst);
        expect(Array.from(spray.geometry.getAttribute('aVel').array).slice(0, SPRAY_KINDS.crown.n * 4))
            .toEqual(first.slice(0, SPRAY_KINDS.crown.n * 4));
        spray.geometry.dispose();
        spray.material.dispose();
        world.dispose();
    });
});

describe('fluid dreams world: play builds', () => {
    /** A chain as the tray's Fever plays it, through the world's own handlers. */
    const chain = (world, camera, clears) => {
        const plan = [1, 1, 2, 1, 2, 2, 3, 2, 2, 2, 3];
        for (let n = 0; n < clears; n++) {
            world.onLock({ u: n % 2 ? 0.8 : 0.2, rows: [18, 19], hardDrop: true });
            const lines = plan[n % plan.length];
            world.onClear({
                rows: [19, 18, 17].slice(0, lines), lines, combo: n + 1, cascade: 1,
            });
            world.onCombo(n + 1);
            run(world, camera, 0.64);
        }
    };
    const saturation = (v) => Math.max(v.x, v.y, v.z) - Math.min(v.x, v.y, v.z);

    it('wears the heat of a long chain, and breathes back to its resting look when the hands rest', () => {
        const { camera, world } = makeWorld('Low');
        const rest = { ...world.getPostState() };
        const restHorizon = world.u.horizon.value.clone();
        chain(world, camera, 1);
        const first = {
            heat: world.u.heat.value.clone(), r: world.u.hero.value.w, exposure: world.getPostState().exposure,
        };
        chain(world, camera, 10);
        const { u } = world;
        // hotter than its first clear: the veins and the ink burn, the Drop swells, a fever is lit
        expect(u.heat.value.x).toBeGreaterThan(first.heat.x + 0.4);
        expect(u.heat.value.y).toBeGreaterThan(0.5);
        expect(u.hero.value.w).toBeGreaterThan(first.r);
        // the sea line burns deeper in its own hue, and the iris closes so the colours keep
        expect(saturation(u.horizon.value)).toBeGreaterThan(saturation(restHorizon) * 1.1);
        expect(world.getPostState().exposure).toBeLessThan(first.exposure);
        expect(world.getPostState().exposure).toBeGreaterThan(0.6);
        // the darks keep their dark (the clock's own)
        const clock = paletteAt(dreamDrift(world.time));
        for (const key of ['zenith', 'mid', 'deep']) {
            expect(u[key].value.toArray(), key).toEqual(clock[key]);
        }
        // The hands rest.
        world.onCombo(0);
        run(world, camera, 25, 500);
        expect(u.heat.value.x).toBeLessThan(0.01);
        expect(u.heat.value.y).toBe(0);
        // (the resting sea line the clock has turned to by now)
        const restNow = new THREE.Vector3(...paletteAt(dreamDrift(world.time)).horizon);
        expect(restHorizon.distanceTo(new THREE.Vector3(...FLUID_PALETTES[0].horizon))).toBeLessThan(1e-6);
        expect(u.horizon.value.distanceTo(restNow)).toBeLessThan(1e-6);
        expect(world.getPostState().exposure).toBeCloseTo(rest.exposure, 3);
        expect(world.getPostState().bloomBoost).toBeLessThan(0.01);
        world.dispose();
    });

    it('takes a late perfect clear as the crown on its clear: no second packet, no pour, glass after the crown', () => {
        const { camera, world } = makeWorld('Low');
        const spray = recordSpray(world);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        run(world, camera, 0.36);
        const { waves } = world.getState();
        const pours = spray.filter((burst) => burst.kind === 'pour').length;
        const { site } = world.getState();
        world.onClear({
            rows: [], lines: 1, perfect: true, crown: true, combo: 1, cascade: 1,
        });
        expect(spray.filter((burst) => burst.kind === 'pour')).toHaveLength(pours);
        expect(world.getState().site).toEqual(site);
        run(world, camera, 2 / 60);
        expect(world.getState().waves).toBe(waves);
        expect(world.choreo.glass.active).toBe(true);
        expect(world.choreo.glass.level).toBe(0);
        run(world, camera, HUSH_HOLD + world.choreo.plunge.fall + 2.5);
        expect(world.choreo.glass.level).toBeGreaterThan(0.5);
        world.dispose();
    });

    it('turns the sea a little on a twist that clears nothing', () => {
        const { camera, world } = makeWorld('Low');
        world.onSpin({ player: 0 });
        run(world, camera, 0.5);
        expect(world.u.vortex.value.z).toBeGreaterThan(0);
        world.dispose();
    });

    it('lets the motes climb faster as the sea charges, without leaping when it does', () => {
        const { camera, world } = makeWorld('Low');
        let last = world.u.moteClock.value;
        let most = 0;
        const step = () => {
            run(world, camera, 1 / 60, 1);
            most = Math.max(most, world.u.moteClock.value - last);
            last = world.u.moteClock.value;
        };
        for (let i = 0; i < 60; i++) step();
        const calm = most;
        expect(calm).toBeCloseTo(1 / 60, 6);
        world.onCombo(12);
        for (let i = 0; i < 300; i++) step();
        // faster, but never more in a frame than its fastest rate allows
        expect(most).toBeGreaterThan(calm * 1.5);
        expect(most).toBeLessThan((1 / 60) * 4);
        // a seek stands it at the clock, as a fresh sea would
        world.seek(30);
        expect(world.moteClock).toBe(30);
        world.dispose();
    });
});

describe('fluid dreams world: the sky', () => {
    const SKY_VECTORS = [
        'skyCounts', 'air', 'air2', 'sunLook', 'front', 'pillar', 'shock', 'swirl', 'starHead', 'starTail', 'shoal',
        'sunDir', 'sunFlat', 'sunDeck', 'river',
    ];
    /** The first thing the sky hands the liquid that is not a number, or null. */
    const brokenSky = (world) => {
        for (const key of SKY_VECTORS) {
            if (!world.u[key].value.toArray().every(Number.isFinite)) return key;
        }
        for (const key of ['skyClock', 'moteGain']) if (!Number.isFinite(world.u[key].value)) return key;
        const bad = world.sky.rows.findIndex((row) => ![row.x, row.y, row.z, row.w].every(Number.isFinite));
        return bad >= 0 ? `sky row ${bad}` : null;
    };
    /** The bubbles' part of the sky's table, as [place, look] pairs. */
    const bubbleRows = (world) => {
        const out = [];
        for (let i = FAR_COUNT * 2; i < world.sky.rows.length; i += 2) out.push([world.sky.rows[i], world.sky.rows[i + 1]]);
        return out;
    };
    const hold = (world, camera) => {
        const sim = { time: world.u.time.value, delta: 0 };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    };
    const at = (world, camera, time) => {
        world.seek(time);
        world.updateCamera(camera, { time, delta: 0 });
        world.update({ time, delta: 0 }, camera);
    };
    /** The airs in which the sea runs calmest and heaviest. */
    const byCalm = AIRS.map((air, index) => index).sort((a, b) => AIRS[a].calm - AIRS[b].calm);
    const calmest = byCalm[0];
    const heaviest = byCalm[byCalm.length - 1];
    const QUAD = { rows: [19, 18, 17, 16], lines: 4 };

    it('builds the sky its tier pays for, and hands the liquid the sky\'s own table', () => {
        for (const quality of QUALITY_NAMES) {
            const { world } = makeWorld(quality);
            expect(world.sky.bubbleCount, quality).toBe(QUALITY[quality].bubbles);
            expect(world.u.sky.array, quality).toBe(world.sky.rows);
            expect(world.sky.rows, quality).toHaveLength(SKY_ROWS);
            // A world just stood up is in the first air, and says so.
            expect(world.getState().air, quality).toBe(AIRS[0].name);
            expect(world.getState().bubbles, quality).toBeLessThanOrEqual(QUALITY[quality].bubbles);
            expect(brokenSky(world), quality).toBeNull();
            world.dispose();
        }
    });

    it('hands the sky\'s numbers to the liquid every frame: the air, the sun, the bubbles to draw', () => {
        const { camera, world } = makeWorld('High');
        const { u, sky } = world;
        // At rest on the first level, early in the first air: that air's own look, exactly.
        const first = AIRS[0];
        expect(u.air.value.toArray()).toEqual([first.cover, first.strata, first.mist, first.stars]);
        expect(u.air2.value.x).toBe(first.veins);
        expect(u.moteGain.value).toBe(first.motes);
        expect(world.choreo.airCalm).toBe(first.calm);
        let most = 0;
        for (let i = 0; i < 300; i++) {
            if (i === 20) world.levelUp(2);
            if (i === 50) world.onClear({ ...QUAD, perfect: true, b2b: true });
            if (i === 60) world.happen('bubbles', 5);
            if (i === 70) world.happen('star', 5);
            if (i === 80) world.happen('shoal', 5);
            if (i === 200) world.onClear({ rows: [19, 18], lines: 2, twist: true });
            run(world, camera, 1 / 60, 1);
            const label = `frame ${i}`;
            expect(brokenSky(world), label).toBeNull();
            // The sun: a unit direction over the sea line, as high as the sky has it, and its bearing.
            const sun = u.sunDir.value;
            expect(sun.length(), label).toBeCloseTo(1, 9);
            expect(sun.y, label).toBe(sky.sun.height);
            expect(sun.y, label).toBeGreaterThanOrEqual(SUN.low);
            expect(sun.y, label).toBeLessThanOrEqual(SUN.high);
            expect(u.sunFlat.value.length(), label).toBeCloseTo(1, 9);
            const level = Math.hypot(sun.x, sun.z);
            expect(u.sunFlat.value.x, label).toBeCloseTo(sun.x / level, 9);
            expect(u.sunFlat.value.y, label).toBeCloseTo(sun.z / level, 9);
            expect(u.river.value.length(), label).toBeCloseTo(1, 9);
            // The air as the sky has it this frame (a perfect clear draws the ink back, the stars out).
            expect(u.air.value.toArray(), label).toEqual([sky.cover, sky.strata, sky.air.mist, sky.starGain]);
            expect(u.air2.value.x, label).toBe(sky.air.veins);
            expect(u.skyClock.value, label).toBe(sky.skyClock);
            expect([u.sunLook.value.x, u.sunLook.value.y], label).toEqual([sky.halo, sky.halo2]);
            expect(world.choreo.airCalm, label).toBe(sky.air.calm);
            // The bubbles: the shader's loop runs over every row that is lit and never past the
            // tier's; rows it does not reach are not drawn.
            const count = u.skyCounts.value.x;
            const rows = bubbleRows(world);
            const lit = rows.filter(([, look]) => look.z > 0).length;
            expect(Number.isInteger(count), label).toBe(true);
            expect(count, label).toBeGreaterThanOrEqual(lit);
            expect(count, label).toBeLessThanOrEqual(QUALITY.High.bubbles);
            rows.slice(count).forEach(([, look]) => expect(look.z, label).toBe(0));
            // (what it reports is what it loops over: a bubble the ring has burst is still counted,
            // at no light, until its time is up)
            expect(world.getState().bubbles, label).toBeGreaterThanOrEqual(lit);
            expect(world.getState().bubbles, label).toBeLessThanOrEqual(count);
            most = Math.max(most, lit);
        }
        expect(most).toBeGreaterThan(0);
        world.dispose();
    });

    it('holds an air when asked, names it, and lets the wheel turn again', () => {
        const { camera, world } = makeWorld('Low');
        AIRS.forEach((air, index) => {
            world.setAirHold(index);
            hold(world, camera);
            expect(world.getState().air, air.name).toBe(air.name);
            expect(world.u.air.value.toArray(), air.name).toEqual([air.cover, air.strata, air.mist, air.stars]);
            expect(world.choreo.airCalm, air.name).toBe(air.calm);
        });
        // A fraction shows two of them melting.
        world.setAirHold(0.5);
        hold(world, camera);
        const cover = world.u.air.value.x;
        expect(cover).toBeGreaterThan(Math.min(AIRS[0].cover, AIRS[1].cover));
        expect(cover).toBeLessThan(Math.max(AIRS[0].cover, AIRS[1].cover));
        // Held through time and through a level.
        world.setAirHold(1);
        world.levelUp(3);
        run(world, camera, 20, 200);
        expect(world.getState().air).toBe(AIRS[1].name);
        // Let go: the clock's turn and the level's step again.
        world.setAirHold(null);
        run(world, camera, 20, 200);
        expect(world.sky.airHold).toBeNull();
        expect(world.getState().air).toBe(airNear((3 - 1) * AIR_LEVEL_STEP + airDrift(world.time)).name);
        // Nonsense holds nothing; an air before the first is the first.
        for (const junk of ['2', NaN, undefined, Infinity]) {
            world.setAirHold(junk);
            expect(world.sky.airHold, String(junk)).toBeNull();
        }
        world.setAirHold(-3);
        hold(world, camera);
        expect(world.getState().air).toBe(AIRS[0].name);
        world.dispose();
    });

    it('stops the things that happen by themselves when asked, and plays one when told to', () => {
        const { camera, world } = makeWorld('Low');
        const fired = vi.spyOn(world.sky, 'happen');
        /** Play the second in which slot `index` falls due. */
        const through = (index) => {
            at(world, camera, happeningOf(index).at - 0.5);
            run(world, camera, 1);
        };
        world.setHappenings(false);
        through(0);
        through(1);
        expect(fired).not.toHaveBeenCalled();
        world.setHappenings(true);
        through(2);
        expect(fired).toHaveBeenCalledTimes(1);
        expect(fired.mock.calls[0][0]).toBe(happeningOf(2).kind);
        // Only `false` switches them off.
        world.setHappenings(undefined);
        expect(world.sky.happeningsOn).toBe(true);
        world.setHappenings(false);
        expect(world.sky.happeningsOn).toBe(false);
        // One, now (captures and the playground): a falling star crosses the sky and is gone.
        expect(world.happen('star', 3)).toBe('star');
        run(world, camera, 0.2);
        const head = world.u.starHead.value;
        expect(head.w).toBeGreaterThan(0);
        expect(Math.hypot(head.x, head.y, head.z)).toBeCloseTo(1, 9);
        run(world, camera, 5);
        expect(head.w).toBe(0);
        // A fountain far out goes to the spray pool, in the dusk's own glow, a pulse at a time.
        const spray = recordSpray(world);
        const now = world.u.time.value;
        world.happen('fountain', 3);
        const pulses = spray.filter((burst) => burst.kind === 'fountain');
        expect(pulses.length).toBeGreaterThan(0);
        pulses.forEach((burst, i) => {
            expect(burst.time).toBeGreaterThanOrEqual(now);
            if (i > 0) expect(burst.time).toBeGreaterThan(pulses[i - 1].time);
            expect(burst.color).toEqual(world.shown.glow);
            expect(Math.hypot(burst.x, burst.z)).toBeGreaterThan(SITE.far);
        });
        expect(thrown(world.parts.spray)).toBeGreaterThan(0);
        world.dispose();
    });

    it('gives the sky its share of what the choreography plays', () => {
        const { camera, world } = makeWorld('High');
        const impact = vi.spyOn(world.sky, 'impact');
        const answer = vi.spyOn(world.sky, 'answer');
        const perfect = vi.spyOn(world.sky, 'perfect');
        const front = vi.spyOn(world.sky, 'levelUp');
        const spray = recordSpray(world);
        const { u } = world;
        // A back-to-back: the far forms answer the kin's fire.
        world.onClear({
            rows: [19, 18], lines: 2, twist: true, b2b: true,
        });
        expect(answer).toHaveBeenCalledTimes(1);
        // A perfect four-line clear: the sky is told of the glass at once, of the impact when it comes.
        world.onClear({ ...QUAD, perfect: true });
        expect(perfect).toHaveBeenCalledTimes(1);
        expect(perfect.mock.calls[0][0]).toBe(world.choreo.glass.t0);
        expect(impact).not.toHaveBeenCalled();
        run(world, camera, HUSH_HOLD + world.choreo.plunge.fall + 0.1);
        expect(impact).toHaveBeenCalledTimes(1);
        const [crown] = spray.filter((burst) => burst.kind === 'crown');
        expect(impact.mock.calls[0].slice(0, 2)).toEqual([crown.x, crown.z]);
        // The pillar of light stands on the crater, as the eye sees it, and a ring runs out through the ink.
        const bearing = new THREE.Vector2(crown.x - camera.position.x, crown.z - camera.position.z).normalize();
        expect(u.pillar.value.z).toBeGreaterThan(0);
        expect(u.pillar.value.x).toBeCloseTo(bearing.x, 3);
        expect(u.pillar.value.y).toBeCloseTo(bearing.y, 3);
        expect(u.pillar.value.w).toBeGreaterThan(0);
        expect(u.shock.value.w).toBeGreaterThan(0);
        // The sun wears its second ring once the sea has turned to glass.
        let ring = 0;
        for (let i = 0; i < 300; i++) {
            run(world, camera, 1 / 60, 1);
            ring = Math.max(ring, u.sunLook.value.y);
        }
        expect(ring).toBeGreaterThan(0);
        expect(impact).toHaveBeenCalledTimes(1);
        // A level: a front of light opens from the sun (not for a capture's silent one).
        world.levelUp(2);
        expect(front).toHaveBeenCalledTimes(1);
        expect(world.sky.level).toBe(2);
        run(world, camera, 0.3);
        expect(u.front.value.y).toBeGreaterThan(0);
        world.levelUp(3, { silent: true });
        expect(front).toHaveBeenCalledTimes(1);
        expect(world.sky.level).toBe(3);
        // And all of it passes.
        run(world, camera, 60, 600);
        expect(u.front.value.y).toBe(0);
        expect(u.pillar.value.z).toBe(0);
        expect(u.shock.value.w).toBe(0);
        expect(u.sunLook.value.y).toBe(0);
        expect(brokenSky(world)).toBeNull();
        world.dispose();
    });

    it('holds the front of light and the pillar back when flashing is reduced, and leaves the sky its own numbers', () => {
        const play = () => {
            const { camera, world } = makeWorld('Low');
            world.levelUp(2);
            run(world, camera, 0.4);
            const front = {
                shown: world.u.front.value.y, own: world.sky.front.strength, radius: world.u.front.value.x,
            };
            world.onClear(QUAD);
            run(world, camera, HUSH_HOLD + world.choreo.plunge.fall + 0.3);
            const pillar = {
                shown: world.u.pillar.value.z, own: world.sky.pillar.strength, width: world.u.pillar.value.w,
            };
            world.dispose();
            return { front, pillar };
        };
        const loud = play();
        holdFlashing(true);
        const soft = play();
        holdFlashing(false);
        for (const key of ['front', 'pillar']) {
            // Unreduced, the liquid is handed the sky's own strength.
            expect(loud[key].own, key).toBeGreaterThan(0);
            expect(loud[key].shown, key).toBe(loud[key].own);
            // Reduced: the sky plays the same event; only what is written for the frame is held back.
            expect(soft[key].own, key).toBeCloseTo(loud[key].own, 12);
            expect(soft[key].shown, key).toBeCloseTo(soft[key].own * REDUCED_FLASH_SCALE, 12);
            expect(soft[key].shown, key).toBeLessThan(loud[key].shown);
        }
        // Where the light stands is not a flash: it is not scaled.
        expect(soft.front.radius).toBeCloseTo(loud.front.radius, 12);
        expect(soft.pillar.width).toBeCloseTo(loud.pillar.width, 12);
    });

    it('turns the ink over a twist and winds the thread; under reduced motion the thread stands straight', () => {
        const twist = (reduced) => {
            const { camera, world } = makeWorld('Low');
            world.setReducedMotion(reduced);
            world.onClear({ rows: [19, 18], lines: 2, twist: true });
            const most = { swirl: 0, helix: 0, funnel: 0 };
            for (let i = 0; i < 90; i++) {
                run(world, camera, 1 / 60, 1);
                most.swirl = Math.max(most.swirl, world.u.swirl.value.z);
                most.helix = Math.max(most.helix, world.u.vortexSpin.value.z);
                most.funnel = Math.max(most.funnel, world.u.vortex.value.z);
                expect(brokenSky(world)).toBeNull();
            }
            expect(world.u.swirl.value.w).toBeGreaterThan(0);
            // It lets go: the ink lies still again and the thread hangs straight.
            run(world, camera, 20, 400);
            expect(world.u.swirl.value.z).toBe(0);
            expect(world.u.vortexSpin.value.z).toBe(0);
            world.dispose();
            return most;
        };
        const lively = twist(false);
        const calm = twist(true);
        expect(lively.swirl).toBeGreaterThan(0);
        expect(lively.helix).toBeGreaterThan(0);
        // Reduced motion keeps the funnel (the feedback), turns the ink less and winds nothing.
        expect(calm.funnel).toBeGreaterThan(0);
        expect(calm.helix).toBe(0);
        expect(calm.swirl).toBeLessThan(lively.swirl);
    });

    it('runs the sea as the air has it, and lets a chain raise it in any air', () => {
        const inAir = (index) => {
            const made = makeWorld('Low');
            made.world.setAirHold(index);
            run(made.world, made.camera, 5);
            return made;
        };
        const glass = inAir(calmest);
        const heavy = inAir(heaviest);
        expect(AIRS[calmest].calm).toBeLessThan(AIRS[heaviest].calm);
        expect(glass.world.u.swell.value).toBeCloseTo(AIRS[calmest].calm, 3);
        expect(heavy.world.u.swell.value).toBeCloseTo(AIRS[heaviest].calm, 3);
        for (const { camera, world } of [glass, heavy]) {
            const rest = world.u.swell.value;
            world.onCombo(6);
            run(world, camera, 5);
            expect(world.u.swell.value).toBeGreaterThan(rest + 0.1);
        }
        expect(glass.world.u.swell.value).toBeLessThan(heavy.world.u.swell.value);
        glass.world.dispose();
        heavy.world.dispose();
    });

    // Found 2026-11-25, fixed in the source: choreo.reset() stands the swell at 1, whatever the
    // air (`airCalm`). A run that ends or begins in a calm air heaves the whole sea up in one frame
    // and takes half a second to lie down again (in a heavy air it drops, the other way).
    it('does not heave the sea when a new run starts in a calm air', () => {
        const { camera, world } = makeWorld('Low');
        world.setAirHold(calmest);
        run(world, camera, 6);
        const rest = world.u.swell.value;
        expect(rest).toBeCloseTo(AIRS[calmest].calm, 3);
        world.resetSession();
        let most = rest;
        for (let i = 0; i < 120; i++) {
            run(world, camera, 1 / 60, 1);
            most = Math.max(most, world.u.swell.value);
        }
        // The air has not changed: neither has the sea.
        expect(most).toBeLessThan(rest * 1.1);
        world.dispose();
    });

    it('asks the sea for its moment when a run ends: the iris closes a little, and opens again', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.2, rows: [12], color: '#FF2D95' });
        world.onCombo(3);
        run(world, camera, 1);
        const exhale = vi.spyOn(world.choreo, 'exhale');
        // (as the theme does it: the session's reset, then the moment)
        world.resetSession();
        world.endRun();
        expect(exhale).toHaveBeenCalledTimes(1);
        expect(world.choreo.isBusy()).toBe(true);
        const post = world.getPostState();
        let darkest = { exposure: 1, dusk: 0 };
        let deepest = { exposure: 1, dusk: 0 };
        let rings = 0;
        for (let i = 0; i < 15 * 60; i++) {
            run(world, camera, 1 / 60, 1);
            const { dusk } = world.choreo;
            if (post.exposure < darkest.exposure) darkest = { exposure: post.exposure, dusk };
            if (dusk > deepest.dusk) deepest = { exposure: post.exposure, dusk };
            rings = Math.max(rings, world.getState().rings);
        }
        // The iris closes with the dusk and by nothing else: darkest when the dusk is deepest.
        expect(deepest.dusk).toBeGreaterThan(0);
        expect(darkest.exposure).toBeLessThan(1);
        expect(darkest.exposure).toBe(deepest.exposure);
        expect(darkest.exposure).toBeGreaterThan(0.5); // a dusk, not a blackout
        expect(rings).toBeGreaterThan(0);
        // A moment, not a state.
        expect(world.choreo.isBusy()).toBe(false);
        run(world, camera, 15, 300);
        expect(post.exposure).toBeCloseTo(1, 9);
        expect(world.u.swell.value).toBeCloseTo(world.sky.air.calm, 3);
        expect(world.getState()).toMatchObject({
            combo: 0, charge: 0, stains: 0, waves: 0,
        });
        world.dispose();
    });

    // Found 2026-11-25, fixed in the source: sky.seek() keeps the air it stood in, and
    // updateCamera places the sun (and projects the shafts' origin) by that stale air before the
    // frame's update turns the air to the new time. The first frame after a seek aims the post's
    // shafts at a sun that is not there; a second frame at the same time corrects it.
    it('aims the shafts at this frame\'s sun on the first frame after a seek, whatever air stood before', () => {
        const a = makeWorld('Low');
        const b = makeWorld('Low');
        // One of them comes from the second air, where the sun rides at another height.
        at(a.world, a.camera, AIR_SECONDS * 1.2);
        const elsewhere = a.world.sky.sun.height;
        at(a.world, a.camera, 10);
        at(b.world, b.camera, 10);
        expect(Math.abs(elsewhere - b.world.sky.sun.height)).toBeGreaterThan(1e-3);
        expect(a.world.u.sunDir.value.toArray()).toEqual(b.world.u.sunDir.value.toArray());
        expect(a.world.heart.x).toBeCloseTo(b.world.heart.x, 9);
        expect(a.world.heart.y).toBeCloseTo(b.world.heart.y, 9);
        a.world.dispose();
        b.world.dispose();
    });

    it('keeps its bubbles far out behind every drop, trains included', () => {
        const { camera, world } = makeWorld('Ultra');
        const { sky } = world;
        const place = {};
        let nearest = Infinity;
        let seen = 0;
        for (let i = 0; i < 2400; i++) {
            if (i % 160 === 20) world.happen('bubbles', 1 + i);
            run(world, camera, 0.25, 1);
            for (let slot = 0; slot < sky.bubbleCount; slot++) {
                sky.bubbleAt(slot, world.time, sky.air, place);
                if (!(place.shown > 0)) continue;
                seen += 1;
                const away = Math.hypot(
                    place.x - camera.position.x,
                    place.y - camera.position.y,
                    place.z - camera.position.z,
                );
                nearest = Math.min(nearest, away - place.r);
                expect(place.y).toBeGreaterThan(0); // over the sea
                expect(place.z).toBeLessThan(0); // in front of the eye
            }
        }
        expect(seen).toBeGreaterThan(1000);
        // The Great Drop is never carried farther out than SITE.far: a bubble is behind it wherever it hangs.
        expect(nearest).toBeGreaterThan(SITE.far);
        world.dispose();
    });
});

describe('fluid dreams world: fountains, the coronet and the bridge', () => {
    const fountainsOf = (world) => world.choreo.jets.filter((jet) => jet.active && jet.fountain);
    const inside = (x, y, rect) => x > rect.x0 && x < rect.x1 && y > rect.y0 && y < rect.y1;
    /** Where a sea point shows for the rest camera, held to the open sea beside `card` and `hud` on side `s`. */
    const expectOpenSea = (point, s, { card, hud }, aspect, label) => {
        const [sx, sy, depth] = restProject(point[0], 0, point[1], aspect);
        // On the sea, in the frame, out on the water.
        expect(depth, label).toBeGreaterThan(REST_RIG.height * 2);
        expect(sx, label).toBeGreaterThan(0);
        expect(sx, label).toBeLessThan(1);
        expect(sy, label).toBeGreaterThan(horizonY(aspect));
        expect(sy, label).toBeLessThan(1);
        // Beside the card on its own side, past the stats bar where that stands on this side.
        if (s === 0) {
            expect(sx, label).toBeLessThan(card.x0);
            if (hud && hud.x1 <= card.x0) expect(sx, label).toBeLessThan(hud.x0);
        } else {
            expect(sx, label).toBeGreaterThan(card.x1);
            if (hud && hud.x0 >= card.x1) expect(sx, label).toBeGreaterThan(hud.x1);
        }
        // Never under the card or the bar.
        for (const rect of hud ? [card, hud] : [card]) expect(inside(sx, sy, rect), label).toBe(false);
    };
    const wideCard = {
        x0: 0.04, y0: 0.08, x1: 0.96, y1: 0.8,
    };
    const PHONE = layoutOf([wideCard], [{
        x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.78,
    }]);
    const ROW = layoutOf([
        {
            x0: 0.03, y0: 0.2, x1: 0.33, y1: 0.82,
        },
        {
            x0: 0.35, y0: 0.2, x1: 0.65, y1: 0.82,
        },
        {
            x0: 0.67, y0: 0.2, x1: 0.97, y1: 0.82,
        },
    ], [null, {
        x0: 0.06, y0: 0.3, x1: 0.3, y1: 0.8,
    }, {
        x0: 0.38, y0: 0.3, x1: 0.62, y1: 0.8,
    }, {
        x0: 0.7, y0: 0.3, x1: 0.94, y1: 0.8,
    }]);

    it('finds the sea either side of the card for a clear\'s fountains, past the stats bar', () => {
        const barOnTheLeft = layoutOf([{
            x0: 0.4, y0: 0.1, x1: 0.6, y1: 0.86,
        }], [{
            x0: 0.42, y0: 0.2, x1: 0.58, y1: 0.84,
        }], {
            x0: 0.28, y0: 0.3, x1: 0.36, y1: 0.7,
        });
        for (const [width, height, layout] of [
            [1600, 900], [1920, 1080], [2560, 1080], [1280, 1024], [1024, 768], [1600, 900, barOnTheLeft],
        ]) {
            const aspect = width / height;
            const frame = `${width}x${height}${layout ? ', the bar on the left' : ''}`;
            const { world } = makeWorld('Low', { width, height, layout });
            const rects = { card: cardUnion(world.layout), hud: world.layout.hud };
            const sites = world.fountainSites(world.layout.boards[0]).map((site) => site && [...site]);
            expect(sites, frame).toHaveLength(2);
            sites.forEach((site, s) => {
                expect(site, `${frame}, side ${s}`).not.toBeNull();
                expectOpenSea(site, s, rects, aspect, `${frame}, side ${s}`);
            });
            // Left of the board's foot, and right of it.
            expect(sites[0][0], frame).toBeLessThan(world.choreo.scene.foot[0]);
            expect(sites[1][0], frame).toBeGreaterThan(world.choreo.scene.foot[0]);
            world.dispose();
        }
    });

    it('raises fountains on both sides for two lines, more for three, and none for one or four', () => {
        const clear = (lines) => {
            const { camera, world } = makeWorld('Low');
            const clears = recordClears(world);
            world.onClear({ rows: [19, 18, 17, 16].slice(0, lines), lines });
            const jets = fountainsOf(world).map((jet) => [jet.x, jet.z]);
            const foot = world.choreo.scene.foot[0];
            run(world, camera, 0.6);
            const { balls } = world.getState();
            return {
                camera, world, clears, jets, balls, left: jets.filter(([x]) => x < foot), right: jets.filter(([x]) => x > foot),
            };
        };
        const one = clear(1);
        const two = clear(2);
        const three = clear(3);
        const four = clear(4);
        // Two lines: the sea stands up either side of the card.
        expect(two.left.length).toBeGreaterThan(0);
        expect(two.right.length).toBeGreaterThan(0);
        expect(two.balls[GROUP_LEFT]).toBeGreaterThan(0);
        expect(two.balls[GROUP_RIGHT]).toBeGreaterThan(0);
        // Three: more on each side.
        expect(three.left.length).toBeGreaterThan(two.left.length);
        expect(three.right.length).toBeGreaterThan(two.right.length);
        expect(three.balls[GROUP_LEFT]).toBeGreaterThan(two.balls[GROUP_LEFT]);
        expect(three.balls[GROUP_RIGHT]).toBeGreaterThan(two.balls[GROUP_RIGHT]);
        // One raises none, and four are the Great Drop's own.
        for (const none of [one, four]) {
            expect(none.jets).toHaveLength(0);
            expect(none.balls[GROUP_LEFT] + none.balls[GROUP_RIGHT]).toBe(0);
        }
        // Every one of them (the outer pair of three included) stands in open sea, in the frame.
        const rects = { card: cardUnion(three.world.layout), hud: three.world.layout.hud };
        const foot = three.world.choreo.scene.foot[0];
        three.jets.forEach((jet, i) => expectOpenSea(jet, jet[0] < foot ? 0 : 1, rects, 1600 / 900, `jet ${i}`));
        // The clear was handed the world's own sites.
        expect(two.clears[0].fountains.map((site) => [...site])).toEqual(two.jets);
        // A fountain is the sea's own liquid: it falls back and leaves nothing in the water.
        run(two.world, two.camera, 5);
        expect(two.world.choreo.isBusy()).toBe(false);
        expect(two.world.getState()).toMatchObject({ stains: 0 });
        expect(two.world.getState().balls[GROUP_LEFT] + two.world.getState().balls[GROUP_RIGHT]).toBe(0);
        for (const { world } of [one, two, three, four]) world.dispose();
    });

    it('raises none where there is no sea beside the card: a phone\'s card, a row of boards, a click', () => {
        for (const [label, layout, width, height, player] of [
            ['phone', PHONE, 430, 932, 0], ['row of boards', ROW, 1920, 1080, 2],
        ]) {
            const { camera, world } = makeWorld('Low', { width, height, layout });
            expect(world.fountainSites(layout.boards[player]), label).toEqual([null, null]);
            for (const lines of [2, 3]) {
                world.onClear({ rows: [19, 18, 17].slice(0, lines), lines, player });
                expect(fountainsOf(world), `${label}, ${lines} lines`).toHaveLength(0);
                run(world, camera, 0.5);
                // (the packet still runs)
                expect(world.getState().waves, label).toBeGreaterThan(0);
            }
            world.dispose();
        }
        // A click in the meditation mode clears no row of a board: no fountain either.
        const { world } = makeWorld('Low');
        world.onClear({ lines: 2, rows: [], screen: { x: 0.3, y: 0.8 } });
        expect(fountainsOf(world)).toHaveLength(0);
        // The same clear on the board raises them.
        world.onClear({ lines: 2, rows: [19, 18] });
        expect(fountainsOf(world).length).toBeGreaterThan(0);
        world.dispose();
    });

    it('throws a hard drop\'s coronet and a back-to-back\'s string of beads through the spray pool', () => {
        const { camera, world } = makeWorld('Low');
        const spray = recordSpray(world);
        world.onLock({ u: 0.2, rows: [12], color: '#00E5FF' });
        run(world, camera, FLIGHT_TIME + 0.2);
        expect(spray.filter((burst) => burst.kind === 'coronet')).toHaveLength(0);
        world.onLock({
            u: 0.8, rows: [12], hardDrop: true, color: '#FFD93D',
        });
        run(world, camera, FLIGHT_TIME + 0.2);
        const coronets = spray.filter((burst) => burst.kind === 'coronet');
        expect(coronets).toHaveLength(1);
        expect(coronets[0].color).toEqual(pieceColor('#FFD93D'));
        // A back-to-back: beads leap from the kin, one after another, and the pool's own closed
        // form lands each in the Great Drop as its life runs out.
        spray.length = 0;
        const hero = world.u.hero.value.clone();
        const now = world.u.time.value;
        world.onClear({
            rows: [19, 18], lines: 2, twist: true, b2b: true,
        });
        const beads = spray.filter((burst) => burst.kind === 'bridge');
        expect(beads.length).toBeGreaterThan(3);
        beads.forEach((bead, i) => {
            expect(bead.time).toBeGreaterThan(now);
            if (i > 0) expect(bead.time).toBeGreaterThan(beads[i - 1].time);
            expect(bead.x + bead.vel[0] * bead.life).toBeCloseTo(hero.x, 6);
            expect(sprayHeight(bead.y, bead.vel[1], bead.life)).toBeCloseTo(hero.y, 6);
            expect(bead.z + bead.vel[2] * bead.life).toBeCloseTo(hero.z, 6);
        });
        // They leave the side the kin float on, for the side the Drop hangs on.
        expect(Math.sign(beads[0].x)).toBe(Math.sign(world.choreo.scene.kin[0]));
        expect(Math.sign(beads[0].vel[0])).toBe(Math.sign(hero.x - beads[0].x));
        for (const burst of spray) expect(SPRAY_KINDS[burst.kind], burst.kind).toBeTruthy();
        const pool = world.parts.spray.geometry;
        for (const name of ['aBirth', 'aVel', 'aTint']) {
            expect(Array.from(pool.getAttribute(name).array).every(Number.isFinite), name).toBe(true);
        }
        // Under reduced motion nothing leaps across the frame.
        world.setReducedMotion(true);
        spray.length = 0;
        world.onClear({
            rows: [19, 18], lines: 2, twist: true, b2b: true,
        });
        expect(spray.filter((burst) => burst.kind === 'bridge')).toHaveLength(0);
        world.dispose();
    });

    it('throws a burst exactly as it is told to: a velocity, a life, a ring sized by its power', () => {
        const { world } = makeWorld('Minimal');
        const spray = createSpray(world.u, 64);
        const births = spray.geometry.getAttribute('aBirth');
        const velocities = spray.geometry.getAttribute('aVel');
        // A bead of the bridge: thrown the way it is told, give or take the kind's own scatter, for the life it is given.
        const vel = [-13, 10, 4];
        spray.emit({
            kind: 'bridge', x: 16, y: 6, z: -30, color: [...DREAMFIRE], power: 1, time: 20, vel, life: 1.9,
        });
        const beads = thrown(spray);
        expect(beads).toBeGreaterThan(0);
        const spec = SPRAY_KINDS.bridge;
        for (let i = 0; i < beads; i++) {
            expect(velocities.getW(i)).toBeCloseTo(1.9, 5);
            expect(Math.hypot(velocities.getX(i) - vel[0], velocities.getZ(i) - vel[2])).toBeLessThanOrEqual(spec.out[1] + 1e-5);
            expect(velocities.getY(i) - vel[1]).toBeGreaterThanOrEqual(spec.up[0] - 1e-5);
            expect(velocities.getY(i) - vel[1]).toBeLessThanOrEqual(spec.up[1] + 1e-5);
            expect(births.getW(i)).toBeGreaterThanOrEqual(20);
            expect(births.getW(i)).toBeLessThan(20.1);
        }
        // Told nothing, a burst lives within its kind's own range.
        spray.reset();
        spray.emit({
            kind: 'coronet', x: 0, y: 0.05, z: -9, color: [1, 1, 1], power: 1, time: 5,
        });
        const coronet = SPRAY_KINDS.coronet;
        for (let i = 0; i < thrown(spray); i++) {
            expect(velocities.getW(i)).toBeGreaterThanOrEqual(coronet.life[0] - 1e-5);
            expect(velocities.getW(i)).toBeLessThanOrEqual(coronet.life[1] + 1e-5);
            // (a ring of beads thrown up and out)
            expect(velocities.getY(i)).toBeGreaterThan(0);
            expect(Math.hypot(velocities.getX(i), velocities.getZ(i))).toBeGreaterThan(0);
        }
        // A bubble's burst: its power is the bubble's size (the ring its drops start on), not their speed.
        const ringOf = (power) => {
            spray.reset();
            spray.emit({
                kind: 'pop', x: 3, y: 20, z: -60, color: [0.9, 0.95, 1], power, time: 7,
            });
            let ring = 0;
            let speed = 0;
            for (let i = 0; i < thrown(spray); i++) {
                ring = Math.max(ring, Math.hypot(births.getX(i) - 3, births.getZ(i) + 60));
                speed = Math.max(speed, Math.hypot(velocities.getX(i), velocities.getZ(i)));
            }
            return { ring, speed };
        };
        const small = ringOf(1.5);
        const large = ringOf(3);
        expect(large.ring).toBeCloseTo(small.ring * 2, 4);
        expect(small.speed).toBeLessThanOrEqual(SPRAY_KINDS.pop.out[1] + 1e-5);
        expect(large.speed).toBeLessThanOrEqual(SPRAY_KINDS.pop.out[1] + 1e-5);
        spray.geometry.dispose();
        spray.material.dispose();
        world.dispose();
    });
});
