// ═══════════════════════════════════════════════════════════════════════════════
// Odyssey Ch3 "Surface World" — masterpiece rebuild, HERO element: golden-hour foliage.
//
// See docs/ODYSSEY_CH3_SURFACE_WORLD_REBUILD_PLAN.md (visual-upgrade-first). The chapter's
// mid-ground trees are flat MeshLambert cones; the upgrade is dimensional, BACKLIT trees whose
// canopies glow gold where the low sun (SURFACE_SUN_DIR) shines THROUGH the leaves — the
// golden-hour money shot — with a warm rim + cool sky fill for form, per-instance tint variation,
// and wind sway. ONE instanced foliage material (all canopy blobs = one draw) also advances the
// compile-monster consolidation goal (grass/flowers/trees → few instanced materials).
//
// Custom analytic MeshBasicNodeMaterial (not PBR + lights): the whole chapter is painterly/unlit
// analytic (its landscape does exactly this golden-hour raking-light shading), so this ports
// straight into createTreesTSL/createSpruceTreesTSL, replacing the Lambert path.
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three/webgpu';
import {
    uniform, attribute, positionLocal, normalWorld, positionWorld, cameraPosition,
    normalize, dot, clamp, pow, mix, vec3, float, sin, smoothstep, oneMinus, length,
} from 'three/tsl';
import {
    createSkyBackgroundTSL,
    SURFACE_SUN_DIR,
} from '../../rendering/odyssey/chapter-environments/surface-world.tsl.js';

export const meta = {
    id: 'surface-world-hero-trees',
    title: 'Surface World — Golden-hour foliage (Ch3 hero · backlit trees)',
    description: 'Ch3 hero: dimensional backlit trees whose canopies glow gold when the low sun shines through',
};

const SUN = new THREE.Vector3().copy(SURFACE_SUN_DIR);

// The one golden-hour foliage material — analytic key/fill/rim + backlit translucency glow, with
// per-instance albedo (aTint) and sway phase (aPhase). Reused for every canopy blob (one draw).
function makeFoliageMaterial(uTime) {
    const sunDir = vec3(SUN.x, SUN.y, SUN.z);
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const tint = attribute('aTint', 'vec3'); // per-instance green
    const phase = attribute('aPhase', 'float');

    // Soft WRAP diffuse (foliage has no hard terminator) warmed by the low sun + a cool sky fill
    // from above — gives the canopy dimensional form instead of flat Lambert shading.
    const wrap = dot(N, sunDir).mul(0.5).add(0.5);
    const key = vec3(1.0, 0.85, 0.55).mul(wrap.mul(0.95).add(0.06));
    const skyFill = vec3(0.42, 0.56, 0.8).mul(N.y.mul(0.5).add(0.5)).mul(0.32);
    let col = tint.mul(key.add(skyFill));

    // Subtle warm grazing rim on ALL edges — gilds the canopy against the sky, gives form.
    const edge = pow(oneMinus(clamp(dot(N, V), 0.0, 1.0)), float(2.2));
    col = col.add(vec3(1.0, 0.78, 0.42).mul(edge).mul(0.16));

    // ★ TRANSLUCENCY GLOW — the golden-hour hero, EDGE-WEIGHTED so the canopy CORE stays lush
    // green (dense leaves block the sun) while the thin backlit RIM ignites molten gold (thin
    // edges transmit it). Fires only where the view continues toward the sun (V aligns with
    // -sunDir → -dot(V,sunDir); +dot would fire on the dark lit front, wrong side when backlit).
    const towardSun = pow(clamp(dot(V, sunDir).negate(), 0.0, 1.0), float(1.8));
    const glow = towardSun.mul(edge);
    col = col.add(vec3(1.0, 0.76, 0.34).mul(glow).mul(2.0));

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = col;
    // Whole-canopy wind sway, phase-desynced per instance. positionLocal is post-instance in r181
    // (InstanceNode reassigns it before positionNode); a constant per-instance offset just sways
    // the instance — exactly what we want (the trunk is a separate, calmer mesh).
    const sway = sin(uTime.mul(1.2).add(phase)).mul(0.32);
    mat.positionNode = positionLocal.add(vec3(sway, float(0.0), sway.mul(0.4)));
    return mat;
}

function makeBarkMaterial() {
    const sunDir = vec3(SUN.x, SUN.y, SUN.z);
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const wrap = dot(N, sunDir).mul(0.5).add(0.5);
    let col = vec3(0.14, 0.09, 0.05).mul(wrap.mul(0.7).add(0.32));
    const rim = pow(oneMinus(clamp(dot(N, V), 0.0, 1.0)), float(3.0));
    col = col.add(vec3(1.0, 0.7, 0.35).mul(rim).mul(0.4));
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = col;
    return mat;
}

function makeGroundMaterial() {
    const sunDir = vec3(SUN.x, SUN.y, SUN.z);
    const N = normalize(normalWorld);
    const wrap = dot(N, sunDir).mul(0.5).add(0.5);
    const key = vec3(1.0, 0.86, 0.55).mul(wrap.mul(0.62).add(0.42));
    let col = vec3(0.2, 0.32, 0.13).mul(key); // sun-bleached sage meadow
    const d = length(cameraPosition.sub(positionWorld));
    col = mix(col, vec3(0.82, 0.68, 0.48), smoothstep(50.0, 250.0, d).mul(0.5)); // warm aerial haze
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

    // Graded golden-hour sky for context (its low sun aligns with SURFACE_SUN_DIR).
    const sky = createSkyBackgroundTSL(uTime, { uSeason });
    root.add(sky.mesh);

    // Ground.
    const groundGeo = own(new THREE.PlaneGeometry(300, 300, 1, 1));
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(groundGeo, own(makeGroundMaterial()));
    root.add(ground);

    // Hero trees (rule-of-thirds, mid-ground, backlit toward the sun). Each = tapered trunk + a
    // cluster of canopy blobs. All canopy blobs across all trees = ONE instanced draw.
    const trees = [
        {
            x: -14, z: -30, h: 12, s: 1.25, warm: 0.10,
        },
        {
            x: 16, z: -46, h: 10, s: 1.0, warm: -0.04,
        },
        {
            x: -4, z: -64, h: 9, s: 0.85, warm: 0.02,
        },
    ];

    // Trunks (one instanced draw).
    const trunkGeo = own(new THREE.CylinderGeometry(0.28, 0.55, 1, 7, 1));
    const trunks = new THREE.InstancedMesh(trunkGeo, own(makeBarkMaterial()), trees.length);
    trunks.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    const q0 = new THREE.Quaternion();
    const sVec = new THREE.Vector3();
    const pVec = new THREE.Vector3();
    trees.forEach((t, i) => {
        pVec.set(t.x, t.h * 0.5, t.z);
        sVec.set(t.s, t.h, t.s);
        m4.compose(pVec, q0, sVec);
        trunks.setMatrixAt(i, m4);
    });
    trunks.instanceMatrix.needsUpdate = true;
    root.add(trunks);

    // Canopy blobs — gather all, then build one InstancedMesh (exact count → no stray origin blobs).
    const blobs = [];
    trees.forEach((t) => {
        const crown = t.h * 0.86;
        const nBlobs = 6;
        for (let k = 0; k < nBlobs; k += 1) {
            const ang = (k / nBlobs) * Math.PI * 2 + Math.random();
            const rad = (0.6 + Math.random() * 1.1) * t.s;
            const bx = t.x + Math.cos(ang) * rad * 2.1;
            const bz = t.z + Math.sin(ang) * rad * 2.1;
            const by = crown + (Math.random() - 0.35) * t.h * 0.42;
            const br = (2.4 + Math.random() * 1.6) * t.s;
            // Per-instance green: lush spring green, warmed/cooled per tree + per blob jitter.
            const g = 0.30 + Math.random() * 0.12;
            blobs.push({
                pos: [bx, by, bz],
                scl: br,
                tint: [
                    0.16 + t.warm + Math.random() * 0.06,
                    g,
                    0.10 + Math.random() * 0.05,
                ],
                phase: Math.random() * Math.PI * 2,
            });
        }
    });

    const canopyGeo = own(new THREE.IcosahedronGeometry(1, 1));
    const count = blobs.length;
    const tintArr = new Float32Array(count * 3);
    const phaseArr = new Float32Array(count);
    blobs.forEach((b, i) => {
        tintArr[i * 3] = b.tint[0];
        tintArr[i * 3 + 1] = b.tint[1];
        tintArr[i * 3 + 2] = b.tint[2];
        phaseArr[i] = b.phase;
    });
    canopyGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tintArr, 3));
    canopyGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArr, 1));
    const canopy = new THREE.InstancedMesh(canopyGeo, own(makeFoliageMaterial(uTime)), count);
    canopy.frustumCulled = false;
    blobs.forEach((b, i) => {
        pVec.set(b.pos[0], b.pos[1], b.pos[2]);
        sVec.set(b.scl, b.scl * 1.05, b.scl);
        m4.compose(pVec, q0, sVec);
        canopy.setMatrixAt(i, m4);
    });
    canopy.instanceMatrix.needsUpdate = true;
    root.add(canopy);

    return {
        // Look INTO the low sun so the canopies are backlit and the translucency glow fires.
        camera(time, cam) {
            cam.position.set(26, 9, 26);
            cam.lookAt(-6, 11, -46);
            cam.fov = 46;
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
            trunks.dispose?.();
            canopy.dispose?.();
            disposables.forEach((o) => o.dispose?.());
        },
    };
}
