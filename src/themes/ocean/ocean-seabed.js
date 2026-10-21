/**
 * Ocean — the seabed: sand in the canyon's channel, reef rock on its shoulders.
 *
 * One sheet laid over `seabedHeight` (ocean-core.js), finest under the viewer and coarser out
 * toward the blue. Sand and rock are told apart per vertex; the sand's ripples, the rock's crust
 * and the caustic net that plays over both are worked out per pixel. The net is read three
 * times, a hand's breadth apart along the light, so its threads carry a fringe of colour the way
 * real ones do.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    cos,
    exp,
    float,
    length,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    ocCaustic, ocFog, ocLight, ocPart, ocRings, ocShade, ocStains,
} from './ocean-tsl.js';
import { SEABED_SPAN, bakeSeabed } from './ocean-core.js';

export { SEABED_SPAN };

/**
 * @param {object} u
 * @param {object} [options]
 * @param {number} [options.detail=1]  share of the full grid (160 × 200 cells)
 */
export function createSeabed(u, { detail = 1 } = {}) {
    // The vertex data is a shared, read-only bake (the bake cache keeps it for the next build).
    const {
        nx, nz, position, normal, ground, index,
    } = bakeSeabed(detail);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aGround', new THREE.BufferAttribute(ground, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OceanSeabed';
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;
    const aGround = attribute('aGround', 'vec2');
    material.colorNode = Fn(() => {
        const P = positionWorld;
        // The patterns are laid out on the stage as built, so a narrow frame does not stretch them.
        const st = positionGeometry.xz;
        const rock = smoothstep(0.3, 0.7, aGround.x).toVar();
        const dist = length(P.sub(cameraPosition));
        const near = exp(dist.mul(-0.055));
        const broad = u.noise(st.mul(0.035));
        const mid = u.noise(st.mul(0.21));
        const fine = u.noise(st.mul(0.9));

        // ── Sand: pale, in ripples that run across the current ──
        const phase = st.x.mul(0.35).add(st.y.mul(0.94)).mul(15.0).add(broad.r.mul(9.0))
            .add(mid.g.mul(2.2));
        const sand = mix(vec3(0.6, 0.52, 0.38), vec3(0.82, 0.76, 0.6), broad.g)
            .mul(sin(phase).mul(0.07).mul(near).add(0.95))
            .mul(fine.r.mul(0.16).add(0.92));

        // ── Rock: dark limestone under a crust of coralline rose, turf and sponge ──
        const stone = mix(vec3(0.075, 0.075, 0.08), vec3(0.24, 0.22, 0.2), mid.r);
        const crust = u.noise(st.mul(0.31).add(vec2(0.37, 0.11)));
        const rose = smoothstep(0.5, 0.72, crust.b).mul(0.42);
        const turf = smoothstep(0.48, 0.7, crust.a).mul(0.45);
        const sponge = smoothstep(0.74, 0.8, fine.b).mul(0.35);
        const reef = mix(
            mix(mix(stone, vec3(0.36, 0.17, 0.27), rose), vec3(0.1, 0.2, 0.1), turf),
            vec3(0.6, 0.28, 0.1),
            sponge,
        ).mul(fine.g.mul(0.6).add(0.66));
        const albedo = mix(sand, reef, rock);

        // ── The normal: the sheet's own, the ripples' on sand, the rock's roughness ──
        const ripple = vec3(0.35, 0.0, 0.94).mul(cos(phase)).mul(near).mul(float(1.0).sub(rock))
            .mul(0.26);
        const rough = vec3(mid.r.sub(0.5), 0.0, mid.g.sub(0.5)).mul(rock).mul(0.9)
            .add(vec3(fine.b.sub(0.5), 0.0, fine.a.sub(0.5)).mul(rock).mul(near).mul(0.7));
        const N = normalize(normalize(normalWorld).add(ripple).add(rough)).toVar();

        // ── The light: the net three times over, a little apart along the light ──
        const axis = normalize(u.sunDir.xz.add(vec2(1e-3, 0.0)));
        const net = vec3(
            ocCaustic(u, P, axis.mul(0.04)),
            ocCaustic(u, P),
            ocCaustic(u, P, axis.mul(-0.04)),
        );
        const light = ocLight(u, {
            N, P, caustic: net, shade: ocShade(u, P), wrap: 0.3,
        });
        const col = albedo.mul(light).mul(aGround.y).toVar();

        // ── What the board lays on the reef ──
        const rings = ocRings(u, P.xz);
        const stains = ocStains(u, P.xz);
        col.addAssign(albedo.mul(rings).mul(1.5).add(rings.mul(0.45)).mul(u.breath));
        col.addAssign(albedo.mul(stains).mul(0.9).add(stains.mul(0.08)).mul(u.breath));
        return vec4(ocFog(u, col, P), 1.0);
    })();
    const part = ocPart('OceanSeabed', geometry, material, 2);
    part.cells = nx * nz;
    return part;
}
