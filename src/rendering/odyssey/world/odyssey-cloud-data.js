import * as THREE from 'three/webgpu';
import { ODYSSEY_CLOUD_VOLUMES } from './odyssey-cloud-volumes.js';

/**
 * THE CLOUDS' VOLUMES (2026-11-24): sculpted and lit by scripts/blender/odyssey/odyssey_clouds.py, one gzip
 * file of raw 3D grids. Four 3D textures come out of it:
 *   sdf     every shape's distance field, stacked along y (R8)
 *   sun     the sun's light inside each shape, for four turns of it (RGBA8)
 *   air     the sky's light, the ground's, and how deep in the body a place is (RGBA8)
 *   billow  the tiling noise that carves their skins (RGBA8)
 */

const URL_DATA = new URL('../assets/clouds/clouds.dat', import.meta.url).href;

export const CLOUD_VOLUMES = Object.freeze(ODYSSEY_CLOUD_VOLUMES);
export const CLOUD_SHAPES = Object.freeze(ODYSSEY_CLOUD_VOLUMES.shapes);

const byId = new Map(CLOUD_SHAPES.map((s, i) => [s.id, i]));
/** The shape's place in the atlas, or -1. */
export function cloudShapeIndex(id) {
    return byId.get(id) ?? -1;
}

/** The grid sizes of the four textures: [x, y, z, channels]. */
export function cloudGrids() {
    const { sdf, light, noise } = CLOUD_VOLUMES;
    const n = CLOUD_SHAPES.length;
    return {
        sdf: [sdf[0], sdf[1] * n, sdf[2], 1],
        sun: [light[0], light[1] * n, light[2], 4],
        air: [light[0], light[1] * n, light[2], 4],
        billow: [noise, noise, noise, 4],
    };
}

function volume([x, y, z, c], repeat) {
    // A one-cell placeholder until the file lands: the material is off until then.
    const tex = new THREE.Data3DTexture(new Uint8Array(c), 1, 1, 1);
    tex.format = c === 1 ? THREE.RedFormat : THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    const wrap = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapS = wrap;
    tex.wrapT = wrap;
    tex.wrapR = wrap;
    tex.userData.full = [x, y, z];
    tex.needsUpdate = true;
    return tex;
}

async function readVolumes(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A server may have undone the gzip on the way (Content-Encoding): the magic tells.
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The four textures, filled when the file lands. No browser (the unit tests build the world in node): no fetch.
 * @param {object} [opts]
 * @param {boolean} [opts.load]
 * @param {() => void} [opts.onReady]
 */
export function createCloudTextures({ load = true, onReady = null } = {}) {
    const grids = cloudGrids();
    const out = {
        sdf: volume(grids.sdf, false),
        sun: volume(grids.sun, false),
        air: volume(grids.air, false),
        billow: volume(grids.billow, true),
    };
    const state = { ready: false, disposed: false, error: null };
    if (load && typeof fetch === 'function' && typeof DecompressionStream === 'function' && typeof document !== 'undefined') {
        readVolumes(URL_DATA).then((bytes) => {
            if (state.disposed) return;
            if (bytes.length !== CLOUD_VOLUMES.bytes) throw new Error(`clouds.dat is ${bytes.length} bytes, its index says ${CLOUD_VOLUMES.bytes}`);
            Object.entries(CLOUD_VOLUMES.spans).forEach(([name, [from, size]]) => {
                const tex = out[name];
                const [x, y, z] = tex.userData.full;
                tex.dispose();
                tex.image = {
                    data: bytes.subarray(from, from + size), width: x, height: y, depth: z,
                };
                tex.needsUpdate = true;
            });
            state.ready = true;
            onReady?.();
        }).catch((error) => {
            state.error = error;
            console.warn('[OdysseyClouds] volumes not loaded:', error?.message || error);
        });
    }
    return {
        ...out,
        state,
        dispose() {
            state.disposed = true;
            Object.values(out).forEach((t) => t.dispose());
        },
    };
}
