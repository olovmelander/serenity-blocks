import { readFileSync } from 'node:fs';
import {
    afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    disposeVerdantHillsAssets, parseVerdantHillsMeshes, parseVerdantHillsTree, verdantHillsPropRecord,
} from '../../src/themes/verdant-hills/verdant-hills-assets.js';
import {
    VERDANT_HILLS_SAIL_SPEED, VerdantHillsHomestead,
} from '../../src/themes/verdant-hills/verdant-hills-homestead.js';
import { VERDANT_HILLS_POST_HEIGHT, VerdantHillsKites } from '../../src/themes/verdant-hills/verdant-hills-kites.js';
import {
    VERDANT_HILLS_BENCH, VERDANT_HILLS_BOULDERS, VERDANT_HILLS_FEATURE_TREES, VERDANT_HILLS_GATE, VERDANT_HILLS_MILL,
    VERDANT_HILLS_POSTS, VERDANT_HILLS_WALL, VERDANT_HILLS_WALL_SECTION, layoutVerdantHillsSheep,
    layoutVerdantHillsWall, layoutVerdantHillsWallHeads, verdantHillsWallDistance,
} from '../../src/themes/verdant-hills/verdant-hills-layout.js';
import {
    VERDANT_HILLS_WIND_DIRECTION, VerdantHillsLight,
} from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import {
    VERDANT_HILLS_PLACES, VERDANT_HILLS_TERRACES, verdantHillsGroundHeight,
} from '../../src/themes/verdant-hills/verdant-hills-terrain.js';
import { seededRandom } from '../../src/utils/helpers.js';

const assetDirectory = new URL('../../src/themes/verdant-hills/assets/', import.meta.url);
/** Dearest first: what a tier draws may only shrink along this list. */
const TIERS = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
// Parsing the pack and planting the flock takes a second or so on a busy machine.
const SLOW = 180000;
const STEP = 1 / 60;
const UP = new THREE.Vector3(0, 1, 0);
const {
    oak, mill, gate, bench,
} = VERDANT_HILLS_PLACES;
/** Every prop the homestead draws straight from the pack, and what it builds itself. */
const FROM_THE_PACK = ['windmill', 'windmill_sails', 'wall', 'wall_head', 'gate', 'bench', 'post', 'boulder_a',
    'boulder_b', 'boulder_c', 'sheep_a', 'sheep_b'];
/** What stands on the home hill, inside the static shadow map. */
const CASTERS = ['wall', 'wall_head', 'gate', 'bench', 'post', 'boulder_a', 'boulder_b', 'boulder_c', 'swing'];
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

/** The real props and the old oak (for its swing anchor), parsed from disk. */
async function loadBundle({ track = true } = {}) {
    const [propsGltf, oakGltf] = await Promise.all([parseGlb('verdant-props.glb'), parseGlb('oak-hero.glb')]);
    const assets = {
        props: parseVerdantHillsMeshes(propsGltf, 'Props'),
        trees: { 'oak-hero': parseVerdantHillsTree(oakGltf, 'oak-hero') },
    };
    if (track) bundles.push(assets);
    return assets;
}

/** A homestead of one tier on a light rig of its own; `options.oak` stands in for the pack's old oak. */
function settle(quality, assets, options = {}) {
    const { track = true, props = assets?.props } = options;
    const hero = 'oak' in options ? options.oak : assets?.trees['oak-hero'] ?? null;
    const tier = VERDANT_HILLS_TIERS[quality];
    const light = new VerdantHillsLight({ tier, rng: seededRandom(7) });
    const homestead = new VerdantHillsHomestead({
        light, props, tier, oak: hero,
    });
    if (track) owned.push(homestead, light);
    return {
        tier, light, homestead, assets,
    };
}

function drawables(group) {
    const meshes = [];
    group.traverse((object) => { if (object.isMesh) meshes.push(object); });
    return meshes;
}

const prop = (homestead, name) => drawables(homestead.group).find((mesh) => mesh.name === `VerdantHills ${name}`);
const ground = (place) => verdantHillsGroundHeight(place.x, place.z);

/** The world matrix of every instance of an instanced mesh. */
function matrices(mesh) {
    const result = [];
    for (let index = 0; index < mesh.count; index++) {
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(index, matrix);
        result.push(matrix);
    }
    return result;
}

/** Position, turn and scale of every instance of an instanced mesh. */
function instances(mesh) {
    return matrices(mesh).map((matrix) => {
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        matrix.decompose(position, rotation, scale);
        return { position, rotation, scale };
    });
}

/** Where a point of a placed prop (in its own metres) stands in the world. */
function placed(place, [x, y, z]) {
    return new THREE.Vector3(x, y, z).applyAxisAngle(UP, place.yaw)
        .add(new THREE.Vector3(place.x, ground(place) - place.bed, place.z));
}

/** Run the homestead for some seconds of frames. */
function run(homestead, seconds, frame) {
    const frames = Math.round(seconds / STEP);
    for (let index = 0; index < frames; index++) homestead.update(index * STEP, STEP, frame);
}

afterEach(() => {
    owned.splice(0).forEach((resource) => resource.dispose());
    bundles.splice(0).forEach((assets) => disposeVerdantHillsAssets({ props: assets.props, trees: assets.trees }));
    vi.restoreAllMocks();
});

describe('Verdant Hills homestead: what people built on the downs', () => {
    const built = {};

    beforeAll(async () => {
        built.assets = await loadBundle({ track: false });
        for (const quality of ['High', 'Minimal']) {
            built[quality] = settle(quality, built.assets, { track: false });
            built[quality].homestead.build();
        }
    }, SLOW);

    afterAll(() => {
        for (const quality of ['High', 'Minimal']) {
            built[quality].homestead.dispose();
            built[quality].light.dispose();
        }
        disposeVerdantHillsAssets({ props: built.assets.props, trees: built.assets.trees });
    });

    it('draws every built thing straight from the pack, each kind in one draw, with one paint', () => {
        const { homestead, assets } = built.High;
        expect(drawables(homestead.group).map((mesh) => mesh.name).sort())
            .toEqual([...FROM_THE_PACK, 'swing'].map((name) => `VerdantHills ${name}`).sort());
        for (const name of FROM_THE_PACK) {
            const mesh = prop(homestead, name);
            expect(mesh.geometry, name).toBe(assets.props.meshes[name]);
            // One shader paints them all from their vertex colours.
            expect(mesh.material, name).toBe(homestead.painted);
            expect(mesh.frustumCulled).toBe(false);
            expect(mesh.matrixAutoUpdate).toBe(false);
        }
        // The swing is the homestead's own carpentry, on a paint of its own that lets it sway.
        const swing = prop(homestead, 'swing');
        expect(Object.values(assets.props.meshes)).not.toContain(swing.geometry);
        expect(swing.material).not.toBe(homestead.painted);
        expect(swing.material.positionNode).toBeTruthy();
        expect(homestead.painted.positionNode).toBeFalsy();
        expect(homestead.stats).toEqual({
            wallSections: layoutVerdantHillsWall().length,
            wallHeads: 6,
            posts: 7,
            boulders: VERDANT_HILLS_BOULDERS.length,
            sheep: VERDANT_HILLS_TIERS.High.sheep,
            swing: true,
        });
        expect(Object.keys(homestead.places).sort()).toEqual(['bench', 'gate', 'swing', 'windmill']);
    });

    it('casts the home hill\'s props into the shadow map and keeps every shading out of colorNode', () => {
        const { homestead } = built.High;
        for (const mesh of drawables(homestead.group)) {
            const name = mesh.name.slice('VerdantHills '.length);
            // The windmill and the flock stand far beyond the shadow map.
            expect(mesh.castShadow, name).toBe(CASTERS.includes(name));
            // A caster's colorNode is drawn in the shadow pass, where it may not read the map.
            expect(mesh.material.fragmentNode, name).toBeTruthy();
            expect(mesh.material.colorNode, name).toBeFalsy();
            expect(mesh.material.fog).toBe(false);
        }
    });

    it('beds the windmill on its terrace, its cap turned into the wind', () => {
        const { homestead } = built.High;
        const tower = prop(homestead, 'windmill');
        const level = verdantHillsGroundHeight(mill.x, mill.z);
        expect(tower.position.x).toBe(mill.x);
        expect(tower.position.z).toBe(mill.z);
        // Its base 15 cm into the turf: the plinth goes deeper still.
        expect(level - tower.position.y).toBeCloseTo(0.15, 9);
        expect(homestead.places.windmill).toMatchObject({ x: mill.x, y: tower.position.y, z: mill.z });
        // The whole foot of the tower, and the stage's posts, stand on ground the terrain levelled.
        const record = verdantHillsPropRecord('windmill');
        const terrace = VERDANT_HILLS_TERRACES.find((entry) => entry.x === mill.x && entry.z === mill.z);
        expect(terrace.radius).toBeGreaterThan(record.anchors.stage.outerRadius);
        for (let turn = 0; turn < Math.PI * 2; turn += 0.2) {
            const reach = record.anchors.stage.outerRadius;
            const at = verdantHillsGroundHeight(mill.x + Math.cos(turn) * reach, mill.z + Math.sin(turn) * reach);
            expect(Math.abs(at - level)).toBeLessThan(0.02);
        }
        // Its door and its sails face the way the wind comes from, which is very nearly the lens.
        const front = new THREE.Vector3(0, 0, 1).applyQuaternion(tower.quaternion);
        expect(-front.dot(VERDANT_HILLS_WIND_DIRECTION)).toBeGreaterThan(0.999);
        expect(front.dot(new THREE.Vector3(-mill.x, 0, -mill.z).normalize())).toBeGreaterThan(0.99);
        expect(tower.rotation.y).toBeCloseTo(VERDANT_HILLS_MILL.yaw, 9);
        // A named point of a prop is the pack's own, turned and set down with it.
        const cap = homestead.anchor('windmill', 'capTop');
        expect(cap.x).toBeCloseTo(mill.x, 6);
        expect(cap.z).toBeCloseTo(mill.z, 6);
        expect(cap.y - tower.position.y).toBeCloseTo(record.anchors.capTop[1], 6);
        expect(homestead.anchor('windmill', 'nothing')).toBeNull();
        expect(homestead.anchor('lighthouse', 'top')).toBeNull();
    });

    it('sets the sails on the nose of the windshaft, facing along it and clear of the tower and the ground', () => {
        const { homestead } = built.High;
        const { sails } = homestead;
        const record = verdantHillsPropRecord('windmill');
        const tower = prop(homestead, 'windmill');
        expect(sails).toBe(prop(homestead, 'windmill_sails'));
        const hub = new THREE.Vector3(...record.anchors.hub).applyAxisAngle(UP, VERDANT_HILLS_MILL.yaw)
            .add(tower.position);
        expect(sails.position.distanceTo(hub)).toBeLessThan(1e-6);
        expect(homestead.anchor('windmill', 'hub').distanceTo(hub)).toBeLessThan(1e-6);
        // The sails turn about their own +Z: it lies along the windshaft, tilted up a little.
        const shaft = new THREE.Vector3(...record.anchors.axis).applyAxisAngle(UP, VERDANT_HILLS_MILL.yaw).normalize();
        const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(sails.quaternion);
        expect(facing.dot(shaft)).toBeGreaterThan(0.999999);
        expect(facing.y).toBeGreaterThan(0.1);
        expect(facing.y).toBeLessThan(0.2);
        const wind = VERDANT_HILLS_WIND_DIRECTION;
        expect(-(facing.x * wind.x + facing.z * wind.z)).toBeGreaterThan(0.98);
        // The hub stands proud of the tower, and no sail sweeps the ground.
        const { radius } = verdantHillsPropRecord('windmill_sails').anchors;
        expect(Math.hypot(hub.x - mill.x, hub.z - mill.z)).toBeGreaterThan(record.anchors.topRadius + 0.8);
        expect(hub.y - radius - verdantHillsGroundHeight(mill.x, mill.z)).toBeGreaterThan(2.5);
        expect(sails.matrixAutoUpdate).toBe(false);
        // The matrix the renderer reads is the pose.
        const expected = new THREE.Matrix4().compose(sails.position, sails.quaternion, new THREE.Vector3(1, 1, 1));
        sails.matrix.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.elements[index], 9));
    });

    it('lays the wall over the ground section by section, both ends of each on the turf', () => {
        const { homestead } = built.High;
        const wall = prop(homestead, 'wall');
        const sections = layoutVerdantHillsWall();
        expect(wall.count).toBe(sections.length);
        expect(wall.count).toBeGreaterThan(30);
        const half = VERDANT_HILLS_WALL_SECTION / 2;
        matrices(wall).forEach((matrix, index) => {
            const section = sections[index];
            const ends = [new THREE.Vector3(-half, 0, 0), new THREE.Vector3(half, 0, 0)]
                .map((end) => end.applyMatrix4(matrix));
            ends.forEach((end, which) => {
                const level = verdantHillsGroundHeight(end.x, end.z);
                // Bedded a few centimetres, at both ends, whatever the slope: never floating.
                expect(end.y, `section ${index}`).toBeLessThanOrEqual(level + 1e-4);
                expect(level - end.y, `section ${index}`).toBeLessThan(0.06);
                const expected = which ? section.to : section.from;
                expect(end.distanceTo(new THREE.Vector3(expected.x, expected.y, expected.z))).toBeLessThan(1e-3);
            });
            // Raked, not tipped: its length follows the slope while its stones stand plumb,
            // as tall and as thick as they were modelled, and square across the run.
            const middle = new THREE.Vector3().applyMatrix4(matrix);
            const up = new THREE.Vector3(0, 1, 0).applyMatrix4(matrix).sub(middle);
            const across = new THREE.Vector3(0, 0, 1).applyMatrix4(matrix).sub(middle);
            expect(up.distanceTo(new THREE.Vector3(0, 1, 0)), `section ${index}`).toBeLessThan(1e-6);
            expect(across.length()).toBeCloseTo(1, 6);
            expect(across.y).toBeCloseTo(0, 6);
            expect(across.dot(ends[1].clone().sub(ends[0]))).toBeCloseTo(0, 5);
            // So its two end faces are upright planes: the next section, however it is pitched,
            // meets it corner for corner from the footing to the cope.
            const top = new THREE.Vector3(half, 1.15, 0).applyMatrix4(matrix);
            expect(Math.hypot(top.x - ends[1].x, top.z - ends[1].z), `section ${index}`).toBeLessThan(1e-6);
            expect(top.y - ends[1].y).toBeCloseTo(1.15, 6);
        });
        // Section follows section along each run.
        for (const entry of VERDANT_HILLS_WALL) {
            const own = matrices(wall).filter((_matrix, index) => sections[index].run === entry.name);
            for (let index = 1; index < own.length; index++) {
                const before = new THREE.Vector3(half, 0, 0).applyMatrix4(own[index - 1]);
                const after = new THREE.Vector3(-half, 0, 0).applyMatrix4(own[index]);
                expect(before.distanceTo(after), `${entry.name} ${index}`).toBeLessThan(1e-3);
            }
        }
    });

    it('finishes every end of every run with a pier that swallows the cut face', () => {
        const { homestead, assets } = built.High;
        const wall = prop(homestead, 'wall');
        const piers = prop(homestead, 'wall_head');
        expect(piers.count).toBe(6);
        expect(piers.count).toBe(layoutVerdantHillsWallHeads().length);
        const stones = assets.props.meshes.wall.attributes.position;
        const skin = new THREE.Box3().setFromBufferAttribute(assets.props.meshes.wall_head.attributes.position);
        const { overlap } = verdantHillsPropRecord('wall_head').anchors;
        const sections = matrices(wall);
        const half = VERDANT_HILLS_WALL_SECTION / 2;
        const point = new THREE.Vector3();
        matrices(piers).forEach((pier, which) => {
            const foot = new THREE.Vector3().setFromMatrixPosition(pier);
            // The end of a section this pier stands on.
            let joined = null;
            sections.forEach((matrix) => {
                for (const sign of [-1, 1]) {
                    const away = new THREE.Vector3(sign * half, 0, 0).applyMatrix4(matrix).distanceTo(foot);
                    if (!joined || away < joined.away) joined = { away, matrix, sign };
                }
            });
            expect(joined.away, `pier ${which}`).toBeLessThan(0.01);
            // Plumb, on the ground, bedded like the wall.
            expect(new THREE.Vector3(0, 1, 0).transformDirection(pier).y).toBeCloseTo(1, 9);
            expect(verdantHillsGroundHeight(foot.x, foot.z) - foot.y).toBeGreaterThan(0);
            expect(verdantHillsGroundHeight(foot.x, foot.z) - foot.y).toBeLessThan(0.06);
            // The section's cut face (the stones sawn through on its end plane), seen from
            // inside the pier: every corner of it lies in front of the pier's back, behind its
            // far cheek, between its two faces and under its copes. No cut shows from any side,
            // however steeply the run comes down to its end.
            const inward = pier.clone().invert();
            let cut = 0;
            for (let index = 0; index < stones.count; index++) {
                point.fromBufferAttribute(stones, index);
                if (point.x * joined.sign > half - 0.04) {
                    point.applyMatrix4(joined.matrix).applyMatrix4(inward);
                    cut += 1;
                    expect(point.x, `pier ${which}`).toBeGreaterThan(-overlap);
                    expect(point.x, `pier ${which}`).toBeLessThan(skin.max.x - 0.3);
                    expect(point.y, `pier ${which}`).toBeLessThan(skin.max.y);
                    expect(Math.abs(point.z), `pier ${which}`).toBeLessThan(Math.max(-skin.min.z, skin.max.z));
                }
            }
            expect(cut, `pier ${which}`).toBeGreaterThan(20);
        });
    });

    it('hangs the gate across the path, between the spur wall and the cross wall\'s pier', () => {
        const { homestead } = built.High;
        const mesh = prop(homestead, 'gate');
        const record = verdantHillsPropRecord('gate');
        expect(mesh.position.x).toBe(gate.x);
        expect(mesh.position.z).toBe(gate.z);
        expect(verdantHillsGroundHeight(gate.x, gate.z) - mesh.position.y).toBeCloseTo(VERDANT_HILLS_GATE.bed, 9);
        expect(mesh.rotation.y).toBeCloseTo(VERDANT_HILLS_GATE.yaw, 9);
        const left = homestead.anchor('gate', 'postLeft');
        const right = homestead.anchor('gate', 'postRight');
        expect(left.distanceTo(placed(VERDANT_HILLS_GATE, record.anchors.postLeft))).toBeLessThan(1e-6);
        // Both posts stand on the gate's level terrace, their feet in the ground.
        for (const post of [left, right]) {
            const foot = verdantHillsGroundHeight(post.x, post.z);
            expect(post.y - foot).toBeGreaterThan(1.4);
            expect(post.y - foot).toBeLessThan(record.anchors.postLeft[1]);
        }
        // The spur wall's face meets the right-hand post; the pier meets the left-hand one.
        const half = record.anchors.postSize / 2;
        expect(verdantHillsWallDistance(right.x, right.z)).toBeLessThan(0.3 + half + 0.02);
        const reach = verdantHillsPropRecord('wall_head').anchors.end[0];
        const tips = matrices(prop(homestead, 'wall_head'))
            .map((matrix) => new THREE.Vector3(reach, 0, 0).applyMatrix4(matrix));
        const nearest = Math.min(...tips.map((tip) => Math.hypot(tip.x - left.x, tip.z - left.z)));
        expect(nearest).toBeCloseTo(half, 2);
        // The gateway itself is clear.
        expect(verdantHillsWallDistance(gate.x, gate.z)).toBeGreaterThan(record.anchors.opening / 2 + half);
    });

    it('stands a post at every kite station, its top where the kite\'s line is made fast', () => {
        const { homestead, light } = built.High;
        const posts = prop(homestead, 'post');
        const { top } = verdantHillsPropRecord('post').anchors;
        const kites = new VerdantHillsKites({ light });
        expect(posts.count).toBe(VERDANT_HILLS_POSTS.length);
        expect(posts.count).toBe(kites.posts.length);
        matrices(posts).forEach((matrix, slot) => {
            const tip = new THREE.Vector3(...top).applyMatrix4(matrix);
            const station = VERDANT_HILLS_POSTS[slot];
            expect(tip.x).toBeCloseTo(station.x, 4);
            expect(tip.z).toBeCloseTo(station.z, 4);
            expect(tip.y - verdantHillsGroundHeight(station.x, station.z)).toBeCloseTo(VERDANT_HILLS_POST_HEIGHT, 4);
            // Exactly where the kites module ties its line.
            expect(tip.distanceTo(kites.posts[slot])).toBeLessThan(1e-3);
            // Plumb, and rooted: the model goes on down into the ground.
            expect(new THREE.Vector3(0, 1, 0).transformDirection(matrix).y).toBeCloseTo(1, 6);
            const foot = new THREE.Vector3().setFromMatrixPosition(matrix);
            expect(foot.y).toBeCloseTo(verdantHillsGroundHeight(station.x, station.z), 4);
        });
        kites.dispose();
    });

    it('beds the bench by the oak and the outcrops in the turf', () => {
        const { homestead } = built.High;
        const seat = prop(homestead, 'bench');
        expect(seat.position.x).toBe(bench.x);
        expect(seat.position.z).toBe(bench.z);
        expect(verdantHillsGroundHeight(bench.x, bench.z) - seat.position.y).toBeCloseTo(VERDANT_HILLS_BENCH.bed, 9);
        // Whoever sits on it looks out over the valley, a little to the right, under the bough.
        const front = new THREE.Vector3(0, 0, 1).applyQuaternion(seat.quaternion);
        expect(front.z).toBeLessThan(-0.9);
        expect(front.x).toBeGreaterThan(0.1);
        // Its four feet stand on the bench's own level patch: none hangs in the air.
        const record = verdantHillsPropRecord('bench');
        for (const x of [record.boundsMin[0], record.boundsMax[0]]) {
            for (const z of [record.boundsMin[2], record.boundsMax[2]]) {
                const foot = placed(VERDANT_HILLS_BENCH, [x, record.boundsMin[1], z]);
                expect(foot.y).toBeLessThan(verdantHillsGroundHeight(foot.x, foot.z) + 0.01);
            }
        }
        let stones = 0;
        for (const name of ['boulder_a', 'boulder_b', 'boulder_c']) {
            const wanted = VERDANT_HILLS_BOULDERS.filter((stone) => stone.asset === name);
            const mesh = prop(homestead, name);
            expect(mesh.count).toBe(wanted.length);
            instances(mesh).forEach(({ position, scale }, index) => {
                const stone = wanted[index];
                expect(position.x).toBeCloseTo(stone.x, 4);
                expect(position.z).toBeCloseTo(stone.z, 4);
                expect(verdantHillsGroundHeight(stone.x, stone.z) - position.y).toBeCloseTo(stone.bed, 4);
                expect(scale.x).toBeCloseTo(stone.scale, 4);
                // Bedded, yet standing clear of the grass: its top a hand or more above the turf.
                const crest = verdantHillsPropRecord(name).anchors.top[1] * stone.scale - stone.bed;
                expect(crest).toBeGreaterThan(0.25);
            });
            stones += mesh.count;
        }
        expect(stones).toBe(VERDANT_HILLS_BOULDERS.length);
    });

    it('grazes the flock in two draws on the far pastures, fewer on a cheaper tier', () => {
        for (const quality of ['High', 'Minimal']) {
            const { homestead, tier } = built[quality];
            const flock = layoutVerdantHillsSheep(null, tier.sheep);
            const standing = prop(homestead, 'sheep_a');
            const grazing = prop(homestead, 'sheep_b');
            expect(homestead.stats.sheep, quality).toBe(tier.sheep);
            expect(standing.count + grazing.count, quality).toBe(tier.sheep);
            expect(standing.count).toBe(flock.filter((sheep) => !sheep.grazing).length);
            expect(grazing.count).toBe(flock.filter((sheep) => sheep.grazing).length);
            [[standing, false], [grazing, true]].forEach(([mesh, heads]) => {
                const wanted = flock.filter((sheep) => sheep.grazing === heads);
                instances(mesh).forEach(({ position, rotation, scale }, index) => {
                    const sheep = wanted[index];
                    expect(position.x).toBeCloseTo(sheep.x, 3);
                    expect(position.z).toBeCloseTo(sheep.z, 3);
                    // Hooves on the grass.
                    const sunk = verdantHillsGroundHeight(sheep.x, sheep.z) - position.y;
                    expect(sunk).toBeGreaterThan(0);
                    expect(sunk).toBeLessThan(0.05);
                    expect(scale.x).toBeCloseTo(sheep.scale, 3);
                    // It faces its own +Z turned by its heading.
                    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
                    expect(nose.x).toBeCloseTo(Math.sin(sheep.yaw), 3);
                    expect(nose.z).toBeCloseTo(Math.cos(sheep.yaw), 3);
                });
            });
        }
        expect(built.High.homestead.stats.sheep).toBeGreaterThan(built.Minimal.homestead.stats.sheep);
        TIERS.forEach((name, index) => {
            const dearer = VERDANT_HILLS_TIERS[TIERS[Math.max(0, index - 1)]];
            expect(VERDANT_HILLS_TIERS[name].sheep).toBeLessThanOrEqual(dearer.sheep);
        });
    });

    it('hangs a rope swing from the old oak\'s long bough, clear of the bench, the outcrops and the grass', () => {
        const { homestead, assets } = built.High;
        const swing = prop(homestead, 'swing');
        const hero = VERDANT_HILLS_FEATURE_TREES[0];
        const anchor = new THREE.Vector3(...assets.trees['oak-hero'].anchors.swing).applyAxisAngle(UP, hero.yaw)
            .add(new THREE.Vector3(hero.x, verdantHillsGroundHeight(hero.x, hero.z) - 0.05, hero.z));
        const { position, normal, color } = swing.geometry.attributes;
        const box = new THREE.Box3().setFromBufferAttribute(position);
        // Under the anchor: the ropes run up into the bough, the plank hangs at sitting height.
        expect((box.min.x + box.max.x) / 2).toBeCloseTo(anchor.x, 1);
        expect((box.min.z + box.max.z) / 2).toBeCloseTo(anchor.z, 1);
        expect(box.max.y).toBeGreaterThan(anchor.y);
        expect(box.max.y).toBeLessThan(anchor.y + 0.45);
        const turf = verdantHillsGroundHeight(anchor.x, anchor.z);
        expect(box.min.y - turf).toBeGreaterThan(0.4);
        expect(box.min.y - turf).toBeLessThan(0.6);
        expect(homestead.places.swing).toMatchObject({ x: anchor.x, z: anchor.z });
        expect(homestead.places.swing.y - turf).toBeCloseTo(0.52, 2);
        // The anchor lands about five metres out along the bough, right of the trunk and toward the lens.
        expect(Math.hypot(anchor.x - oak.x, anchor.z - oak.z)).toBeCloseTo(5, 1);
        expect(anchor.x).toBeGreaterThan(oak.x + 4);
        expect(anchor.z).toBeGreaterThan(oak.z + 1);
        // It swings across the bough: a metre either way never reaches the bench or a stone.
        const along = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, hero.yaw);
        const across = new THREE.Vector3(-along.z, 0, along.x);
        for (let sweep = -1; sweep <= 1; sweep += 0.25) {
            const x = anchor.x + across.x * sweep;
            const z = anchor.z + across.z * sweep;
            expect(Math.hypot(x - bench.x, z - bench.z), `swept ${sweep}`).toBeGreaterThan(1.9);
            VERDANT_HILLS_BOULDERS.forEach((stone) => expect(Math.hypot(x - stone.x, z - stone.z)).toBeGreaterThan(2));
            expect(Math.hypot(x - oak.x, z - oak.z)).toBeGreaterThan(3.5);
        }
        // Sound geometry: finite, unit normals, every face wound outward (the paint is double
        // sided, and a face wound inward would be lit from behind), all of it weathered timber.
        const index = swing.geometry.index.array;
        expect(index.length % 3).toBe(0);
        expect(index.length / 3).toBe(36);
        const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        const facing = new THREE.Vector3();
        for (let triangle = 0; triangle < index.length; triangle += 3) {
            corner.forEach((vertex, which) => vertex.fromBufferAttribute(position, index[triangle + which]));
            const winding = corner[1].clone().sub(corner[0]).cross(corner[2].clone().sub(corner[0])).normalize();
            facing.fromBufferAttribute(normal, index[triangle]);
            expect(facing.length()).toBeCloseTo(1, 6);
            expect(winding.dot(facing)).toBeGreaterThan(0.999);
        }
        for (let vertex = 0; vertex < position.count; vertex++) {
            expect(Number.isFinite(position.getX(vertex) + position.getY(vertex) + position.getZ(vertex))).toBe(true);
            expect(color.getY(vertex)).toBe(0);
        }
    });

    it('turns its sails faster the harder it blows, and lets them run down when the day settles', async () => {
        const { homestead } = settle('Minimal', await loadBundle());
        homestead.build();
        const {
            settled, rest, wind, gust,
        } = VERDANT_HILLS_SAIL_SPEED;
        expect([settled, rest, wind, gust]).toEqual([0.08, 0.35, 1.9, 1.2]);
        // At rest: one turn in about eighteen seconds.
        expect(homestead.sailAngle).toBe(0);
        expect(homestead.sailSpeed).toBe(rest);
        run(homestead, 10, {});
        expect(homestead.sailSpeed).toBeCloseTo(rest, 6);
        expect(homestead.sailAngle).toBeCloseTo(rest * 10, 2);
        // The wind dial: the sails are heavy and take a few seconds to answer, then hold the speed.
        const before = homestead.sailAngle;
        run(homestead, 0.5, { wind: 1 });
        expect(homestead.sailSpeed).toBeGreaterThan(rest + 0.5);
        expect(homestead.sailSpeed).toBeLessThan(rest + wind);
        run(homestead, 8, { wind: 1 });
        expect(homestead.sailSpeed).toBeCloseTo(rest + wind, 2);
        expect(homestead.sailAngle - before).toBeGreaterThan(14);
        run(homestead, 14, { wind: 0.5 });
        expect(homestead.sailSpeed).toBeCloseTo(rest + wind * 0.5, 1);
        // A gust on top of a full wind.
        run(homestead, 8, { wind: 1, gust: 1 });
        expect(homestead.sailSpeed).toBeCloseTo(rest + wind + gust, 2);
        // What a frame may ask for is bounded, and nonsense reads as no wind at all.
        run(homestead, 8, { wind: 40, gust: 9 });
        expect(homestead.sailSpeed).toBeLessThanOrEqual(rest + wind + gust + 1e-9);
        run(homestead, 30, { wind: Number.NaN, gust: -3 });
        expect(homestead.sailSpeed).toBeCloseTo(rest, 2);
        // A settled day: they nearly stop, but never quite.
        run(homestead, 1, { wind: 1, gust: 1 });
        run(homestead, 20, { wind: 1, gust: 1, settled: true });
        expect(homestead.sailSpeed).toBeLessThan(0.1);
        expect(homestead.sailSpeed).toBeGreaterThanOrEqual(settled);
        const still = homestead.sailAngle;
        run(homestead, 10, { settled: true });
        expect(homestead.sailAngle - still).toBeGreaterThan(0.7);
        expect(homestead.sailAngle - still).toBeLessThan(1);
    }, SLOW);

    it('turns them about the windshaft, leading edge first, and ignores time that is not time', async () => {
        const { homestead } = settle('Minimal', await loadBundle());
        homestead.build();
        const { sails } = homestead;
        const { radius } = verdantHillsPropRecord('windmill_sails').anchors;
        const hub = sails.position.clone();
        const shaft = new THREE.Vector3(0, 0, 1).applyQuaternion(sails.quaternion);
        const tipAt = () => new THREE.Vector3(radius, 0, 0).applyMatrix4(sails.matrix);
        const start = tipAt();
        run(homestead, 1, { wind: 1 });
        const later = tipAt();
        // The hub stays put, the shaft keeps its line, a tip keeps its distance and moves.
        expect(sails.position.distanceTo(hub)).toBe(0);
        expect(new THREE.Vector3(0, 0, 1).applyQuaternion(sails.quaternion).dot(shaft)).toBeCloseTo(1, 9);
        expect(later.distanceTo(hub)).toBeCloseTo(radius, 6);
        expect(later.distanceTo(start)).toBeGreaterThan(1);
        // Each sail's leading board is on its -Y side: seen from in front, the sails turn clockwise.
        const turned = start.clone().sub(hub).cross(later.clone().sub(hub)).normalize();
        expect(turned.dot(shaft)).toBeLessThan(-0.99);
        // The angle is the turn about the shaft.
        const swept = start.clone().sub(hub).angleTo(later.clone().sub(hub));
        expect(swept).toBeCloseTo(homestead.sailAngle, 4);
        // Bad time changes nothing; a long stall is taken as a quarter of a second, not a lurch.
        const angle = homestead.sailAngle;
        const speed = homestead.sailSpeed;
        for (const dt of [Number.NaN, undefined, -1, 0, Infinity]) {
            expect(() => homestead.update(Number.NaN, dt, { wind: 1 })).not.toThrow();
        }
        expect(homestead.sailAngle).toBe(angle);
        expect(homestead.sailSpeed).toBe(speed);
        homestead.update(5, 30, { wind: 1 });
        const fastest = VERDANT_HILLS_SAIL_SPEED.rest + VERDANT_HILLS_SAIL_SPEED.wind + VERDANT_HILLS_SAIL_SPEED.gust;
        expect(homestead.sailAngle - angle).toBeLessThan(fastest * 0.25);
        expect(homestead.sailAngle - angle).toBeGreaterThan(0);
        // A frame that says nothing is a frame with no wind.
        expect(() => homestead.update(6, STEP)).not.toThrow();
    }, SLOW);
});

describe('Verdant Hills homestead: ownership', () => {
    it('skips the swing cleanly when the oak records no place for it', async () => {
        const assets = await loadBundle();
        for (const oakAsset of [null, undefined, { anchors: {} }, { anchors: { swing: [1, 2] } }, {}]) {
            const { homestead } = settle('Minimal', assets, { oak: oakAsset });
            expect(homestead.build()).toBe(homestead);
            expect(prop(homestead, 'swing')).toBeUndefined();
            expect(homestead.stats.swing).toBe(false);
            expect(homestead.places.swing).toBeUndefined();
            // Everything else is there, and turns.
            expect(prop(homestead, 'windmill_sails')).toBeDefined();
            expect(() => run(homestead, 0.5, { wind: 1 })).not.toThrow();
        }
    }, SLOW);

    it('builds nothing without the props, and whatever the pack does hold', async () => {
        for (const props of [null, undefined, {}]) {
            const { homestead } = settle('Minimal', null, { props, oak: null });
            expect(homestead.build()).toBe(homestead);
            expect(drawables(homestead.group)).toEqual([]);
            expect(homestead.sails).toBeNull();
            expect(() => run(homestead, 0.5, { wind: 1 })).not.toThrow();
            expect(homestead.sailAngle).toBeGreaterThan(0);
        }
        const assets = await loadBundle();
        const removed = ['windmill_sails', 'wall_head', 'sheep_b', 'boulder_b'].map((name) => {
            const geometry = assets.props.meshes[name];
            delete assets.props.meshes[name];
            return geometry;
        });
        const { homestead } = settle('Minimal', assets);
        homestead.build();
        const names = drawables(homestead.group).map((mesh) => mesh.name.slice('VerdantHills '.length)).sort();
        expect(names)
            .toEqual(['bench', 'boulder_a', 'boulder_c', 'gate', 'post', 'sheep_a', 'swing', 'wall', 'windmill']);
        expect(homestead.sails).toBeNull();
        expect(homestead.stats.wallHeads).toBe(0);
        expect(homestead.stats.wallSections).toBe(layoutVerdantHillsWall().length);
        expect(() => run(homestead, 0.5, { wind: 1, settled: true })).not.toThrow();
        removed.forEach((geometry) => geometry.dispose());
    }, SLOW);

    it('disposes what it made, once, and leaves the pack to its owner', async () => {
        const assets = await loadBundle();
        const { homestead } = settle('High', assets);
        homestead.build();
        const meshes = drawables(homestead.group);
        const swing = prop(homestead, 'swing');
        const materials = [...new Set(meshes.map((mesh) => mesh.material))];
        expect(materials).toHaveLength(2);
        const instanced = meshes.filter((mesh) => mesh.isInstancedMesh);
        expect(instanced.length).toBe(8);
        const mine = [...materials, swing.geometry, ...instanced].map((resource) => vi.spyOn(resource, 'dispose'));
        const shared = Object.values(assets.props.meshes).map((geometry) => vi.spyOn(geometry, 'dispose'));
        const parent = new THREE.Group();
        parent.add(homestead.group);
        homestead.dispose();
        mine.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        shared.forEach((disposal) => expect(disposal).not.toHaveBeenCalled());
        expect(parent.children).toHaveLength(0);
        expect(homestead.group.children).toHaveLength(0);
        expect(homestead.sails).toBeNull();
        // Inert afterwards, not explosive.
        expect(() => homestead.dispose()).not.toThrow();
        expect(() => homestead.update(1, STEP, { wind: 1 })).not.toThrow();
        mine.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    }, SLOW);

    it('reads a prop\'s anchors from the pack it was handed, or from the manifest', async () => {
        const assets = await loadBundle();
        const { homestead } = settle('Minimal', assets);
        homestead.build();
        expect(homestead.record('gate')).toBe(assets.props.records.gate);
        expect(homestead.record('gate').anchors.postLeft).toEqual(verdantHillsPropRecord('gate').anchors.postLeft);
        // A pack parsed without its extras still finds them.
        delete assets.props.records;
        expect(homestead.record('gate')).toEqual(verdantHillsPropRecord('gate'));
        expect(homestead.record('lighthouse')).toBeNull();
    }, SLOW);
});
