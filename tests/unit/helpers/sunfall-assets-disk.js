/**
 * Load Sunfall's authored assets from disk for unit tests (no fetch in Node): the three GLBs are
 * parsed with three's GLTFLoader and handed to the theme's own parser.
 */
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseSunfallAssets } from '../../../src/themes/sunfall/sunfall-assets.js';

export const SUNFALL_ASSET_DIR = new URL('../../../src/themes/sunfall/assets/', import.meta.url);

export function readSunfallAsset(name) {
    return readFileSync(new URL(name, SUNFALL_ASSET_DIR));
}

async function parse(name) {
    const bytes = readSunfallAsset(name);
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

export async function loadSunfallAssetsFromDisk() {
    const [shell, ledge, crowns] = await Promise.all([
        parse('sunfall-shell.glb'), parse('sunfall-ledge.glb'), parse('sunfall-crowns.glb'),
    ]);
    return parseSunfallAssets({ shell, ledge, crowns });
}
