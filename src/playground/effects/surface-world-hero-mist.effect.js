// ═══════════════════════════════════════════════════════════════════════════════
// Odyssey Ch3 "Surface World" — masterpiece rebuild, HERO element: volumetric golden-hour mist.
//
// See docs/ODYSSEY_CH3_SURFACE_WORLD_REBUILD_PLAN.md. Atmospheric depth is the last isolatable
// hero: soft warm mist banks hug the valley floor between the foreground meadow and the distant
// treeline, catching the low sun (SURFACE_SUN_DIR) — the golden-hour "light through haze" that
// separates the depth planes and sells the scale. Built as instanced camera-facing fog cards from
// ONE material (per-instance aPhase desyncs the drift), on-message with the consolidation goal.
// Ports as a shared mist material into the chapter's mountain-mist / atmosphere layer.
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three/webgpu';
import {
    uniform, uv, attribute, cameraPosition, positionWorld,
    vec3, sin, smoothstep, oneMinus, mix, length, normalize, dot, clamp,
} from 'three/tsl';
import {
    createSkyBackgroundTSL,
    SURFACE_SUN_DIR,
} from '../../rendering/odyssey/chapter-environments/surface-world.tsl.js';

export const meta = {
    id: 'surface-world-hero-mist',
    title: 'Surface World — Golden-hour mist (Ch3 hero · atmospheric depth)',
    description: 'Ch3 hero: warm volumetric mist banks between meadow and treeline, one instanced material',
};

const SUN = new THREE.Vector3().copy(SURFACE_SUN_DIR);

function makeMistMaterial(uTime) {
    const vUv = uv();
    const aPhase = attribute('aPhase', 'float');
    // Soft drifting density — a couple of sin octaves read as slow fog, cheap (no noise texture).
    const drift = uTime.mul(0.022);
    const px = vUv.x.mul(3.4).add(drift).add(aPhase);
    const py = vUv.y.mul(2.2).add(aPhase.mul(0.5));
    const n1 = sin(px).mul(sin(py.mul(1.3)));
    const n2 = sin(px.mul(2.1).add(1.7)).mul(sin(py.mul(2.4).sub(0.5)));
    let density = n1.mul(0.5).add(n2.mul(0.3)).add(0.5);
    density = smoothstep(0.42, 0.95, density); // wispy banks, not a solid slab
    const vgrad = oneMinus(smoothstep(0.0, 0.8, vUv.y)); // denser low → ground-hugging
    const edge = smoothstep(0.0, 0.18, vUv.x)
        .mul(oneMinus(smoothstep(0.82, 1.0, vUv.x)))
        .mul(oneMinus(smoothstep(0.55, 1.0, vUv.y))); // soft card edges
    const alpha = density.mul(vgrad).mul(edge).mul(0.5);

    // Warm golden mist, brighter toward the sun side; a subtle extra glow where the view looks
    // toward the sun (the haze scatters the low light).
    const V = normalize(cameraPosition.sub(positionWorld));
    const towardSun = clamp(dot(V, vec3(SUN.x, SUN.y, SUN.z)).negate(), 0.0, 1.0);
    let warm = mix(vec3(0.84, 0.76, 0.64), vec3(1.0, 0.87, 0.6), oneMinus(vUv.x));
    warm = warm.add(vec3(0.3, 0.22, 0.1).mul(towardSun));

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = warm;
    mat.opacityNode = alpha;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    return mat;
}

function makeGroundMaterial() {
    const sunDir = vec3(SUN.x, SUN.y, SUN.z);
    const N = normalize(vec3(0.0, 1.0, 0.0));
    const wrap = dot(N, sunDir).mul(0.5).add(0.5);
    const key = vec3(1.0, 0.86, 0.55).mul(wrap.mul(0.6).add(0.44));
    let col = vec3(0.19, 0.3, 0.12).mul(key);
    const d = length(cameraPosition.sub(positionWorld));
    col = mix(col, vec3(0.82, 0.68, 0.48), smoothstep(30.0, 220.0, d).mul(0.55));
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = col;
    return mat;
}

export function create({ scene }) {
    const uTime = uniform(0);
    const uSeason = uniform(0.12);
    const disposables = [];
    const own = (o) => { disposables.push(o); return o; };
    const root = new THREE.Group();
    scene.add(root);

    const sky = createSkyBackgroundTSL(uTime, { uSeason });
    root.add(sky.mesh);

    const groundGeo = own(new THREE.PlaneGeometry(400, 400, 1, 1));
    groundGeo.rotateX(-Math.PI / 2);
    root.add(new THREE.Mesh(groundGeo, own(makeGroundMaterial())));

    // Dark treeline on the far bank — the depth plane the mist nestles in front of.
    const coneGeo = own(new THREE.ConeGeometry(1, 1, 6));
    const treeMat = own(new THREE.MeshBasicNodeMaterial({ color: 0x0d0a06 }));
    const trees = new THREE.InstancedMesh(coneGeo, treeMat, 46);
    trees.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    const q0 = new THREE.Quaternion();
    const sVec = new THREE.Vector3();
    const pVec = new THREE.Vector3();
    for (let i = 0; i < 46; i += 1) {
        const h = 9 + Math.random() * 14;
        const r = 2.8 + Math.random() * 2.6;
        pVec.set(-100 + (200 * i) / 45 + (Math.random() - 0.5) * 8, h * 0.5, -96 - (i % 2) * 12);
        sVec.set(r, h, r);
        m4.compose(pVec, q0, sVec);
        trees.setMatrixAt(i, m4);
    }
    trees.instanceMatrix.needsUpdate = true;
    root.add(trees);

    // Mist — instanced camera-facing fog cards at rising depths (one material, per-instance phase).
    const CARDS = 7;
    const cardGeo = own(new THREE.PlaneGeometry(150, 26, 1, 1));
    const phaseArr = new Float32Array(CARDS);
    const mist = new THREE.InstancedMesh(cardGeo, own(makeMistMaterial(uTime)), CARDS);
    mist.frustumCulled = false;
    mist.renderOrder = 5;
    for (let i = 0; i < CARDS; i += 1) {
        const z = -5 - i * 12; // -5 → -77, layering from near foreground into the valley
        pVec.set((Math.random() - 0.5) * 24, 4.5 + Math.random() * 2, z);
        sVec.set(1, 1, 1);
        m4.compose(pVec, q0, sVec); // faces +z (toward the camera) by default — no billboard needed
        mist.setMatrixAt(i, m4);
        phaseArr[i] = i * 1.7;
    }
    cardGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArr, 1));
    mist.instanceMatrix.needsUpdate = true;
    root.add(mist);

    return {
        camera(time, cam) {
            cam.position.set(5, 1.9, 13);
            cam.lookAt(-6, 5.2, -58);
            cam.fov = 54;
            cam.near = 0.1;
            cam.far = 6000;
            cam.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            uSeason.value = 0.12;
        },
        resize() {},
        dispose() {
            scene.remove(root);
            trees.dispose?.();
            mist.dispose?.();
            disposables.forEach((o) => o.dispose?.());
        },
    };
}
