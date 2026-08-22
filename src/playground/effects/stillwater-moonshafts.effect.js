/**
 * Stillwater moonshafts in isolation — the r185 unblock retune.
 *
 * The volumetric shafts were parked for the whole r181 era: the repo never
 * enables shadow maps, r181's VolumetricLightingModel multiplied by the null
 * shadowNode unconditionally, and the WGSL died with `unresolved value 'null'`.
 * r185 guards that multiply (VolumetricLightingModel.js:183-185), so this
 * effect exists to (a) prove the real theme module compiles + renders on r185
 * and (b) retune density against r185's new front-to-back accumulation
 * (stepLight = scatteringDensity * 0.01, Beer falloff per step) before the
 * theme flips `?shafts=1` live.
 *
 * The scene is a stand-in for the theme's framing: a dark valley floor and a
 * canopy of branch occluders between the moon SpotLight and the channel, so
 * the shadow map carves the Bauer silhouette out of the light volume. Uses the
 * REAL `createStillwaterShafts` — every constant tuned here ships.
 */
import * as THREE from 'three/webgpu';
import { color } from 'three/tsl';
import { createStillwaterShafts } from '../../themes/stillwater/rendering/stillwater-shafts.js';

export const meta = {
    id: 'stillwater-moonshafts',
    title: 'Stillwater Moonshafts (volumetric)',
    description: 'shadow-carved moon shafts — r185 VolumeNodeMaterial retune of the real theme module',
};

export function create({ scene, renderer }) {
    // Opaque night backdrop: matches the theme's valley night and keeps the
    // canvas out of the r185 premultiplied-alpha variable entirely.
    scene.background = new THREE.Color(0x050a11);
    scene.fog = new THREE.FogExp2(0x050a11, 0.0045);

    // The carve needs a live shadow map; the playground renderer boots with
    // shadows off, so own the toggle here and restore it on dispose.
    const prevShadow = {
        enabled: renderer.shadowMap.enabled,
        type: renderer.shadowMap.type,
    };
    renderer.shadowMap.enabled = true;

    const root = new THREE.Group();
    root.name = 'moonshafts-playground-root';
    scene.add(root);

    const disposables = [];
    const track = (obj) => { disposables.push(obj); return obj; };

    // Valley floor — matte, shadow-receiving, dark enough that the volume reads
    // as light rather than haze over a bright ground.
    const groundMat = track(new THREE.MeshStandardNodeMaterial());
    groundMat.colorNode = color(0x0b141c);
    groundMat.roughness = 1.0;
    const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(420, 420)), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    root.add(ground);

    // Canopy occluders: long branch slabs strung across the light path above
    // the volume (volume top ≈ y 39; light comes from (51, 73, -112) toward
    // (0, 0, -20)). Their shadows are what turn the cone into shafts.
    const branchMat = track(new THREE.MeshStandardNodeMaterial());
    branchMat.colorNode = color(0x05080c);
    branchMat.roughness = 1.0;
    const branchGeo = track(new THREE.BoxGeometry(34, 1.4, 3.2));
    // A broken roof: dense enough that most of the cone is in shadow and the
    // light only survives through the gaps — the carve IS the image. The real
    // theme's canopy arch plays this role in-game.
    const branches = [
        {
            p: [18, 40, -52], ry: 0.35, rz: 0.06, s: 1.25,
        },
        {
            p: [4, 37, -44], ry: -0.22, rz: -0.04, s: 1.0,
        },
        {
            p: [28, 43, -62], ry: 0.62, rz: 0.1, s: 1.4,
        },
        {
            p: [-8, 38, -56], ry: 0.12, rz: 0.02, s: 0.9,
        },
        {
            p: [12, 45, -70], ry: -0.45, rz: -0.08, s: 1.2,
        },
        {
            p: [34, 39, -40], ry: 0.18, rz: 0.05, s: 0.8,
        },
        {
            p: [-2, 42, -66], ry: 0.8, rz: -0.03, s: 1.1,
        },
        {
            p: [24, 41, -46], ry: -0.5, rz: 0.03, s: 1.3,
        },
        {
            p: [10, 39, -58], ry: 0.55, rz: -0.06, s: 1.15,
        },
        {
            p: [30, 44, -72], ry: 0.05, rz: 0.08, s: 1.5,
        },
        {
            p: [-14, 40, -48], ry: -0.3, rz: 0.02, s: 1.05,
        },
        {
            p: [40, 42, -56], ry: 0.4, rz: -0.05, s: 1.2,
        },
        {
            p: [16, 43, -36], ry: -0.75, rz: 0.04, s: 0.95,
        },
        {
            p: [2, 44, -78], ry: 0.25, rz: -0.02, s: 1.35,
        },
    ];
    for (const b of branches) {
        const m = new THREE.Mesh(branchGeo, branchMat);
        m.position.set(b.p[0], b.p[1], b.p[2]);
        m.rotation.set(0, b.ry, b.rz);
        m.scale.setScalar(b.s);
        m.castShadow = true;
        root.add(m);
    }

    // Faint fill so the branches/floor are not pure silhouettes against black.
    const hemi = new THREE.HemisphereLight(0x1c2836, 0x05070b, 0.35);
    root.add(hemi);

    // The real theme module — light + volume + scattering graph, unmodified.
    const shafts = createStillwaterShafts({ root });

    return {
        update(time) {
            shafts.update(time);
        },
        camera(time, camera) {
            // Static, theme-like framing: low in the channel looking up-valley
            // into the shaft volume (centre (4, 16, -26)).
            camera.position.set(-6, 11, 78);
            camera.lookAt(4, 18, -32);
        },
        dispose() {
            shafts.dispose();
            root.removeFromParent();
            for (const d of disposables) d.dispose?.();
            renderer.shadowMap.enabled = prevShadow.enabled;
            renderer.shadowMap.type = prevShadow.type;
            scene.fog = null;
            scene.background = null;
        },
    };
}
