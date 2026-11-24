import * as THREE from 'three/webgpu';
import { ODYSSEY_CLOUD_VOLUMES } from './odyssey-cloud-volumes.js';

/**
 * THE CLOUDS' VOLUMES (2026-11-24): sculpted and lit by scripts/blender/odyssey/odyssey_clouds.py, one gzip
 * file of predicted planes (clouds/pack.py). Four 3D textures come out of it:
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

/** What lies between two yields of the decoder, in slices of a grid (a few milliseconds' work). */
const SLICES = 12;

/**
 * One plane out of the file (clouds/pack.py): the residuals summed back along x, y and z, and its levels spread
 * over a byte. Yields now and then, so the caller can let a frame through.
 * @param {Uint8Array} bytes
 * @param {number} from where the plane begins
 * @param {number[]} size [x, y, z]
 * @param {number} levels
 * @param {Uint8Array} out where it goes
 * @param {number} channel its place in `out`'s texels
 * @param {number} channels how many a texel has
 */
export function* unpackPlane(bytes, from, [nx, ny, nz], levels, out, channel, channels) {
    const slice = nx * ny;
    const spread = Uint8Array.from({ length: levels }, (_, v) => Math.round((v * 255) / (levels - 1)));
    let before = new Uint8Array(slice);
    let here = new Uint8Array(slice);
    for (let z = 0; z < nz; z += 1) {
        const at = from + (z * slice);
        for (let y = 0; y < ny; y += 1) {
            const row = y * nx;
            let run = 0;
            for (let x = 0; x < nx; x += 1) {
                run = (run + bytes[at + row + x]) & 255;
                here[row + x] = y > 0 ? (run + here[(row - nx) + x]) & 255 : run;
            }
        }
        for (let k = 0; k < slice; k += 1) {
            here[k] = (here[k] + before[k]) & 255;
            out[(((z * slice) + k) * channels) + channel] = spread[here[k]];
        }
        const swap = before;
        before = here;
        here = swap;
        if (z % SLICES === SLICES - 1) yield;
    }
}

/**
 * Every grid out of the file's bytes, a step at a time.
 * @param {Uint8Array} bytes
 * @returns {Generator<void, Record<string, Uint8Array>>}
 */
export function* unpackVolumes(bytes) {
    if (bytes.length !== CLOUD_VOLUMES.bytes) throw new Error(`clouds.dat is ${bytes.length} bytes, its index says ${CLOUD_VOLUMES.bytes}`);
    const grids = cloudGrids();
    const out = {};
    let from = 0;
    for (let i = 0; i < CLOUD_VOLUMES.planes.length; i += 1) {
        const [name, kept, levels] = CLOUD_VOLUMES.planes[i];
        const [x, y, z, channels] = grids[name];
        out[name] = new Uint8Array(x * y * z * channels);
        for (let c = 0; c < kept; c += 1) {
            yield* unpackPlane(bytes, from, [x, y, z], levels, out[name], c, channels);
            from += x * y * z;
        }
    }
    return out;
}

async function readVolumes(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    let bytes = new Uint8Array(await res.arrayBuffer());
    // A server may have undone the gzip on the way (Content-Encoding): the magic tells.
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const work = unpackVolumes(bytes);
    for (;;) {
        const step = work.next();
        if (step.done) return step.value;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
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
    const state = {
        ready: false, disposed: false, error: null, sdf: null,
    };
    if (load && typeof fetch === 'function' && typeof DecompressionStream === 'function' && typeof document !== 'undefined') {
        readVolumes(URL_DATA).then((volumes) => {
            if (state.disposed) return;
            Object.entries(volumes).forEach(([name, data]) => {
                const tex = out[name];
                const [x, y, z] = tex.userData.full;
                tex.dispose();
                tex.image = {
                    data, width: x, height: y, depth: z,
                };
                tex.needsUpdate = true;
            });
            // (The shadows read the shapes themselves: odyssey-cloud-shadows.js.)
            state.sdf = volumes.sdf;
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
            Object.values(out).forEach((tex) => tex.dispose());
        },
    };
}
