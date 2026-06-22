/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Island Props: bushes (Phase 7.3) + arches (Phase 7.4)
 *
 * Small low-poly shrubs scattered on the grass islands, and a few pale stone
 * arch "gates" (Sky-COTL's iconic portals) on prominent island tops. Both anchor
 * to the EXACT terrain via the shared `heightFieldTSL`, alpha-discard below the
 * cloud, and shade with the painterly lib reading the shared `u` block.
 *
 * One merged geometry per prop type (built ONCE). See §7.3 / §7.4.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn, attribute, clamp, exp, float, length, mix, normalize, normalWorld, positionLocal, positionWorld, smoothstep, varying, vec3,
} from 'three/tsl';
import { heightFieldTSL, ISLAND_REGIONS } from './valley-terrain.js';
import { wrappedDiffuse, coloredShadowBlend, fresnelRim } from '../sky-children-lighting.js';

const COL_BUSH = [0.21, 0.37, 0.19];
const COL_BUSH_HI = [0.40, 0.56, 0.28];

// ── Bushes ──────────────────────────────────────────────────────────────────
export function createIslandBushes(u, opts = {}) {
    const total = Math.max(20, Math.floor(opts.count ?? 280));
    const cloudY = opts.cloudY ?? 10;

    // IcosahedronGeometry is NON-INDEXED (position array = triangle soup).
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const ip = ico.attributes.position.array;
    ico.dispose();

    const positions = [];
    const anchors = [];
    const colors = [];

    const sumR2 = ISLAND_REGIONS.reduce((s, isl) => s + isl.r * isl.r, 0);
    for (let r = 0; r < ISLAND_REGIONS.length; r += 1) {
        const isl = ISLAND_REGIONS[r];
        const n = Math.max(1, Math.round(total * ((isl.r * isl.r) / sumR2)));
        for (let i = 0; i < n; i += 1) {
            const a = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random()) * isl.r * 0.92;
            const x = isl.x + Math.cos(a) * rr;
            const z = isl.z + Math.sin(a) * rr;
            const s = 2.6 + Math.random() * 3.4;
            const t = Math.random();
            const col = [
                COL_BUSH[0] + (COL_BUSH_HI[0] - COL_BUSH[0]) * t * 0.6,
                COL_BUSH[1] + (COL_BUSH_HI[1] - COL_BUSH[1]) * t * 0.6,
                COL_BUSH[2] + (COL_BUSH_HI[2] - COL_BUSH[2]) * t * 0.6,
            ];
            // Copy the icosphere triangle-soup verts directly (non-indexed).
            for (let k = 0; k < ip.length; k += 3) {
                positions.push(ip[k] * s * 1.1, ip[k + 1] * s * 0.72 + s * 0.5, ip[k + 2] * s * 1.1);
                anchors.push(x, z);
                colors.push(col[0], col[1], col[2]);
            }
        }
    }

    return finishProp(u, {
        positions, anchors, colors, indices: null, cloudY, renderOrder: 2, doubleSide: false, rimStrength: 0.4,
    });
}

// ── Arches (procedural stone gates) ───────────────────────────────────────────
export function createIslandArches(u, opts = {}) {
    const cloudY = opts.cloudY ?? 10;
    const positions = [];
    const anchors = [];
    const colors = [];
    const indices = [];
    const STONE = [0.74, 0.71, 0.66];

    // Box helper (8 verts, 12 tris) at local (cx,cy,cz) with half-extents.
    const pushBox = (ax, az, cx, cy, cz, hx, hy, hz) => {
        const base = positions.length / 3;
        const cs = [
            [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
            [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
        ];
        for (let c = 0; c < 8; c += 1) {
            positions.push(cx + cs[c][0] * hx, cy + cs[c][1] * hy, cz + cs[c][2] * hz);
            anchors.push(ax, az);
            const shade = 0.9 + cs[c][1] * 0.06; // subtle top/bottom variance
            colors.push(STONE[0] * shade, STONE[1] * shade, STONE[2] * shade);
        }
        const f = [
            [0, 1, 2, 0, 2, 3], [4, 6, 5, 4, 7, 6], [0, 4, 5, 0, 5, 1],
            [3, 2, 6, 3, 6, 7], [1, 5, 6, 1, 6, 2], [0, 3, 7, 0, 7, 4],
        ];
        for (let q = 0; q < f.length; q += 1) for (let j = 0; j < 6; j += 1) indices.push(base + f[q][j]);
    };

    // A few arches on the larger island tops, facing roughly camera-ward.
    const sites = [
        { x: -170, z: -150, s: 1.0 }, { x: 180, z: -150, s: 1.25 }, { x: -30, z: -238, s: 0.9 },
    ].slice(0, opts.count ?? 3);
    for (let i = 0; i < sites.length; i += 1) {
        const { x, z, s } = sites[i];
        const pillarH = 16 * s;
        const halfW = 10 * s;
        const t = 2.4 * s;
        pushBox(x, z, -halfW, pillarH * 0.5, 0, t, pillarH * 0.5, t); // left pillar
        pushBox(x, z, halfW, pillarH * 0.5, 0, t, pillarH * 0.5, t); // right pillar
        pushBox(x, z, 0, pillarH + t, 0, halfW + t, t, t); // lintel
    }

    return finishProp(u, {
        positions, anchors, colors, indices, cloudY, renderOrder: 1, doubleSide: false, rimStrength: 0.55,
    });
}

// ── Shared finisher: merged geometry + terrain-anchored painterly material. ───
export function finishProp(u, {
    positions, anchors, colors, indices, cloudY, renderOrder, doubleSide, rimStrength,
}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aAnchor', new THREE.Float32BufferAttribute(anchors, 2));
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    if (indices && indices.length) geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.frustumCulled = false;

    const material = new MeshBasicNodeMaterial({
        side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        transparent: false,
        alphaTest: 0.5,
        fog: false,
    });
    const aAnchor = attribute('aAnchor');
    const aColor = attribute('aColor');

    material.positionNode = Fn(() => {
        const terrainY = heightFieldTSL(aAnchor);
        return vec3(
            aAnchor.x.add(positionLocal.x),
            terrainY.add(positionLocal.y),
            aAnchor.y.add(positionLocal.z),
        );
    })();

    const aboveCloud = varying(
        smoothstep(float(cloudY), float(cloudY + 16.0), heightFieldTSL(aAnchor)),
        'vPropAbove',
    );

    material.colorNode = Fn(() => {
        const N = normalize(normalWorld).toVar();
        const worldP = positionWorld.toVar();
        const sunDir = normalize(u.uSunDir).toVar();
        const viewDir = normalize(u.uCameraPos.sub(worldP)).toVar();
        const diffuse = wrappedDiffuse(N, sunDir, 0.6).toVar();
        const lit = coloredShadowBlend(diffuse, aColor.mul(u.uSunColor), aColor.mul(u.uShadowTint).mul(0.8), 0.22);
        const ambient = aColor.mul(u.uSkyHorizon).mul(0.12);
        const rim = u.uRimColor.mul(fresnelRim(N, viewDir, 2.6, rimStrength)).mul(diffuse);
        const base = lit.add(ambient).add(rim);
        const dist = length(u.uCameraPos.sub(worldP));
        const fog = clamp(float(1.0).sub(exp(dist.mul(-0.0011))), float(0.0), float(1.0));
        return mix(base, u.uFogColor, fog.mul(0.6));
    })();
    material.emissiveNode = vec3(0.0);
    material.userData.emitsBloom = false;
    material.opacityNode = aboveCloud;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;

    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
