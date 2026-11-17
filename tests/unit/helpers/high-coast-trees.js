/**
 * High Coast's authored trees read from disk for the unit tests (no network, no image decode):
 * the old pine and its sprays parsed from their GLBs as the theme parses them, and the forest's
 * sprite sheets as two tiny textures under the real layout.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    highCoastSpriteLayout, parseHighCoastFoliage, parseHighCoastPine, prepareHighCoastSprites,
} from '../../../src/themes/high-coast/high-coast-tree-assets.js';

export const HIGH_COAST_ASSETS = new URL('../../../src/themes/high-coast/assets/', import.meta.url);

export async function parseHighCoastGlb(file) {
    const bytes = readFileSync(new URL(file, HIGH_COAST_ASSETS));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

const sheet = (name) => prepareHighCoastSprites(
    new THREE.DataTexture(new Uint8Array(16).fill(128), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType),
    name,
);

/** What HighCoastWorld.prepare hands a world as `trees` (a fresh set: a world disposes its own). */
export async function readHighCoastTrees() {
    return {
        pine: parseHighCoastPine(await parseHighCoastGlb('pine-old.glb')),
        foliage: parseHighCoastFoliage(await parseHighCoastGlb('high-coast-foliage.glb')),
        sprites: { ...highCoastSpriteLayout(), data: sheet('HighCoastTreeSprites'), normal: sheet('HighCoastTreeSpriteNormals') },
    };
}
