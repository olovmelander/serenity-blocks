/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Far-Range Silhouette material & Summit Light
 *
 * Re-skins the distant massif as a colored silhouette band heavily eaten by
 * aerial perspective. Also provides the Volumetric Summit Light Shaft and
 * Horizontal Lens Flare Wings for the centerpiece holy mountain.
 *
 * Reads the orchestrator's shared uniform block.
 *
 * See docs/SKY_CHILDREN_V2_AAA_PLAN.md §4.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    clamp,
    dot,
    exp,
    float,
    length,
    mix,
    normalize,
    normalWorld,
    positionWorld,
    uv,
    vec3,
} from 'three/tsl';
import { wrappedDiffuse, fresnelRim } from '../sky-children-lighting.js';

const ROCK_SHADOW = vec3(0.275, 0.259, 0.369); // cool violet rock
const ROCK_LIT = vec3(0.56, 0.525, 0.659); // pale lit rock

export function createFarRangeMaterial(u) {
    const material = new MeshBasicNodeMaterial({ fog: false });

    const shade = () => {
        const N = normalize(normalWorld).toVar();
        const worldP = positionWorld.toVar();
        const sunDir = normalize(u.uSunDir).toVar();
        const viewDir = normalize(u.uCameraPos.sub(worldP)).toVar();

        const diffuse = wrappedDiffuse(N, sunDir, 0.7);
        const rockBase = mix(ROCK_SHADOW, ROCK_LIT, diffuse);
        // Warm sun-rim on ridge edges (the only crisp detail that survives the haze).
        const rim = u.uRimColor.mul(fresnelRim(N, viewDir, 2.2, 0.7)).toVar();
        const rock = rockBase.add(rim);

        // Aerial perspective — softer so the range reads as a clear distant
        // silhouette (Sky-COTL peak), not a fully dissolved ghost.
        const dist = length(u.uCameraPos.sub(worldP));
        const fog = clamp(float(1.0).sub(exp(dist.mul(-0.0016))), float(0.0), float(1.0)).toVar();
        const color = mix(rock, u.uFogColor, fog.mul(0.72));
        const emissive = rim.mul(float(1.0).sub(fog.mul(0.85)));
        return { color, emissive };
    };

    material.colorNode = Fn(() => shade().color)();
    material.emissiveNode = Fn(() => shade().emissive)();
    material.userData.emitsBloom = true;
    return material;
}

/**
 * Creates the glowing vertical light shaft and horizontal wings at the mountain apex.
 * @param {object} u        shared uniform block
 * @param {object} apexPos  THREE.Vector3 position of the mountain peak
 */
export function createSummitLight(u, apexPos) {
    const group = new THREE.Group();
    const disposables = [];

    // 1. The Volumetric Light Shaft (open ended cylinder)
    const beamGeometry = new THREE.CylinderGeometry(8, 20, 320, 16, 1, true);
    beamGeometry.translate(0, 160, 0); // shift pivot to bottom
    disposables.push(beamGeometry);

    const beamMaterial = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
    });
    disposables.push(beamMaterial);

    beamMaterial.colorNode = vec3(1.0, 0.94, 0.82).mul(1.8).add(u.uSunColor.mul(0.6));
    beamMaterial.opacityNode = Fn(() => {
        const v = uv();
        // Fade out at top (Y=1) and bottom (Y=0)
        const verticalFade = v.y.mul(float(1.0).sub(v.y)).mul(4.0);
        // Volumetric edge fade (facing ratio)
        const viewDir = normalize(u.uCameraPos.sub(positionWorld)).toVar();
        const facing = clamp(dot(normalize(normalWorld), viewDir), float(0.0), float(1.0));
        const edgeFade = float(1.0).sub(facing).pow(1.5);

        return verticalFade.mul(edgeFade).mul(0.55).mul(float(1.0).sub(u.uRadiance.mul(0.3)));
    })();

    const beamMesh = new THREE.Mesh(beamGeometry, beamMaterial);
    beamMesh.position.copy(apexPos);
    group.add(beamMesh);

    // 2. The Horizontal Lens Flare Wings
    const flareGeometry = new THREE.PlaneGeometry(240, 20);
    disposables.push(flareGeometry);

    const flareMaterial = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
    });
    disposables.push(flareMaterial);

    flareMaterial.colorNode = vec3(1.0, 0.72, 0.42).mul(2.2);
    flareMaterial.opacityNode = Fn(() => {
        const v = uv();
        // Horizontal line fade: thick in center, fades out horizontally
        const horizFade = exp(v.x.sub(0.5).pow(2).div(-0.024));
        // Vertical line fade: thin and sharp
        const vertFade = exp(v.y.sub(0.5).pow(2).div(-0.012));
        return horizFade.mul(vertFade).mul(0.72);
    })();

    const flareMesh = new THREE.Mesh(flareGeometry, flareMaterial);
    flareMesh.position.copy(apexPos).add(new THREE.Vector3(0, 0, 2));
    group.add(flareMesh);

    return {
        group,
        update(camera) {
            if (camera) {
                // Keep the flare facing the camera
                flareMesh.quaternion.copy(camera.quaternion);
            }
        },
        dispose() {
            disposables.forEach((d) => d?.dispose?.());
        },
    };
}
