/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Floating Islands (Phase 7.5)
 *
 * A few small detached land chunks hovering in the cloud sea — the signature
 * Sky-COTL "floating islands": a flat green grass top over a tapered rock base,
 * drifting with a gentle bob. Off-center, at varied depths/heights so they read
 * as an archipelago suspended in the clouds.
 *
 * Procedural low-poly (deformed icosphere), one shared geometry + material, shaded
 * with the painterly lib reading the shared `u` block (green top / rock sides,
 * colored shadow, warm rim, aerial perspective). Static meshes bobbed on the CPU.
 *
 * The rock base tapers to a ROUNDED chunky tip (never collapses to a degenerate
 * point) so the underside reads as ONE solid mass, not a fan of disconnected
 * shards, and low-frequency noise gives it stone character. An optional CC0 rock
 * luminance map adds painterly tooth (see detail-texture.js).
 *
 * See docs/SKY_CHILDREN_V2_AAA_PLAN.md §7.5.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn, clamp, exp, float, length, mix, normalize, normalWorld, positionLocal, positionWorld, smoothstep, vec3,
} from 'three/tsl';
import { wrappedDiffuse, coloredShadowBlend, fresnelRim } from '../sky-children-lighting.js';
import { detailLumaTriplanar } from './detail-texture.js';

const COL_GRASS = vec3(0.34, 0.60, 0.22);
const COL_GRASS_HI = vec3(0.54, 0.74, 0.30);
// Warmer, richer stone (was washing out to pale glass at distance).
const COL_ROCK = vec3(0.46, 0.40, 0.35);
const COL_ROCK_DK = vec3(0.28, 0.24, 0.23);

// Island placements (world pos, radius). Over the OPEN cloud sea (the left side
// + near foreground — NOT behind the green hill, which would occlude them), at
// varied heights so they hover clearly in front of the sky/cloud.
const PLACEMENTS = [
    {
        x: -380, y: 86, z: -360, r: 44, bob: 3.0,
    },
    {
        x: -210, y: 60, z: -200, r: 32, bob: 2.2,
    },
    {
        x: -520, y: 110, z: -520, r: 38, bob: 2.6,
    },
    {
        x: 110, y: 120, z: -600, r: 40, bob: 2.8,
    },
    {
        x: 480, y: 98, z: -400, r: 44, bob: 3.0, // right side, upper (per request)
    },
];

function hash1(i) {
    const s = Math.sin(i * 127.1) * 43758.5453;
    return s - Math.floor(s);
}

// Smooth 3D value noise (coherent lumps, no shattering) for stone character.
function vnoise3(x, y, z) {
    const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return s - Math.floor(s);
}

function buildIslandGeometry() {
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i);
        const ny = v.y; // -1 (bottom) .. 1 (top)

        if (ny >= 0) {
            // Flat, slightly-wider grass plateau.
            v.y *= 0.36;
            v.x *= 1.28;
            v.z *= 1.28;
        } else {
            // SOLID tapered rock base: a smooth quadratic narrowing that bottoms
            // out at a chunky rounded tip (min ~0.3 radius) — the verts NEVER
            // collapse to the axis, so no degenerate shard-fan underside.
            const t = -ny; // 0 at equator → 1 at bottom
            const taper = 1.0 - 0.7 * t * t; // 1.0 → ~0.30
            v.x *= taper * 1.05;
            v.z *= taper * 1.05;
            v.y *= 1.65; // elongate the spike downward
        }

        // Coherent low-frequency lumps along the radial direction (rocky, not noisy).
        const n = vnoise3(v.x * 1.6 + 3.1, v.y * 1.6 + 1.7, v.z * 1.6 + 5.2) - 0.5;
        const len = Math.max(0.0001, Math.hypot(v.x, v.y, v.z));
        const amp = ny < 0 ? 0.14 : 0.06; // stronger on rock, gentle on the grass top
        v.x += (v.x / len) * n * amp;
        v.y += (v.y / len) * n * amp;
        v.z += (v.z / len) * n * amp;

        pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
}

export function createFloatingIslands(u, opts = {}) {
    const group = new THREE.Group();
    group.frustumCulled = false;
    const geometry = buildIslandGeometry();
    const detailTex = opts.detailTex ?? null;

    const material = new MeshBasicNodeMaterial({ fog: false });
    const shade = () => {
        const N = normalize(normalWorld).toVar();
        const worldP = positionWorld.toVar();
        const sunDir = normalize(u.uSunDir).toVar();
        const viewDir = normalize(u.uCameraPos.sub(worldP)).toVar();
        const slope = clamp(float(1.0).sub(N.y), float(0.0), float(1.0));

        // Green top (high + flat) → rock (low / steep).
        const topMask = smoothstep(float(-0.02), float(0.18), positionLocal.y)
            .mul(float(1.0).sub(smoothstep(float(0.42), float(0.86), slope)));
        const grass = mix(COL_GRASS, COL_GRASS_HI, smoothstep(float(0.0), float(0.45), positionLocal.y));
        const rock = mix(COL_ROCK_DK, COL_ROCK, smoothstep(float(0.25), float(0.85), N.y)).toVar();
        if (detailTex) {
            // CC0 rock luminance tooth — sells the stone as a solid carved mass.
            rock.mulAssign(detailLumaTriplanar(detailTex, worldP, N, 0.05, 0.82, 1.16));
        }
        const albedo = mix(rock, grass, topMask).toVar();

        const diffuse = wrappedDiffuse(N, sunDir, 0.6).toVar();
        const litColor = albedo.mul(u.uSunColor);
        const shadowColor = albedo.mul(u.uShadowTint).mul(0.8);
        const lit = coloredShadowBlend(diffuse, litColor, shadowColor, 0.25);
        const ambient = albedo.mul(u.uSkyHorizon).mul(float(0.12).mul(float(0.5).add(N.y.mul(0.5))));
        // Warm rim, but mostly on the grassy top edge — keep it off the rock so the
        // stone doesn't read as glassy/crystalline at the facets.
        const rimStrength = float(0.2).add(topMask.mul(0.4));
        const rim = u.uRimColor.mul(fresnelRim(N, viewDir, 3.0, rimStrength)).mul(diffuse).toVar();
        const base = lit.add(ambient).add(rim);

        // Lighter aerial perspective so the islands stay solid + crisp (hero props),
        // instead of dissolving into the pale horizon.
        const dist = length(u.uCameraPos.sub(worldP));
        const fog = clamp(float(1.0).sub(exp(dist.mul(-0.0011))), float(0.0), float(1.0)).toVar();
        const color = mix(base, u.uFogColor, fog.mul(0.45));
        const emissive = rim.mul(float(1.0).sub(fog.mul(0.7)));
        return { color, emissive };
    };
    material.colorNode = Fn(() => shade().color)();
    material.emissiveNode = Fn(() => shade().emissive)();
    material.userData.emitsBloom = true;

    const islands = [];
    const max = Math.min(PLACEMENTS.length, opts.count ?? PLACEMENTS.length);
    for (let i = 0; i < max; i += 1) {
        const p = PLACEMENTS[i];
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(p.x, p.y, p.z);
        mesh.scale.set(p.r, p.r, p.r);
        mesh.rotation.y = hash1(i * 5.3) * Math.PI * 2;
        mesh.frustumCulled = false;
        mesh.renderOrder = 1; // with the opaque world, before transparent clouds
        group.add(mesh);
        islands.push({
            mesh, baseY: p.y, bobAmp: p.bob, bobPhase: hash1(i * 9.1) * 6.2831,
        });
    }

    return {
        group,
        update(time) {
            for (let i = 0; i < islands.length; i += 1) {
                const isl = islands[i];
                isl.mesh.position.y = isl.baseY + Math.sin(time * 0.32 + isl.bobPhase) * isl.bobAmp;
            }
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
