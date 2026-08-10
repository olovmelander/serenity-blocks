// ═══════════════════════════════════════════════════════════════════════════════
// Odyssey Ch3 "Surface World" — masterpiece rebuild, HERO element + CONSOLIDATION KEYSTONE:
// the golden-hour meadow.
//
// See docs/ODYSSEY_CH3_SURFACE_WORLD_REBUILD_PLAN.md. This proves the plan's biggest compile-monster
// fix: ONE instanced material renders BOTH grass blades AND wildflowers (per-instance aType selects
// the fragment shape + palette), replacing the chapter's separate grass×2 + flowers×2 builders
// (4 materials → 1 draw). Visually it's a lush wind-swept meadow whose blade tips + petals ignite
// gold when the low sun (SURFACE_SUN_DIR) backlights them — the same golden-hour translucency as
// the hero trees. Custom analytic MeshBasicNodeMaterial (alpha-tested billboards) → ports straight
// into createFluffyGrassTSL / createWildflowersTSL / createMeadowFlowersTSL.
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three/webgpu';
import {
    uniform, attribute, uv, positionLocal, positionGeometry, positionWorld, cameraPosition,
    normalize, dot, clamp, pow, mix, max, abs, length, vec2, vec3, float, sin, cos, atan,
    smoothstep, oneMinus,
} from 'three/tsl';
import {
    createSkyBackgroundTSL,
    SURFACE_SUN_DIR,
} from '../../rendering/odyssey/chapter-environments/surface-world.tsl.js';

export const meta = {
    id: 'surface-world-hero-meadow',
    title: 'Surface World — Golden-hour meadow (Ch3 hero · grass+flowers, ONE material)',
    description: 'Ch3 consolidation keystone: grass + wildflowers from ONE instanced material, backlit gold',
};

const SUN = new THREE.Vector3().copy(SURFACE_SUN_DIR);

// Bright wildflower petal palette — colour pops against the sage meadow + golden light.
const PETALS = [
    [0.9, 0.86, 0.72], // cream
    [1.0, 0.86, 0.32], // buttercup yellow
    [0.96, 0.52, 0.62], // pink
    [0.72, 0.6, 0.92], // lavender
    [0.98, 0.5, 0.28], // poppy orange
];

// The ONE meadow material — grass blade OR flower per instance (aType), backlit golden-hour glow.
function makeMeadowMaterial(uTime) {
    const sunDir = vec3(SUN.x, SUN.y, SUN.z);
    const vUv = uv();
    const aType = attribute('aType', 'float'); // 0 = grass, 1 = flower
    const aTint = attribute('aTint', 'vec3'); // grass green OR flower petal colour
    const aPhase = attribute('aPhase', 'float');

    // ── Fragment SHAPE (alpha) — one quad, two silhouettes selected by aType ──
    // Grass: a gently tapered blade, wide soft base → thin tip (a touch wider than a spike so the
    // field reads as a soft mass, not a bed of needles).
    const halfW = mix(float(0.17), float(0.012), pow(vUv.y, float(0.85)));
    const blade = oneMinus(smoothstep(halfW.sub(0.03), halfW, abs(vUv.x.sub(0.5))));
    // Flower: a thin stem (lower) + a real 5-petal daisy head (upper), not a round blob.
    const stem = oneMinus(smoothstep(0.018, 0.04, abs(vUv.x.sub(0.5))))
        .mul(oneMinus(smoothstep(0.60, 0.68, vUv.y)));
    const c = vUv.sub(vec2(0.5, 0.82));
    const ang = atan(c.y, c.x);
    const rad = length(c);
    // 5 scalloped petals: the petal radius swells + pinches around the ring.
    const petalR = float(0.11).mul(cos(ang.mul(5.0)).mul(0.30).add(0.70));
    const head = oneMinus(smoothstep(petalR.sub(0.02), petalR, rad));
    const disc = oneMinus(smoothstep(0.022, 0.05, rad)); // bright pollen centre
    const flowerMask = max(stem, head);
    const mask = mix(blade, flowerMask, aType);

    // ── Colour ──
    // Grass: darker base → brighter, warmer tip (uv.y).
    const grassCol = aTint.mul(mix(float(0.6), float(1.22), vUv.y));
    // Flower: green stem → aTint petals → warm-gold pollen disc centre.
    const petalCol = mix(aTint, vec3(1.0, 0.86, 0.36), disc);
    const flowerCol = mix(vec3(0.2, 0.4, 0.15), petalCol, head);
    let col = mix(grassCol, flowerCol, aType);

    // Backlit golden-hour glow — blade tips + petals ignite when the view continues toward the sun
    // (-dot(V,sunDir)); weighted to the tips (uv.y) where the foliage is thin (same model as the
    // hero trees). This is the meadow money shot: a field of glowing gold tips against the low sun.
    const V = normalize(cameraPosition.sub(positionWorld));
    const towardSun = clamp(dot(V, sunDir).negate(), 0.0, 1.0);
    // Glow strong on grass tips, muted on flower heads (mix→0.3 by aType) so the petal COLOUR
    // reads instead of blowing white.
    const tipGlow = pow(vUv.y, float(1.8)).mul(towardSun).mul(mix(float(1.0), float(0.3), aType));
    col = col.add(vec3(1.0, 0.82, 0.42).mul(tipGlow).mul(0.95));
    col = col.mul(vec3(1.06, 1.0, 0.88)); // warm ambient

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = col;
    mat.opacityNode = mask;
    mat.alphaTest = 0.5; // crisp alpha-tested billboards → proper depth, no sort artifacts
    mat.side = THREE.DoubleSide;

    // Wind sway — tip-weighted (positionGeometry.y is the un-instanced height 0..1; r181 requires
    // positionGeometry, NOT positionLocal, for instanced local-space masks). One wind direction.
    const heightMask = positionGeometry.y;
    const sway = sin(uTime.mul(1.4).add(aPhase)).mul(0.16).mul(heightMask);
    mat.positionNode = positionLocal.add(vec3(sway, float(0.0), sway.mul(0.5)));
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

    // ── The meadow: ONE instanced draw, grass + flowers ──
    const COUNT = 8000;
    const bladeGeo = own(new THREE.PlaneGeometry(1, 1, 1, 1));
    bladeGeo.translate(0, 0.5, 0); // pivot at the base → grows up from the ground

    const tintArr = new Float32Array(COUNT * 3);
    const typeArr = new Float32Array(COUNT);
    const phaseArr = new Float32Array(COUNT);
    const mesh = new THREE.InstancedMesh(bladeGeo, own(makeMeadowMaterial(uTime)), COUNT);
    mesh.frustumCulled = false;

    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const yUp = new THREE.Vector3(0, 1, 0);
    const sVec = new THREE.Vector3();
    const pVec = new THREE.Vector3();

    // Flower DRIFTS — blooms cluster into a handful of intentional colour events (one petal colour
    // per drift), NOT a uniform sprinkle. This is the "less clutter, more intentional" read: the eye
    // sees a few saturated patches of colour on a clean sage meadow instead of confetti.
    const DRIFTS = [];
    for (let d = 0; d < 7; d += 1) {
        DRIFTS.push({
            x: (Math.random() - 0.5) * 78,
            z: 4 - Math.random() * Math.random() * 92,
            r: 5 + Math.random() * 9,
            petal: PETALS[(Math.random() * PETALS.length) | 0],
        });
    }

    for (let i = 0; i < COUNT; i += 1) {
        const isFlower = Math.random() < 0.085;
        let x; let z; let petal = null;
        if (isFlower) {
            // Poisson-ish disc scatter around one drift centre (sqrt → uniform area density).
            const drift = DRIFTS[(Math.random() * DRIFTS.length) | 0];
            const a = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random()) * drift.r;
            x = drift.x + Math.cos(a) * rr;
            z = drift.z + Math.sin(a) * rr;
            ({ petal } = drift);
        } else {
            // Grass: wide swath, denser near, thinning to the horizon.
            x = (Math.random() - 0.5) * 95;
            z = 8 - Math.random() * Math.random() * 115;
        }
        const s = isFlower ? 1.0 + Math.random() * 0.6 : 0.7 + Math.random() * 1.1;
        quat.setFromAxisAngle(yUp, Math.random() * Math.PI * 2);
        pVec.set(x, 0, z);
        sVec.set(s * (isFlower ? 0.55 : 0.4), s, 1);
        m4.compose(pVec, quat, sVec);
        mesh.setMatrixAt(i, m4);

        typeArr[i] = isFlower ? 1 : 0;
        phaseArr[i] = Math.random() * Math.PI * 2;
        if (isFlower) {
            // Slight per-bloom variation around the drift's colour so a patch reads as one species.
            tintArr[i * 3] = Math.min(1, petal[0] + (Math.random() - 0.5) * 0.08);
            tintArr[i * 3 + 1] = Math.min(1, petal[1] + (Math.random() - 0.5) * 0.08);
            tintArr[i * 3 + 2] = Math.min(1, petal[2] + (Math.random() - 0.5) * 0.08);
        } else {
            tintArr[i * 3] = 0.14 + Math.random() * 0.08; // sage → lush green variation
            tintArr[i * 3 + 1] = 0.28 + Math.random() * 0.16;
            tintArr[i * 3 + 2] = 0.09 + Math.random() * 0.06;
        }
    }
    bladeGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tintArr, 3));
    bladeGeo.setAttribute('aType', new THREE.InstancedBufferAttribute(typeArr, 1));
    bladeGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArr, 1));
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);

    return {
        // Low, down in the grass, looking across the meadow INTO the low sun → backlit glowing tips.
        camera(time, cam) {
            cam.position.set(3, 0.65, 14);
            cam.lookAt(-5, 1.0, -30);
            cam.fov = 52;
            cam.near = 0.05;
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
            mesh.dispose?.();
            disposables.forEach((o) => o.dispose?.());
        },
    };
}
