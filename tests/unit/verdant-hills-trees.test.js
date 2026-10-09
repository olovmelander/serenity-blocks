import { readFileSync } from 'node:fs';
import {
    afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    VERDANT_HILLS_TREE_URLS, disposeVerdantHillsAssets, parseVerdantHillsMeshes, parseVerdantHillsTree,
    verdantHillsImpostorLayout,
} from '../../src/themes/verdant-hills/verdant-hills-assets.js';
import { VerdantHillsBackdrop } from '../../src/themes/verdant-hills/verdant-hills-backdrop.js';
import {
    VERDANT_HILLS_VIEWS, createVerdantHillsVisibilityTest, verdantHillsEye,
} from '../../src/themes/verdant-hills/verdant-hills-composition.js';
import {
    VERDANT_HILLS_FEATURE_TREES, VERDANT_HILLS_FIELD_TREE_CEILING, VERDANT_HILLS_SHADOW_REACH,
    VERDANT_HILLS_SPRITE_CELLS, VERDANT_HILLS_TREE_SHAPES, layoutVerdantHillsFarTrees, layoutVerdantHillsFieldTrees,
    verdantHillsRange,
} from '../../src/themes/verdant-hills/verdant-hills-layout.js';
import {
    VERDANT_HILLS_SUN_DIRECTION, VerdantHillsLight,
} from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import {
    VERDANT_HILLS_PLACES, verdantHillsGroundHeight,
} from '../../src/themes/verdant-hills/verdant-hills-terrain.js';
import { VERDANT_HILLS_OAK_RAMP, VerdantHillsTrees } from '../../src/themes/verdant-hills/verdant-hills-trees.js';
import { seededRandom } from '../../src/utils/helpers.js';

const assetDirectory = new URL('../../src/themes/verdant-hills/assets/', import.meta.url);
const TREE_NAMES = Object.keys(VERDANT_HILLS_TREE_URLS);
/** Dearest first: what a tier draws may only shrink along this list. */
const TIERS = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
// The tiers built once and shared by the scene-contract tests.
const BUILT = ['High', 'Low', 'Minimal'];
// Parsing the pack and planting the far trees takes a second or so on a busy machine.
const SLOW = 180000;
const { oak } = VERDANT_HILLS_PLACES;
// Every spray the trees wear: two variants of each kind.
const SPRAYS = ['oak_spray_0', 'oak_spray_1', 'oak_tuft_0', 'oak_tuft_1'];
const owned = [];
const bundles = [];
const files = new Map();

async function parseGlb(file) {
    if (!files.has(file)) {
        const bytes = readFileSync(new URL(file, assetDirectory));
        files.set(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return new GLTFLoader().parseAsync(files.get(file).slice(0), '');
}

/** The real asset pack, parsed from disk; the sprite sheet is a stand-in data texture. */
async function loadBundle({ trees = TREE_NAMES, impostors = true, track = true } = {}) {
    const [foliage, ...gltfs] = await Promise.all([parseGlb('verdant-foliage.glb'),
        ...trees.map((name) => parseGlb(`${name}.glb`))]);
    const assets = { foliage: parseVerdantHillsMeshes(foliage, 'Foliage'), trees: {}, impostors: null };
    trees.forEach((name, index) => { assets.trees[name] = parseVerdantHillsTree(gltfs[index], name); });
    if (impostors) {
        const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
        assets.impostors = { ...verdantHillsImpostorLayout(), texture };
    }
    if (track) bundles.push(assets);
    return assets;
}

/** The oaks and the far trees of one tier, on a light rig of their own. */
function plant(quality, assets, { track = true } = {}) {
    const tier = VERDANT_HILLS_TIERS[quality];
    const light = new VerdantHillsLight({ tier, rng: seededRandom(7) });
    const trees = new VerdantHillsTrees({ light, assets, tier });
    const backdrop = new VerdantHillsBackdrop({ light, impostors: assets.impostors, tier });
    if (track) owned.push(backdrop, trees, light);
    return {
        tier, light, trees, backdrop, assets,
    };
}

function drawables(group) {
    const meshes = [];
    group.traverse((object) => { if (object.isMesh) meshes.push(object); });
    return meshes;
}

function named(group, pattern) {
    return drawables(group).filter((mesh) => (
        typeof pattern === 'string' ? mesh.name === pattern : pattern.test(mesh.name)));
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
/** Which tree stands where, without what a placement adds to it. */
const standing = ({ asset, x, z }) => ({ asset, x, z });

/** Position, turn and scale of every instance of an instanced mesh. */
function instances(mesh) {
    const matrix = new THREE.Matrix4();
    const result = [];
    for (let index = 0; index < mesh.count; index++) {
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        mesh.getMatrixAt(index, matrix);
        matrix.decompose(position, rotation, scale);
        result.push({ position, rotation, scale });
    }
    return result;
}

function allFinite(array) {
    for (let index = 0; index < array.length; index++) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}

afterEach(() => {
    owned.splice(0).forEach((resource) => resource.dispose());
    bundles.splice(0).forEach((assets) => disposeVerdantHillsAssets(assets));
    vi.restoreAllMocks();
});

describe('Verdant Hills trees: the old oak and the oaks of the downs', () => {
    const downs = {};

    beforeAll(async () => {
        const packs = await Promise.all(BUILT.map(() => loadBundle({ track: false })));
        BUILT.forEach((quality, index) => {
            downs[quality] = plant(quality, packs[index], { track: false });
            downs[quality].trees.build();
            downs[quality].backdrop.build();
        });
    }, SLOW);

    afterAll(() => {
        BUILT.forEach((quality) => {
            const {
                trees, backdrop, light, assets,
            } = downs[quality];
            backdrop.dispose();
            trees.dispose();
            light.dispose();
            disposeVerdantHillsAssets(assets);
        });
    });

    it('models the hand-placed trees and a prefix of the field trees, fewer as the tier drops', () => {
        const field = layoutVerdantHillsFieldTrees();
        for (const quality of BUILT) {
            const { trees, tier } = downs[quality];
            expect(trees.stats.trees, quality).toBe(VERDANT_HILLS_FEATURE_TREES.length + tier.fieldTrees);
            expect(trees.placements.map(standing), quality)
                .toEqual([...VERDANT_HILLS_FEATURE_TREES, ...field.slice(0, tier.fieldTrees)].map(standing));
            // One bark draw per specimen, holding every tree grown from it.
            const bark = named(trees.group, /^VerdantHillsBark /);
            expect(bark.map((mesh) => mesh.name).sort(), quality)
                .toEqual([...new Set(trees.placements.map((tree) => `VerdantHillsBark ${tree.asset}`))].sort());
            expect(sum(bark.map((mesh) => mesh.count)), quality).toBe(trees.stats.trees);
            // Two variants of each spray, one draw apiece.
            expect(named(trees.group, /^VerdantHillsFoliage /).map((mesh) => mesh.name).sort(), quality)
                .toEqual(SPRAYS.map((key) => `VerdantHillsFoliage ${key}`));
            expect(sum(named(trees.group, /^VerdantHillsFoliage /).map((mesh) => mesh.count)), quality)
                .toBe(trees.stats.sprays);
        }
        const [high, low, minimal] = BUILT.map((quality) => downs[quality].trees.stats);
        expect(high.trees).toBeGreaterThan(low.trees);
        expect(low.trees).toBeGreaterThan(minimal.trees);
        expect(high.sprays).toBeGreaterThan(low.sprays);
        expect(low.sprays).toBeGreaterThan(minimal.sprays);
        expect(high.foliageTriangles).toBeGreaterThan(low.foliageTriangles);
        expect(low.foliageTriangles).toBeGreaterThan(minimal.foliageTriangles);
        expect(high.barkTriangles).toBeGreaterThan(low.barkTriangles);
        // The old oak is most of it: its crown alone is hundreds of sprays even on the cheapest tier.
        expect(sum(named(downs.Minimal.trees.group, /oak_spray/).map((mesh) => mesh.count))).toBeGreaterThan(300);
        expect(high.foliageTriangles).toBeLessThan(1.3e6);
    });

    it('roots every tree in the ground at its place, turned and scaled as the layout says', () => {
        for (const quality of BUILT) {
            const { trees, assets } = downs[quality];
            for (const mesh of named(trees.group, /^VerdantHillsBark /)) {
                const asset = mesh.name.slice('VerdantHillsBark '.length);
                const placed = trees.placements.filter((tree) => tree.asset === asset);
                expect(mesh.geometry).toBe(assets.trees[asset].bark);
                expect(allFinite(mesh.instanceMatrix.array)).toBe(true);
                expect(mesh.frustumCulled).toBe(false);
                instances(mesh).forEach(({ position, rotation, scale }, index) => {
                    const tree = placed[index];
                    expect(position.x).toBeCloseTo(tree.x, 4);
                    expect(position.z).toBeCloseTo(tree.z, 4);
                    // Bedded a few centimetres, never floating.
                    expect(verdantHillsGroundHeight(tree.x, tree.z) - position.y).toBeCloseTo(0.05, 4);
                    expect(scale.x).toBeCloseTo(tree.scale, 4);
                    expect(scale.y).toBeCloseTo(tree.scale, 4);
                    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tree.yaw);
                    expect(Math.abs(rotation.dot(turned))).toBeCloseTo(1, 4);
                });
            }
        }
        // The old oak stands on its terrace; its long bough reaches right and a little toward the lens.
        const { trees, assets } = downs.High;
        const [hero] = trees.placements;
        expect(hero).toMatchObject({
            asset: 'oak-hero', x: oak.x, z: oak.z, casts: true,
        });
        const tip = trees.anchor('oak-hero', 'boughTip');
        expect(tip.x - oak.x).toBeGreaterThan(9);
        expect(tip.z - oak.z).toBeGreaterThan(2);
        expect(tip.y - hero.y).toBeGreaterThan(4.5);
        expect(tip.y - hero.y).toBeLessThan(7.5);
        // An anchor is the pack's own point, turned with the tree and set on its foot.
        const swing = trees.anchor('oak-hero', 'swing');
        const local = new THREE.Vector3(...assets.trees['oak-hero'].anchors.swing)
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), hero.yaw);
        expect(swing.x).toBeCloseTo(hero.x + local.x, 6);
        expect(swing.y).toBeCloseTo(hero.y + local.y, 6);
        expect(swing.z).toBeCloseTo(hero.z + local.z, 6);
        expect(Math.hypot(swing.x - oak.x, swing.z - oak.z)).toBeCloseTo(5, 1);
        expect(trees.anchor('oak-hero', 'nothing')).toBeNull();
        expect(trees.anchor('oak-field-a', 'swing')).toBeNull();
        expect(trees.anchor('elm', 'swing')).toBeNull();
    });

    it('hangs each tree\'s sprays in its own crown', () => {
        const { trees, assets } = downs.High;
        for (const mesh of named(trees.group, /^VerdantHillsFoliage /)) {
            const kind = mesh.name.slice('VerdantHillsFoliage '.length).replace(/_\d+$/, '');
            const wearers = trees.placements.filter((tree) => assets.trees[tree.asset].foliage === kind);
            expect(mesh.geometry).toBe(assets.foliage.meshes[mesh.name.slice('VerdantHillsFoliage '.length)]);
            expect(allFinite(mesh.instanceMatrix.array)).toBe(true);
            for (const { position, scale } of instances(mesh)) {
                // Inside the crown of some tree that wears this spray: its spread and its height.
                const home = wearers.find((tree) => {
                    const shape = VERDANT_HILLS_TREE_SHAPES[tree.asset];
                    const reach = (shape.spread / 2 + 1) * tree.scale;
                    const up = position.y - tree.y;
                    return Math.hypot(position.x - tree.x, position.z - tree.z) < reach
                        && up > 1 && up < (shape.height + 1) * tree.scale;
                });
                expect(home, `${mesh.name} at ${position.x.toFixed(1)}, ${position.z.toFixed(1)}`).toBeDefined();
                expect(scale.x).toBeGreaterThan(0.3);
                expect(scale.x).toBeLessThan(5);
                expect(scale.y).toBeCloseTo(scale.x, 3);
            }
        }
        // The old oak wears the finely modelled spray, the field trees the light tuft.
        expect(assets.trees['oak-hero'].foliage).toBe('oak_spray');
        expect(assets.trees['oak-field-a'].foliage).toBe('oak_tuft');
    });

    it('draws only the sprays the lens can see or whose shade falls where it looks', () => {
        const visible = createVerdantHillsVisibilityTest();
        const sun = VERDANT_HILLS_SUN_DIRECTION;
        const { trees } = downs.High;
        const [hero] = trees.placements;
        // Most of the old oak's crown is above the frame: a good part of it is never built.
        expect(trees.stats.culledSprays).toBeGreaterThan(400);
        const kept = named(trees.group, /oak_spray/).flatMap((mesh) => instances(mesh));
        expect(kept.length).toBeGreaterThan(600);
        for (const { position, scale } of kept) {
            // In the frame itself, or laying its shade inside it (the sun stands ahead of the
            // lens, so what shades the frame is nearly always in it too).
            const seen = visible(position.x, position.y, position.z, scale.x * 1.2);
            const drop = (position.y - hero.y) / sun.y;
            const shades = visible(position.x - sun.x * drop, hero.y, position.z - sun.z * drop, scale.x * 1.5);
            expect(seen || shades).toBe(true);
        }
        // The sprays that are drawn hang low and ahead; those left out are the top and the back of the crown.
        const mean = kept.reduce((total, { position }) => total + position.y, 0) / kept.length - hero.y;
        expect(mean).toBeLessThan(10.2);
        // A tree beyond the shadow map earns no exception either: what the lens cannot see is not drawn.
        const far = trees.placements.filter((tree) => !tree.casts);
        for (const mesh of named(trees.group, /oak_tuft/)) {
            for (const { position, scale } of instances(mesh)) {
                const near = far.every((tree) => Math.hypot(position.x - tree.x, position.z - tree.z) > 9);
                if (!near) expect(visible(position.x, position.y, position.z, scale.x * 1.2)).toBe(true);
            }
        }
    });

    it('thins the crowns as the tier drops and as the trees recede, and lets the survivors grow', () => {
        const meanScale = (quality, pattern) => {
            const scales = named(downs[quality].trees.group, pattern).flatMap((mesh) => instances(mesh))
                .map(({ scale }) => scale.x);
            return sum(scales) / scales.length;
        };
        // Fewer sprays on a cheaper tier, each a little larger, so a crown stays closed.
        expect(meanScale('Minimal', /oak_spray/)).toBeGreaterThan(meanScale('High', /oak_spray/) * 1.2);
        expect(meanScale('Minimal', /oak_tuft/)).toBeGreaterThan(meanScale('High', /oak_tuft/) * 1.2);
        // A field tree keeps a smaller share of its sites than the gate oak beside the path does.
        const { trees, assets } = downs.High;
        const tufts = named(trees.group, /oak_tuft/).flatMap((mesh) => instances(mesh));
        const share = (tree) => tufts.filter(({ position }) => (
            Math.hypot(position.x - tree.x, position.z - tree.z) < 7 * tree.scale)).length
            / assets.trees[tree.asset].sites.count;
        const gateOak = trees.placements[1];
        const distant = trees.placements.filter((tree) => tree.far && verdantHillsRange(tree.x, tree.z) > 500);
        expect(gateOak.far).toBeFalsy();
        expect(distant.length).toBeGreaterThan(3);
        for (const tree of distant) expect(share(tree)).toBeLessThan(share(gateOak) * 0.75);
    });

    it('casts the home hill\'s trees into the shadow map and keeps their shading out of colorNode', () => {
        for (const quality of BUILT) {
            const { trees, assets } = downs[quality];
            for (const tree of trees.placements) {
                expect(tree.casts).toBe(verdantHillsRange(tree.x, tree.z) <= VERDANT_HILLS_SHADOW_REACH);
            }
            for (const mesh of named(trees.group, /^VerdantHillsBark /)) {
                const asset = mesh.name.slice('VerdantHillsBark '.length);
                const casts = trees.placements.some((tree) => tree.asset === asset && tree.casts);
                expect(mesh.castShadow, mesh.name).toBe(casts);
            }
            for (const mesh of named(trees.group, /^VerdantHillsFoliage /)) {
                const kind = mesh.name.slice('VerdantHillsFoliage '.length).replace(/_\d+$/, '');
                const casts = trees.placements.some((tree) => tree.casts && assets.trees[tree.asset].foliage === kind);
                expect(mesh.castShadow, mesh.name).toBe(casts);
            }
            // The old oak and the gate oak are the home hill's trees.
            expect(named(trees.group, 'VerdantHillsBark oak-hero')[0].castShadow).toBe(true);
            expect(trees.placements.filter((tree) => tree.casts)).toHaveLength(2);
            for (const mesh of drawables(trees.group)) {
                // A caster's colorNode is drawn in the shadow pass, where it may not read the map.
                expect(mesh.material.fragmentNode, mesh.name).toBeTruthy();
                expect(mesh.material.colorNode, mesh.name).toBeFalsy();
                expect(mesh.material.fog).toBe(false);
                expect(mesh.matrixAutoUpdate).toBe(false);
            }
        }
    });

    it('draws the limbs only where the tier affords them', () => {
        for (const quality of BUILT) {
            const { trees, tier, assets } = downs[quality];
            for (const mesh of named(trees.group, /^VerdantHillsBark /)) {
                const asset = assets.trees[mesh.name.slice('VerdantHillsBark '.length)];
                const drawn = mesh.geometry.drawRange.count;
                if (tier.limbs) expect(drawn, mesh.name).toBeGreaterThanOrEqual(asset.bark.index.count);
                else expect(drawn, mesh.name).toBe(asset.barkCoreIndices);
            }
        }
        expect(VERDANT_HILLS_TIERS.High.limbs).toBe(true);
        expect(VERDANT_HILLS_TIERS.Low.limbs).toBe(false);
    });

    it('offers points among the near crowns for what flies through them', () => {
        const { trees } = downs.High;
        const points = trees.sampleCrownPoints(40, seededRandom(3));
        expect(points).toHaveLength(120);
        const near = trees.placements.filter((tree) => !tree.far);
        expect(near).toHaveLength(2);
        for (let index = 0; index < points.length; index += 3) {
            const [x, y, z] = points.slice(index, index + 3);
            const home = near.find((tree) => Math.hypot(x - tree.x, z - tree.z) < 13 * tree.scale);
            expect(home).toBeDefined();
            expect(y - home.y).toBeGreaterThan(1);
            expect(y - home.y).toBeLessThan(17);
        }
        expect(trees.sampleCrownPoints(40, seededRandom(3))).toEqual(points);
    });

    it('paints the far trees from the oak\'s own ramp', () => {
        expect(VERDANT_HILLS_OAK_RAMP).toHaveLength(4);
        // From the dark heart of a crown to sunlit green: each stop lighter, and always green.
        const stops = VERDANT_HILLS_OAK_RAMP.map((hex) => new THREE.Color(hex));
        for (let index = 1; index < stops.length; index++) {
            expect(stops[index].g).toBeGreaterThan(stops[index - 1].g);
        }
        stops.forEach((stop) => {
            expect(stop.g).toBeGreaterThan(stop.r);
            expect(stop.g).toBeGreaterThan(stop.b);
        });
    });
});

describe('Verdant Hills trees: ownership', () => {
    it('disposes what it made, once, and leaves the pack to its owner', async () => {
        const assets = await loadBundle();
        const { trees } = plant('Minimal', assets);
        trees.build();
        const meshes = drawables(trees.group);
        const materials = [...new Set(meshes.map((mesh) => mesh.material))];
        expect(meshes.length).toBe(8);
        // Each draw owns its material: its instance data is part of the node graph.
        expect(materials).toHaveLength(meshes.length);
        const mine = [...materials, ...meshes].map((resource) => vi.spyOn(resource, 'dispose'));
        const barks = Object.values(assets.trees).map((tree) => tree.bark);
        const shared = [...Object.values(assets.foliage.meshes), ...barks]
            .map((geometry) => vi.spyOn(geometry, 'dispose'));
        const parent = new THREE.Group();
        parent.add(trees.group);
        trees.dispose();
        mine.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        shared.forEach((disposal) => expect(disposal).not.toHaveBeenCalled());
        expect(parent.children).toHaveLength(0);
        expect(trees.group.children).toHaveLength(0);
        expect(() => trees.dispose()).not.toThrow();
        mine.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    }, SLOW);

    // The bark geometry is borrowed from the asset bundle. A tier without limbs narrows its draw
    // range only while those trees exist; dispose() hands the range back.
    it('hands a borrowed asset bundle back as it found it, whatever the tier', async () => {
        const assets = await loadBundle();
        const ranges = () => Object.values(assets.trees).map((tree) => ({ ...tree.bark.drawRange }));
        const pristine = ranges();
        const low = plant('Minimal', assets);
        low.trees.build();
        expect(ranges()).not.toEqual(pristine);
        low.trees.dispose();
        expect(ranges()).toEqual(pristine);
        const high = plant('Medium', assets);
        high.trees.build();
        for (const mesh of named(high.trees.group, /^VerdantHillsBark /)) {
            expect(mesh.geometry.drawRange.count, mesh.name).toBeGreaterThanOrEqual(mesh.geometry.index.count);
        }
    }, SLOW);

    it('names the missing spray when the foliage pack lacks one, and still cleans up', async () => {
        const assets = await loadBundle();
        const removed = assets.foliage.meshes.oak_tuft_1;
        delete assets.foliage.meshes.oak_tuft_1;
        const { trees } = plant('Minimal', assets);
        expect(() => trees.build())
            .toThrow('[Verdant Hills] Foliage mesh "oak_tuft_1" is missing from the asset pack.');
        expect(() => trees.dispose()).not.toThrow();
        expect(trees.group.children).toHaveLength(0);
        removed.dispose();
    }, SLOW);

    it.each([
        ['the old oak alone', ['oak-hero']],
        ['one field tree', ['oak-field-b']],
        ['no trees at all', []],
    ])('builds from whichever trees were loaded: %s', async (_label, names) => {
        const assets = await loadBundle({ trees: names });
        const { trees } = plant('Minimal', assets);
        expect(trees.build()).toBe(trees);
        expect(trees.placements.every((tree) => names.includes(tree.asset))).toBe(true);
        expect(named(trees.group, /^VerdantHillsBark /).map((mesh) => mesh.name).sort())
            .toEqual([...new Set(trees.placements.map((tree) => `VerdantHillsBark ${tree.asset}`))].sort());
        expect(trees.stats.trees).toBe(trees.placements.length);
        expect(trees.stats.trees)
            .toBeLessThan(VERDANT_HILLS_FEATURE_TREES.length + VERDANT_HILLS_TIERS.Minimal.fieldTrees);
        if (!names.length) {
            expect(drawables(trees.group)).toEqual([]);
            expect(trees.sampleCrownPoints(5)).toHaveLength(0);
        }
        if (!names.includes('oak-hero')) expect(trees.anchor('oak-hero', 'swing')).toBeNull();
    }, SLOW);
});

describe('Verdant Hills far trees', () => {
    const packs = {};

    beforeAll(async () => {
        packs.assets = await loadBundle({ trees: [], track: false });
    }, SLOW);

    afterAll(() => disposeVerdantHillsAssets(packs.assets));

    it('draws the tier\'s far trees and every field tree the tier does not model, in one draw', () => {
        let previous = Infinity;
        for (const quality of TIERS) {
            const { backdrop, tier } = plant(quality, packs.assets);
            expect(backdrop.build()).toBe(backdrop);
            const unmodelled = VERDANT_HILLS_FIELD_TREE_CEILING - tier.fieldTrees;
            expect(backdrop.count, quality).toBe(tier.farTrees + unmodelled);
            expect(backdrop.stats, quality).toEqual({ farTrees: tier.farTrees, fieldSprites: unmodelled });
            const meshes = drawables(backdrop.group);
            expect(meshes.map((mesh) => mesh.name)).toEqual(['VerdantHillsFarTrees']);
            expect(meshes[0].count).toBe(backdrop.count);
            expect(meshes[0]).toBe(backdrop.mesh);
            // Too far for the shadow map: their shade is in the land.
            expect(meshes[0].castShadow).toBe(false);
            expect(meshes[0].frustumCulled).toBe(false);
            expect(backdrop.count).toBeLessThan(previous);
            previous = backdrop.count;
        }
    }, SLOW);

    it('stands every field tree somewhere on every tier: modelled, or as its own sprite', () => {
        const field = layoutVerdantHillsFieldTrees();
        for (const quality of TIERS) {
            const { backdrop, tier } = plant(quality, packs.assets);
            const cards = backdrop.layout();
            const modelled = field.slice(0, tier.fieldTrees);
            const sprites = cards.slice(tier.farTrees);
            expect(modelled.length + sprites.length, quality).toBe(field.length);
            sprites.forEach((card, index) => {
                const tree = field[tier.fieldTrees + index];
                expect(card.x).toBe(tree.x);
                expect(card.z).toBe(tree.z);
                // The same tree at the same size: the sprite of its own specimen, scaled as it is.
                expect(card.tile.asset).toBe(tree.asset);
                expect(card.scale).toBeCloseTo(tree.scale, 9);
                expect(card.tone).toBe(tree.tone);
                expect(card.flip).toBe(false);
            });
            // The far trees of the tier are the nearest of the whole list.
            const far = layoutVerdantHillsFarTrees(null, tier.farTrees);
            cards.slice(0, tier.farTrees).forEach((card, index) => {
                expect(card.x).toBe(far[index].x);
                expect(card.z).toBe(far[index].z);
                expect(card.tile.asset).toBe(VERDANT_HILLS_SPRITE_CELLS[far[index].cell]);
            });
        }
    }, SLOW);

    it('stands each card upright on the ground at its tree, facing the lens, at the tree\'s size', () => {
        const { backdrop } = plant('High', packs.assets);
        backdrop.build();
        const cards = backdrop.layout();
        const eye = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);
        const { impostors } = packs.assets;
        const far = layoutVerdantHillsFarTrees(null, VERDANT_HILLS_TIERS.High.farTrees);
        expect(allFinite(backdrop.mesh.instanceMatrix.array)).toBe(true);
        instances(backdrop.mesh).forEach(({ position, rotation, scale }, index) => {
            const card = cards[index];
            const shape = VERDANT_HILLS_TREE_SHAPES[card.tile.asset];
            // A card is a picture of the whole modelled tree: as tall as the tree it stands for.
            expect(scale.y).toBeCloseTo(card.tile.height * card.scale, 3);
            expect(scale.x).toBeCloseTo(card.tile.width * card.scale, 3);
            if (index < far.length) expect(scale.y / card.tile.height).toBeCloseTo(far[index].height / shape.height, 4);
            // Its foot a little into the turf.
            const sunk = verdantHillsGroundHeight(card.x, card.z) - position.y;
            expect(sunk).toBeGreaterThan(0.1);
            expect(sunk).toBeLessThan(0.4);
            // The trunk, not the middle of the tile, stands on the tree's place.
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
            const trunk = card.tile.trunk * scale.x * (card.flip ? -1 : 1);
            expect(position.x + right.x * trunk).toBeCloseTo(card.x, 3);
            expect(position.z + right.z * trunk).toBeCloseTo(card.z, 3);
            // Upright, and turned to the lens.
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
            expect(up.y).toBeCloseTo(1, 5);
            const face = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
            const toLens = new THREE.Vector3(eye[0] - card.x, 0, eye[2] - card.z).normalize();
            expect(face.dot(toLens)).toBeGreaterThan(0.9999);
        });
        // Every tile of the sheet lies inside it, and the instance data names it.
        const { array } = backdrop.mesh.material.fragmentNode ? backdrop.mesh.instanceMatrix : { array: [] };
        expect(array.length).toBe(backdrop.count * 16);
        for (const tile of impostors.tiles) {
            expect(tile.x + tile.pixels).toBeLessThanOrEqual(impostors.atlasWidth);
            expect(VERDANT_HILLS_SPRITE_CELLS).toContain(tile.asset);
            // The layout's table of shapes is this sheet's trees: a tile is the tree plus a margin.
            const shape = VERDANT_HILLS_TREE_SHAPES[tile.asset];
            expect(tile.height / shape.height).toBeGreaterThan(1);
            expect(tile.height / shape.height).toBeLessThan(1.08);
            expect(tile.width / shape.spread).toBeGreaterThan(1);
            expect(tile.width / shape.spread).toBeLessThan(1.12);
            expect(impostors.tiles.indexOf(tile)).toBe(shape.cell);
        }
    }, SLOW);

    it('draws nothing without the sprite sheet, and says so in its count', () => {
        for (const impostors of [null, undefined, { tiles: [], texture: null }]) {
            const tier = VERDANT_HILLS_TIERS.Minimal;
            const light = new VerdantHillsLight({ tier, rng: seededRandom(7) });
            const backdrop = new VerdantHillsBackdrop({ light, impostors, tier });
            owned.push(backdrop, light);
            expect(backdrop.build()).toBe(backdrop);
            expect(backdrop.count).toBe(0);
            expect(drawables(backdrop.group)).toEqual([]);
        }
    });

    it('disposes its card and its material, and leaves the sheet to its owner', () => {
        const { backdrop } = plant('Minimal', packs.assets);
        backdrop.build();
        const { mesh } = backdrop;
        const mine = [mesh, mesh.geometry, mesh.material].map((resource) => vi.spyOn(resource, 'dispose'));
        const sheet = vi.spyOn(packs.assets.impostors.texture, 'dispose');
        backdrop.dispose();
        mine.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(sheet).not.toHaveBeenCalled();
        expect(backdrop.group.children).toHaveLength(0);
        expect(backdrop.mesh).toBeNull();
        expect(() => backdrop.dispose()).not.toThrow();
        mine.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    });
});
