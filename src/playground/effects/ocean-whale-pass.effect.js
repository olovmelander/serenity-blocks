/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * OCEAN WHALE PASS — the look bench for a whale gliding over the Act I ascent.
 *
 * The camera climbs the water column looking UP toward the bright surface, so a whale crossing
 * overhead is a SILHOUETTE against the light — the single most iconic underwater image there is
 * (ABZÛ, Big Blue). This bench answers "does the project-owned whale GLB carry that read?"
 * before anything is wired into the game: the whale glides across a bright, depth-graded water
 * ceiling, shaded the way it will be in-world — dark back, a soft belly lit from below by the
 * scattered light, a fresnel rim where the surface light wraps the body, and colour-with-
 * distance toward the water so it sits IN the medium instead of on top of it.
 *
 * URL: ?effect=ocean-whale-pass&t=6   (t drives the glide phase + the animation clip)
 */
import * as THREE from 'three/webgpu';
import {
    abs, cameraPosition, clamp, dot, length, mix, normalView, normalWorld, normalize,
    oneMinus, positionLocal, positionWorld, pow, smoothstep, uniform, vec3,
} from 'three/tsl';
import { loadOdysseyGltfCached } from '../../rendering/odyssey/chapter-environments/shared/odyssey-gltf-loader.js';
import {
    getChapter2CreatureAssetById,
} from '../../rendering/odyssey/chapter-environments/shared/chapter-02-creature-assets.js';

export const meta = {
    id: 'ocean-whale-pass',
    title: 'Ocean — whale pass (look bench)',
    description: 'Hero whale silhouette gliding over the ascent against the bright water ceiling.',
};

const WATER_DEEP = new THREE.Color(0x0b3a5c);
const WATER_SHALLOW = new THREE.Color(0x4fb4c8);

export function create({
    scene, camera, params,
}) {
    const uTime = uniform(0);
    const uWater = uniform(WATER_SHALLOW.clone().lerp(WATER_DEEP, 0.45));
    const disposables = [];

    // ── The water ceiling: a BackSide dome, bright toward the zenith (Snell's window), deep below.
    const domeMat = new THREE.MeshBasicNodeMaterial();
    const dDir = normalize(positionLocal);
    const up = clamp(dDir.y, -1.0, 1.0);
    const snell = smoothstep(0.55, 0.98, up);
    domeMat.colorNode = mix(vec3(WATER_DEEP), vec3(WATER_SHALLOW), smoothstep(-0.3, 0.7, up))
        .add(vec3(0.85, 0.98, 1.0).mul(pow(snell, 2.0)).mul(0.9));
    domeMat.side = THREE.BackSide;
    domeMat.depthWrite = false;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), domeMat);
    scene.add(dome);
    disposables.push(dome.geometry, domeMat);

    // ── The whale material: back-lit silhouette in the medium.
    const whaleMat = new THREE.MeshBasicNodeMaterial();
    const nW = normalize(normalWorld);
    const belly = clamp(nW.y.negate(), 0.0, 1.0); // faces looking DOWN at the viewer below
    const backLit = clamp(nW.y, 0.0, 1.0); // faces toward the surface light
    const fres = pow(oneMinus(abs(dot(normalize(normalView), vec3(0, 0, 1)))), 2.5);
    const back = vec3(0.020, 0.050, 0.075);
    const bellyCol = vec3(0.10, 0.20, 0.26);
    let body = mix(back, bellyCol, pow(belly, 1.4).mul(0.85));
    // Surface light wrapping the silhouette's edge: the rim is where the whale meets the light.
    body = body.add(vec3(0.55, 0.85, 0.95).mul(fres).mul(backLit.mul(0.6).add(0.25)).mul(0.55));
    // Colour-with-distance: the whale sits IN the water.
    const dist = length(positionWorld.sub(cameraPosition));
    const haze = smoothstep(40.0, 420.0, dist).mul(0.85);
    whaleMat.colorNode = mix(body, uWater, haze);
    whaleMat.side = THREE.DoubleSide;
    disposables.push(whaleMat);

    let mixer = null;
    let whale = null;
    const rec = getChapter2CreatureAssetById('whale-glide');
    const ready = rec ? loadOdysseyGltfCached(rec.url).then(({ scene: model, animations }) => {
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const s = (Number(params.get('size')) || 60) / Math.max(size.x, size.y, size.z);
        model.scale.setScalar(s);
        model.traverse((o) => {
            if (o.isMesh) {
                o.material = whaleMat;
                o.frustumCulled = false;
            }
        });
        whale = new THREE.Group();
        whale.add(model);
        scene.add(whale);
        if (animations[0]) {
            mixer = new THREE.AnimationMixer(model);
            mixer.clipAction(animations[0]).play();
        }
        return true;
    }) : Promise.resolve(false);
    ready.catch((e) => console.error('[whale-pass] load failed', e));

    camera.position.set(0, 0, 0);
    camera.lookAt(0, 1, 0.15);

    return {
        cameraRadius: 0,
        update(time) {
            uTime.value = time;
            if (mixer) mixer.setTime(time % 10);
            if (whale) {
                // Glide across the zenith: -1 -> +1 over 24 s, 70 u overhead, slow bank.
                const k = ((time / 24) % 1) * 2 - 1;
                whale.position.set(k * 120, 70 + Math.sin(time * 0.3) * 4, 18);
                whale.rotation.set(0, Math.PI / 2, Math.sin(time * 0.4) * 0.08);
            }
        },
        camera(time, cam) {
            cam.position.set(0, 0, 0);
            cam.lookAt(0, 1, 0.25);
        },
        dispose() {
            if (whale) scene.remove(whale);
            scene.remove(dome);
            disposables.forEach((d) => d.dispose?.());
        },
    };
}
