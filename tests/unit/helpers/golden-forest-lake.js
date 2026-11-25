/**
 * Golden Forest's lake for the unit tests, with no GPU and no network: the authored pack read
 * from disk and parsed as the theme parses it (the sprite sheet is a stand-in data texture), a
 * world built on it in a scene of its own, and a few readers the contract tests share.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    GOLDEN_FOREST_TREE_URLS, goldenForestImpostorLayout, parseGoldenForestCrane, parseGoldenForestMeshes,
    parseGoldenForestTree,
} from '../../../src/themes/golden-forest/golden-forest-assets.js';
import { goldenForestEye, goldenForestViewFor } from '../../../src/themes/golden-forest/golden-forest-composition.js';
import { GOLDEN_FOREST_TIERS } from '../../../src/themes/golden-forest/golden-forest-quality.js';
import { GoldenForestWorld } from '../../../src/themes/golden-forest/golden-forest-world.js';

export const GOLDEN_FOREST_ASSETS = new URL('../../../src/themes/golden-forest/assets/', import.meta.url);
export const LANDSCAPE = 16 / 9;
export const STEP = 1 / 60;

const files = new Map();

/** A small seeded generator (the same one the other Golden Forest tests draw from). */
export function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

async function parseGlb(file) {
    if (!files.has(file)) {
        const bytes = readFileSync(new URL(file, GOLDEN_FOREST_ASSETS));
        files.set(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return new GLTFLoader().parseAsync(files.get(file).slice(0), '');
}

/** The real asset pack (a fresh bundle: whoever loads it disposes it with disposeGoldenForestAssets). */
export async function loadGoldenForestBundle() {
    const trees = Object.keys(GOLDEN_FOREST_TREE_URLS);
    const [foliage, props, crane, ...gltfs] = await Promise.all([parseGlb('golden-forest-foliage.glb'),
        parseGlb('golden-forest-props.glb'), parseGlb('golden-forest-crane.glb'),
        ...trees.map((name) => parseGlb(`${name}.glb`))]);
    const assets = {
        foliage: parseGoldenForestMeshes(foliage, 'Foliage'),
        props: parseGoldenForestMeshes(props, 'Props'),
        trees: {},
        impostors: {
            ...goldenForestImpostorLayout(),
            texture: new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4),
        },
        crane: parseGoldenForestCrane(crane),
    };
    trees.forEach((name, index) => { assets.trees[name] = parseGoldenForestTree(gltfs[index], name); });
    return assets;
}

/** A built world at a tier on a bundle, as the theme makes one. */
export function buildGoldenForestWorld(quality, assets, { seed = 271, aspect = LANDSCAPE, samples } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.3, 3400);
    const world = new GoldenForestWorld({
        scene, camera, quality, rng: seededRandom(seed), assets, samples,
    });
    world.build();
    return {
        scene, camera, world, assets, tier: GOLDEN_FOREST_TIERS[quality],
    };
}

/** The camera the world frames for an aspect ratio, at rest (no world needed). */
export function goldenForestCamera(aspect = LANDSCAPE) {
    const view = goldenForestViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.3, 3400);
    camera.position.set(...goldenForestEye(view));
    camera.lookAt(...view.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
}

/** Every number a uniform holds (a float, a vector, a colour), flat. */
export function uniformNumbers(uniform) {
    const { value } = uniform;
    if (typeof value === 'number') return [value];
    if (value?.isColor) return [value.r, value.g, value.b];
    if (typeof value?.toArray === 'function') return value.toArray();
    return [];
}

/** The names of an object's uniforms (`u...` fields holding a uniform node) that hold a non-finite number. */
export function nonFiniteUniforms(owner, label = '') {
    const bad = [];
    if (!owner) return bad;
    for (const [key, field] of Object.entries(owner)) {
        if (!/^u[A-Z]/.test(key) || !field?.isNode) continue;
        if (!uniformNumbers(field).every(Number.isFinite)) bad.push(`${label}${key} = ${uniformNumbers(field)}`);
    }
    return bad;
}

/** Whether every float of a typed array is finite. */
export function allFinite(array) {
    for (let index = 0; index < array.length; index += 1) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}
