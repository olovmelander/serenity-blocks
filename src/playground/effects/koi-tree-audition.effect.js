/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — tree audition board.
 *
 * Loads every candidate CC0 tree GLB already vetted in this repo and lines them
 * up under the Koi Pond nocturnal jade material, so we can pick the canopy that
 * best matches the sakura-twilight quality bar before wiring a forest.
 *
 *   ?effect=koi-tree-audition&orbit=0&t=2
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
    cameraPosition, clamp, dot, float, mix, normalize, normalWorld,
    positionLocal, positionWorld, pow, smoothstep, vec3,
} from 'three/tsl';

import birchUrl from '../../themes/shared/assets/summer_birch_lod.glb?url';
import aspenUrl from '../../themes/summer/assets/summer_aspen_lod.glb?url';
import summerSpruceUrl from '../../themes/summer/assets/summer_spruce_lod.glb?url';
import winterFirUrl from '../../themes/shared/assets/fir_lod.glb?url';
import winterPineUrl from '../../themes/winter/assets/pine_lod.glb?url';
import odysseySpruceUrl from '../../rendering/odyssey/assets/shared/conifers/spruce_lod.glb?url';

export const meta = {
    id: 'koi-tree-audition',
    title: 'Koi Pond — Tree Audition (CC0 candidates)',
    description: 'Side-by-side CC0 tree GLBs under the Koi Pond nocturnal jade canopy material.',
};

const CANDIDATES = [
    { name: 'summer_birch_lod', url: birchUrl },
    { name: 'summer_aspen_lod', url: aspenUrl },
    { name: 'summer_spruce_lod', url: summerSpruceUrl },
    { name: 'winter_fir_lod', url: winterFirUrl },
    { name: 'winter_pine_lod', url: winterPineUrl },
    { name: 'odyssey_spruce_lod', url: odysseySpruceUrl },
];

// Koi Pond nocturnal canopy: dark jade underside lifting to a moonlit crown,
// plus a cool HDR backlight rim on silhouette edges (feeds the theme bloom).
function makeKoiCanopyMaterial() {
    const material = new THREE.MeshStandardNodeMaterial();
    const moonDir = normalize(vec3(-0.36, 0.82, -0.44));
    const form = smoothstep(-0.2, 1.4, positionLocal.y);
    material.colorNode = mix(
        vec3(0.004, 0.020, 0.017),
        vec3(0.035, 0.115, 0.075),
        form,
    );
    const view = normalize(cameraPosition.sub(positionWorld));
    const edge = pow(clamp(float(1).sub(dot(normalize(normalWorld), view)), 0, 1), float(1.9));
    const moon = clamp(dot(normalize(normalWorld), moonDir), 0, 1);
    material.emissiveNode = vec3(0.13, 0.32, 0.42).mul(edge.mul(moon.mul(0.85).add(0.13))).mul(1.4);
    material.roughnessNode = float(0.97);
    material.metalnessNode = float(0);
    return material;
}

export function create({ scene, renderer }) {
    const root = new THREE.Group();
    scene.add(root);
    const previousBackground = scene.background;
    scene.background = new THREE.Color(0x061018);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const canopyMat = makeKoiCanopyMaterial();
    const loaded = [];
    const disposables = [];

    root.add(new THREE.HemisphereLight(0xa6d7bd, 0x07100d, 2.0));
    const key = new THREE.DirectionalLight(0xcdf3dc, 2.6);
    key.position.set(-12, 26, -18);
    root.add(key);

    const loader = new GLTFLoader();
    // These CC0 tree GLBs are Draco-compressed (same as winter-trees.js).
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(draco);
    CANDIDATES.forEach((candidate, index) => {
        loader.loadAsync(candidate.url).then((gltf) => {
            const model = gltf.scene;
            // Normalize every candidate to ~6 units tall, seated on y=0.
            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3();
            box.getSize(size);
            const scale = 6 / Math.max(0.001, size.y);
            model.scale.setScalar(scale);
            model.position.set(
                (index - (CANDIDATES.length - 1) / 2) * 5.5,
                -box.min.y * scale,
                0,
            );
            model.traverse((child) => {
                if (child.isMesh) {
                    child.material = canopyMat;
                    disposables.push(child.geometry);
                }
            });
            model.name = candidate.name;
            root.add(model);
            loaded.push(candidate.name);
            console.log(`[TreeAudition] loaded ${candidate.name} (native height ${size.y.toFixed(2)})`);
        }).catch((error) => {
            console.error(`[TreeAudition] FAILED ${candidate.name}:`, error);
        });
    });

    if (typeof window !== 'undefined') {
        window.__TREE_AUDITION__ = { loaded, candidates: CANDIDATES.map((c) => c.name) };
    }

    return {
        cameraRadius: 26,
        camera(time, activeCamera) {
            activeCamera.position.set(0, 5.5, 24);
            activeCamera.lookAt(0, 3.2, 0);
            activeCamera.fov = 45;
            activeCamera.updateProjectionMatrix();
        },
        update() {},
        dispose() {
            if (typeof window !== 'undefined') delete window.__TREE_AUDITION__;
            scene.remove(root);
            disposables.forEach((g) => g.dispose?.());
            canopyMat.dispose();
            draco.dispose?.();
            scene.background = previousBackground;
        },
    };
}
