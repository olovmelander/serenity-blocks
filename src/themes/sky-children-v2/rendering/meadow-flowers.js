/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Colored Flower Fields (Phase 7.1)
 *
 * Scatters thousands of small colored flower cards across the GREEN ISLANDS that
 * poke above the cloud sea — the yellow/pink/white/purple/blue flower fields from
 * the Sky-COTL key art.
 *
 * Smart placement:
 *   - Candidates are scattered in disks around the island regions (so they land on
 *     the grass islands, not the cloud).
 *   - The reused `sky-core-flower-carpet-field` ORACLE picks each flower's color
 *     family from coherent painterly bands/patches (spatial color variety).
 *   - Each flower is anchored to the EXACT terrain via the shared `heightFieldTSL`
 *     (GPU), and any flower whose ground sits at/below the cloud is alpha-discarded.
 *
 * One merged geometry (built ONCE — no per-frame rebuild), one MeshBasicNodeMaterial
 * that reads the shared `u` block (so flowers warm/cool with the MoodDirector and
 * sway with `u.uGust`). Cross-card billboards = visible from any angle.
 *
 * See docs/SKY_CHILDREN_V2_AAA_PLAN.md §7.1.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    exp,
    float,
    length,
    mix,
    normalize,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { heightFieldTSL, ISLAND_REGIONS } from './valley-terrain.js';
import { createFlowerCarpetField } from '../../shared/sky-core/sky-core-flower-carpet-field.js';

// Flower head colors per oracle family — deeper/more saturated so they pop
// against the bright meadow instead of washing pale.
const FAMILY_COLOR = {
    yellow: [1.0, 0.80, 0.16],
    pink: [0.98, 0.40, 0.62],
    white: [0.98, 0.96, 0.90],
    purple: [0.64, 0.38, 0.92],
    blue: [0.36, 0.58, 0.96],
};
const STEM = [0.34, 0.52, 0.27];

/**
 * @param {object} u            shared uniform block
 * @param {object} terrainField CPU terrain field (oracle reads path/valley masks)
 * @param {object} opts         { count, cloudY }
 */
export function createMeadowFlowers(u, terrainField, opts = {}) {
    const total = Math.max(200, Math.floor(opts.count ?? 4000));
    const cloudY = opts.cloudY ?? 10;
    const carpet = createFlowerCarpetField(terrainField, { palettePreset: 'prairie', carpetStrength: 1 });

    const positions = []; // local card offset
    const anchors = []; // world xz the flower is planted at
    const colors = [];
    const phases = [];
    const uvy = []; // 0 base → 1 top (stem→petal gradient + sway)
    const uvx = []; // -1..1 across the card width (petal shape)
    const indices = [];

    const sumR2 = ISLAND_REGIONS.reduce((s, isl) => s + isl.r * isl.r, 0);

    // One quad (4 verts, 2 tris); `rot` swaps X/Z so the cross has two cards.
    const pushQuad = (ax, az, w, h, col, phase, rot) => {
        const base = positions.length / 3;
        const corners = [
            [-w, 0, 0, -1, 0], [w, 0, 0, 1, 0], [w, h, 0, 1, 1], [-w, h, 0, -1, 1],
        ];
        for (let c = 0; c < 4; c += 1) {
            let [lx, ly, lz, ux, uy] = corners[c];
            if (rot) { const t = lx; lx = lz; lz = t; } // rotate 90° about Y
            positions.push(lx, ly, lz);
            anchors.push(ax, az);
            colors.push(col[0], col[1], col[2]);
            phases.push(phase);
            uvx.push(ux);
            uvy.push(uy);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    for (let r = 0; r < ISLAND_REGIONS.length; r += 1) {
        const isl = ISLAND_REGIONS[r];
        const n = Math.max(1, Math.round(total * ((isl.r * isl.r) / sumR2)));
        for (let i = 0; i < n; i += 1) {
            const a = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random()) * isl.r;
            const x = isl.x + Math.cos(a) * rr;
            const z = isl.z + Math.sin(a) * rr;

            const sample = carpet.sampleCarpet(x, z);
            const fam = FAMILY_COLOR[sample.family] ? sample.family : 'white';
            const src = FAMILY_COLOR[fam];
            const shade = 0.84 + Math.random() * 0.3;
            const col = [
                Math.min(1, src[0] * shade),
                Math.min(1, src[1] * shade),
                Math.min(1, src[2] * shade),
            ];

            const h = 2.6 + Math.random() * 2.6;
            const w = h * (0.16 + Math.random() * 0.08);
            const phase = Math.random() * 6.2831;
            pushQuad(x, z, w, h, col, phase, 0);
            pushQuad(x, z, w, h, col, phase, 1);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aAnchor', new THREE.Float32BufferAttribute(anchors, 2));
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
    geometry.setAttribute('aUvy', new THREE.Float32BufferAttribute(uvy, 1));
    geometry.setAttribute('aUvx', new THREE.Float32BufferAttribute(uvx, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals(); // silence "normal not found" (MeshBasicNodeMaterial)
    geometry.frustumCulled = false;

    const material = new MeshBasicNodeMaterial({
        side: THREE.DoubleSide,
        transparent: false,
        alphaTest: 0.45,
        fog: false,
    });

    const aAnchor = attribute('aAnchor');
    const aPhase = attribute('aPhase');
    const aUvy = attribute('aUvy');
    const aUvx = attribute('aUvx');
    const aColor = attribute('aColor');

    // Anchor each card to the exact terrain surface + wind sway at the top.
    material.positionNode = Fn(() => {
        const terrainY = heightFieldTSL(aAnchor).toVar();
        const sway = sin(u.uTime.mul(1.6).add(aPhase))
            .mul(aUvy).mul(float(0.5).add(u.uGust.mul(1.3)));
        return vec3(
            aAnchor.x.add(positionLocal.x).add(sway.mul(0.9)),
            terrainY.add(positionLocal.y),
            aAnchor.y.add(positionLocal.z).add(sway.mul(0.4)),
        );
    })();

    // Hide flowers whose ground sits at/below the cloud sea (computed once/vertex).
    const aboveCloud = varying(
        smoothstep(float(cloudY), float(cloudY + 16.0), heightFieldTSL(aAnchor)),
        'vFlowerAbove',
    );

    material.colorNode = Fn(() => {
        const stem = vec3(STEM[0], STEM[1], STEM[2]);
        const albedo = mix(stem, aColor, smoothstep(float(0.32), float(0.66), aUvy)).toVar();
        // Simple sun-lit + cool ambient (flowers face up); colored shadow tint.
        const sunDir = normalize(u.uSunDir);
        const ndl = clamp(dot(vec3(0.0, 1.0, 0.0), sunDir), float(0.15), float(1.0));
        const lit = albedo.mul(u.uSunColor.mul(float(0.5).add(ndl.mul(0.55)))
            .add(u.uShadowTint.mul(0.22)));
        // Aerial perspective toward the shared fog/sky color.
        const dist = length(u.uCameraPos.sub(positionWorld));
        const fog = clamp(float(1.0).sub(exp(dist.mul(-0.0009))), float(0.0), float(1.0));
        return mix(lit, u.uFogColor, fog.mul(0.32));
    })();

    material.emissiveNode = vec3(0.0);
    material.userData.emitsBloom = false;

    // Petal shape (taper to a soft point) × below-cloud discard (alphaTest).
    material.opacityNode = Fn(() => {
        const petal = float(1.0).sub(smoothstep(float(0.45), float(1.0), aUvx.abs().mul(aUvy)));
        return aboveCloud.mul(petal);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;

    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
