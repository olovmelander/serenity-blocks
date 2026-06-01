/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Caldera Basin
 *
 * The molten plain surrounding the volcano. A large plane displaced on the CPU
 * with multi-octave FBM so it has real silhouette + parallax (the old theme's
 * ±20-unit sine made it read as a flat sheet). Shape:
 *   - a flat molten plain in the central vent zone (volcano sits here),
 *   - rolling cooled-crust relief + ridged fissures in the mid field,
 *   - a distant rise into caldera hills that fade into fog at the horizon.
 *
 * Surface look comes from the lava-ground TSL material; this module only owns
 * the geometry and forwards the material's time/intensity uniforms.
 */
import * as THREE from 'three/webgpu';
import { createLavaGroundMaterial } from '../materials/lava-ground-material.js';

const PLAIN_LEVEL = -150; // matches the volcano base / old ground height

function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function hash2(x, z) {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
}

function valueNoise(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz);
    const b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1);
    const d = hash2(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x, z, octaves) {
    let v = 0;
    let amp = 0.5;
    let fx = x;
    let fz = z;
    for (let i = 0; i < octaves; i += 1) {
        v += amp * valueNoise(fx, fz);
        fx *= 2.03;
        fz *= 2.01;
        amp *= 0.5;
    }
    return v;
}

// Ridged noise → sharp basalt fissures.
function ridged(x, z) {
    const n = valueNoise(x, z);
    const r = 1 - Math.abs(2 * n - 1);
    return r * r;
}

export function createCalderaBasin({ size = 30000, segments = 220 } = {}) {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const r = Math.hypot(x, z);

        // Keep the central vent zone flat; relief grows outward.
        const outward = smoothstep(1100, 2800, r);

        const relief = (fbm(x * 0.00035, z * 0.00035, 5) - 0.5) * 620;
        const fissures = ridged(x * 0.0012, z * 0.0012) * 180 * smoothstep(2200, 6000, r);
        const rise = smoothstep(5500, 14000, r) * 1100;
        // Subtle swell on the molten plain so it isn't glassy-flat.
        const plainRipple = (fbm(x * 0.0016, z * 0.0016, 2) - 0.5) * 18;

        const y = PLAIN_LEVEL + plainRipple + (relief + fissures + rise) * outward;
        pos.setY(i, y);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    const { material, uniforms } = createLavaGroundMaterial();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;

    return {
        mesh,
        uniforms,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
