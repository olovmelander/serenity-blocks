/**
 * Playground study for the Golden Forest golden Koi-grade lake water.
 *
 *   ?effect=golden-forest-water&orbit=0&t=8
 *   ?effect=golden-forest-water&orbit=0&t=8&forceWebGL=1
 *
 * A representative golden backdrop — the theme's own sky dome + warm fog + a
 * dark pine treeline ring + a few shore logs — wrapped around the shared
 * createGoldenLakeNodeMaterial() so the water (and crucially its reflection of
 * the dark treeline + low sun) can be judged in isolation the way it reads in
 * the real scene, then ported into golden-forest-theme.js. One small scene —
 * full-journey WebGPU captures have TDR-crashed the dev iGPU.
 */
import * as THREE from 'three/webgpu';
import { reflector } from 'three/tsl';
import {
    createGoldenLakeNodeMaterial,
    createSkyNodeMaterial,
} from '../../themes/golden-forest/golden-forest-materials.js';

export const meta = {
    id: 'golden-forest-water',
    title: 'Golden Forest — Golden Lake Water',
    description: 'Koi-grade analytic-normal water retuned golden; dark treeline + low sun mirror.',
};

// Matches the theme sun (this.sunPosition = (0, 30, -140)).
const SUN_POSITION = new THREE.Vector3(0, 30, -140);
const SUN_DIRECTION = SUN_POSITION.clone().normalize();
const LAKE_RADIUS = 92;
const REFLECTION_LAYER = 2;

export function create({ scene, renderer, camera }) {
    const timeScale = 0.4;

    const previous = {
        background: scene.background,
        fog: scene.fog,
        toneMapping: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
    };

    // Representative grade so playground colour ~ in-game (theme owns real post/bloom).
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    scene.background = new THREE.Color(0x1e0a06);
    scene.fog = new THREE.FogExp2(0xd8752e, 0.0042);

    const disposables = [];
    const own = (object) => {
        disposables.push(object);
        return object;
    };
    const root = new THREE.Group();
    scene.add(root);

    // ── Golden sky dome (theme material; its own sun disc + halo) ──────────
    const sky = createSkyNodeMaterial({ sunDirection: SUN_DIRECTION });
    sky.material.fog = false; // the dome IS the horizon — never fog it
    const skyDome = new THREE.Mesh(
        own(new THREE.SphereGeometry(600, 32, 20)),
        sky.material,
    );
    own(sky.material);
    root.add(skyDome);
    skyDome.layers.enable(REFLECTION_LAYER);

    // ── Dark pine treeline ring around the far/side shores ─────────────────
    // Near-black silhouettes give the water a real dark shape to mirror and set
    // the scene's value range (lake should read darker than the lit sky).
    const treeMaterial = own(new THREE.MeshBasicNodeMaterial({ color: 0x0a0603 }));
    treeMaterial.fog = true;
    const treeGeometry = own(new THREE.ConeGeometry(1, 1, 7, 1));
    const TREE_COUNT = 116;
    const trees = new THREE.InstancedMesh(treeGeometry, treeMaterial, TREE_COUNT);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < TREE_COUNT; i += 1) {
        // Bias the ring toward the far half (−Z, toward the sun) where the
        // camera looks, with a couple of staggered depth rows.
        const angle = -Math.PI + (i / TREE_COUNT) * Math.PI * 2;
        const row = i % 3;
        const radius = LAKE_RADIUS + 4 + row * 9 + Math.sin(i * 3.1) * 3;
        const height = 9 + (Math.sin(i * 12.7) * 0.5 + 0.5) * 15 - row * 1.5;
        const width = height * (0.16 + Math.sin(i * 5.3) * 0.03);
        p.set(Math.sin(angle) * radius, height * 0.5 - 0.6, -Math.abs(Math.cos(angle)) * radius - 2);
        q.identity();
        s.set(width, height, width);
        m.compose(p, q, s);
        trees.setMatrixAt(i, m);
    }
    trees.instanceMatrix.needsUpdate = true;
    own(trees.geometry);
    root.add(trees);
    trees.layers.enable(REFLECTION_LAYER);

    // ── Lake (shared production material) ──────────────────────────────────
    // RingGeometry(0..R) gives a multi-ring disc with radial UVs (centre 0.5,
    // rim 1.0) — exactly what the material's centerDist expects.
    // Real planar reflection of the environment (sky + treeline + sun).
    const reflection = reflector({ resolutionScale: 0.5, bounces: false, generateMipmaps: false });
    reflection.target.rotateX(-Math.PI / 2);
    reflection.target.position.set(0, 0, 0);
    root.add(reflection.target);
    reflection.reflector.getVirtualCamera(camera).layers.set(REFLECTION_LAYER);

    const lakeGeometry = own(new THREE.RingGeometry(0.0, LAKE_RADIUS, 220, 88));
    lakeGeometry.rotateX(-Math.PI / 2);
    const lake = createGoldenLakeNodeMaterial({ sunDirection: SUN_DIRECTION, reflection });
    own(lake.material);
    const lakeMesh = new THREE.Mesh(lakeGeometry, lake.material);
    lakeMesh.position.y = 0;
    lakeMesh.renderOrder = 10;
    root.add(lakeMesh);

    // ── A few dark shore logs at the material's object-foam positions ──────
    const logMaterial = own(new THREE.MeshBasicNodeMaterial({ color: 0x120a05 }));
    const logGeometry = own(new THREE.CylinderGeometry(1.6, 1.9, 14, 10, 1));
    const logs = new THREE.Group();
    [[-45, -15, 0.5], [22, -15, -0.4], [85, 5, 1.1]].forEach(([x, z, rot]) => {
        const log = new THREE.Mesh(logGeometry, logMaterial);
        log.rotation.set(Math.PI / 2, 0, rot);
        log.position.set(x, -0.2, z);
        logs.add(log);
    });
    root.add(logs);

    return {
        // Low, grazing framing across the lake toward the low -Z sun.
        camera(time, camera) {
            camera.position.set(0, 4.6, 70);
            camera.lookAt(0, 3.0, -60);
        },
        update(time) {
            const t = time * timeScale;
            lake.uniforms.uTime.value = t;
            sky.uniforms.uTime.value = t;
        },
        resize() {},
        dispose() {
            scene.remove(root);
            reflection.dispose?.();
            disposables.forEach((object) => object.dispose?.());
            scene.background = previous.background;
            scene.fog = previous.fog;
            renderer.toneMapping = previous.toneMapping;
            renderer.toneMappingExposure = previous.exposure;
        },
    };
}
