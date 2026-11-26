/**
 * First-visit texture bakes run in a worker alongside renderer initialization. The world
 * wraps the cached RGBA bytes in fresh textures on every visit. Its synchronous build
 * uses the same computations if a worker is absent or a job fails.
 */
import * as THREE from 'three/webgpu';
import { bakeOnce } from '../shared/bake-cache.js';
import { bakeInWorker } from '../shared/bake-worker-client.js';
import {
    bakeCosmicNebulaData as makeNebula, bakeRainbowGiantData as makeGiant, bakeIceRingData as makeRings,
} from './chromadelic-highway-bake-data.js';

const nebulaKey = (size) => `chromadelic:nebula:v1:${size}`;
const giantKey = (width, height) => `chromadelic:hero-giant:v2:${width}x${height}`;

export function warmHighwayBakes({ skyTaps }) {
    const jobs = [{ kind: 'giant', args: [512, 256] }];
    if (skyTaps > 0) jobs.push({ kind: 'nebula', args: [256] });
    return bakeInWorker({
        jobs,
        keyOf: ({ kind, args }) => (kind === 'giant' ? giantKey(...args) : nebulaKey(...args)),
        createWorker: () => new Worker(
            new URL('./chromadelic-highway-bake.worker.js', import.meta.url),
            { type: 'module' },
        ),
    });
}

export function bakeCosmicNebulaData(size = 256) {
    return bakeOnce(nebulaKey(size), () => makeNebula(size));
}

export function bakeRainbowGiantData(width = 512, height = 256) {
    return bakeOnce(giantKey(width, height), () => makeGiant(width, height));
}

export function bakeIceRingData(width = 512) {
    return bakeOnce(`chromadelic:ice-ring:v1:${width}`, () => makeRings(width));
}

export function createCosmicNebulaTexture(size = 256) {
    const baked = bakeCosmicNebulaData(size);
    const tex = new THREE.DataTexture(baked.data, baked.width, baked.height, THREE.RGBAFormat);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}

export function createRainbowGiantTexture(width = 512, height = 256) {
    const baked = bakeRainbowGiantData(width, height);
    const tex = new THREE.DataTexture(baked.data, baked.width, baked.height, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
}

export function createIceRingTexture(width = 512) {
    const baked = bakeIceRingData(width);
    const tex = new THREE.DataTexture(baked.levels[0].data, baked.width, 1, THREE.RGBAFormat);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.mipmaps = baked.levels;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}
