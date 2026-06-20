/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter 2 Deep Ocean — GLB hero manta & whale.
 *
 * Loads the pipeline-authored manta & whale GLBs (shared/chapter-02-creature-assets.js),
 * replaces their materials with a TSL bioluminescent silhouette (dark charcoal-indigo
 * body + electric-cyan/teal VENTRAL rim), ticks their baked animations, and choreographs
 * them along the chapter corridor.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    float,
    mix,
    normalView,
    normalWorld,
    oneMinus,
    pow,
    sin,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import { loadOdysseyGltfCached } from './shared/odyssey-gltf-loader.js';
import {
    getChapter2CreatureAssetById,
    hasChapter2CreatureAssets,
} from './shared/chapter-02-creature-assets.js';

// The pass stations along the chapter (0..1 ascent).
const MANTA_PASS_T = 0.52;
const WHALE_PASS_T = 0.40; // nearer the manta region so the climb meets both in the mid-chapter
const ESCORT_LATERAL = 36; // formation-hold offset (u) beside the corridor

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();
// Head axis in model space. Both GLBs are rigged with the head at canonical -Y (Blender)
// which export_yup maps to +Z in glTF/three space — and whale-glide.glb is the same mesh —
// so BOTH creatures lead with +Z. (If a creature ever visibly swims tail-first, flip this
// one axis to (0, 0, -1).)
const _baseFwd = new THREE.Vector3(0, 0, 1);
// The whale GLB's head faces the opposite way from the manta's (verified in-game: it swam
// tail-first at +Z), so it leads with -Z.
const _whaleBaseFwd = new THREE.Vector3(0, 0, -1);

function smoothstep01(edge0, edge1, x) {
    const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * Bioluminescent silhouette material for the GLB manta.
 */
function createMantaBioluminescentMaterial(uniforms) {
    const uOpacity = uniforms.uOpacity ?? uniform(1);
    const uDepth = uniforms.uDepth ?? uniform(0);
    const uEscort = uniforms.uEscort ?? uniform(0);

    const bioCyan = vec3(0.18, 0.94, 1.0); // #2ef0ff bio key
    const bodyDeep = vec3(0.015, 0.045, 0.085); // dark charcoal-indigo
    const bodyLit = vec3(0.04, 0.11, 0.18);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.colorNode = Fn(() => {
        const vc = attribute('color', 'vec4').rgb;
        const lum = vc.dot(vec3(0.3, 0.6, 0.1));
        const body = mix(bodyDeep, bodyLit, lum);
        const fres = pow(oneMinus(abs(normalView.z)), 2.4);
        const ventral = clamp(normalWorld.y.negate().mul(0.5).add(0.55), float(0.0), float(1.0));
        const rim = clamp(fres.mul(ventral).mul(uEscort.mul(0.6).add(0.85)), float(0.0), float(1.0));
        return mix(body, bioCyan, rim);
    })();

    const surfaceFade = oneMinus(smoothstep(0.72, 0.9, uDepth));
    material.opacityNode = surfaceFade.mul(uOpacity).mul(0.96);
    material.transparent = true;
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
    material.fog = true;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity };
    return material;
}

/**
 * Bioluminescent silhouette material for the GLB whale with slow breathing pulse.
 */
function createWhaleBioluminescentMaterial(uniforms) {
    const uOpacity = uniforms.uOpacity ?? uniform(1);
    const uDepth = uniforms.uDepth ?? uniform(0);

    const bioCyan = vec3(0.12, 0.82, 0.95); // cyan-teal bioluminescent key
    const bodyDeep = vec3(0.01, 0.03, 0.065); // extra deep dark body
    const bodyLit = vec3(0.03, 0.085, 0.16);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.colorNode = Fn(() => {
        const vc = attribute('color', 'vec4').rgb;
        const lum = vc.dot(vec3(0.3, 0.6, 0.1));
        const body = mix(bodyDeep, bodyLit, lum);
        const fres = pow(oneMinus(abs(normalView.z)), 3.0);
        const ventral = clamp(normalWorld.y.negate().mul(0.4).add(0.6), float(0.0), float(1.0));
        
        // Slow pulsing bioluminescence (5-second period)
        const pulse = sin(uniforms.uTime.mul(1.2)).mul(0.15).add(0.85);
        const rim = clamp(fres.mul(ventral).mul(pulse), float(0.0), float(1.0));
        return mix(body, bioCyan, rim);
    })();

    const surfaceFade = oneMinus(smoothstep(0.72, 0.9, uDepth));
    material.opacityNode = surfaceFade.mul(uOpacity).mul(0.96);
    material.transparent = true;
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
    material.fog = true;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity };
    return material;
}

async function loadCreature(group, uniforms, corridor, record, role) {
    let gltf;
    try {
        gltf = await loadOdysseyGltfCached(record.url);
    } catch (err) {
        console.warn(`[DeepOcean] ${role} GLB load failed:`, err);
        return;
    }

    const model = gltf.scene;
    model.name = `deep-ocean-${role}-model`;
    
    _box.setFromObject(model);
    _box.getSize(_size);
    const scale = (record.targetSize ?? 28) / (Math.max(_size.x, _size.y, _size.z) || 1);
    model.scale.setScalar(scale);

    const material = role === 'whale' 
        ? createWhaleBioluminescentMaterial(uniforms)
        : createMantaBioluminescentMaterial(uniforms);
        
    model.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
        child.material = material;
    });

    const root = new THREE.Group();
    root.name = `deep-ocean-${role}`;
    root.add(model);

    const seatT = role === 'whale' ? WHALE_PASS_T : MANTA_PASS_T;
    const seat = corridor?.ok
        ? corridor.sample(seatT, 6)
        : { x: 0, y: role === 'whale' ? -5 : 2, z: -34 };
    root.userData.seat = seat;
    root.userData.phase = role === 'whale' ? 3.14 : 0.0;
    root.userData.role = role;
    group.add(root);

    let mixer = null;
    if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach((clip) => {
            const action = mixer.clipAction(clip);
            action.timeScale = role === 'whale' ? 0.45 : 0.65; // whale moves slower and more majestically
            action.play();
        });
        group.userData.mantaMixers.push(mixer);
    }

    group.userData.mantaFlights.push({ root, model, mixer, seat: root.userData.seat, phase: root.userData.phase, role });
}

/**
 * Load deep ocean creatures (manta & whale), apply materials, and seat them.
 */
export async function loadDeepOceanMantas(group, uniforms, corridor) {
    if (!hasChapter2CreatureAssets()) return;
    
    group.userData.mantaFlights = group.userData.mantaFlights || [];
    group.userData.mantaMixers = group.userData.mantaMixers || [];

    // Load Manta
    const mantaRecord = getChapter2CreatureAssetById('manta-glide');
    if (mantaRecord?.url) {
        await loadCreature(group, uniforms, corridor, mantaRecord, 'manta');
    }

    // Load Whale
    const whaleRecord = getChapter2CreatureAssetById('whale-glide');
    if (whaleRecord?.url) {
        await loadCreature(group, uniforms, corridor, whaleRecord, 'whale');
    }
}

/**
 * Per-frame creature choreography: drive paths along spline, banking, and companion holds.
 */
export function updateDeepOceanMantas(group, delta, time) {
    const flights = group.userData.mantaFlights;
    if (!flights || flights.length === 0) return;
    const { uniforms } = group.userData;
    const depth = uniforms?.uDepth?.value ?? 0;

    // Escort window for manta (camera progress 0.46 -> 0.52 -> stays -> 0.68 -> 0.76)
    // Extended to prevent sudden lateral drifting while the camera is still close/passing.
    const escort = smoothstep01(0.46, 0.52, depth) * (1 - smoothstep01(0.68, 0.76, depth));
    if (uniforms?.uEscort) uniforms.uEscort.value = escort;

    // Companion window for whale (camera progress 0.22 -> 0.30 -> stays -> 0.46 -> 0.54)
    // Extended to prevent sudden lateral drifting while the camera is still close/passing.
    const whaleWindow = smoothstep01(0.22, 0.30, depth) * (1 - smoothstep01(0.46, 0.54, depth));

    const mixers = group.userData.mantaMixers || [];
    for (let i = 0; i < mixers.length; i += 1) mixers[i].update(delta);

    const eps = 0.05;
    
    // A wide, slow horizontal ellipse GLIDE around a centre beside the corridor. The large
    // radii + steady angular speed make the velocity DOMINANT and well-defined, so the head
    // (baseFwd) leads cleanly every frame. The previous tiny hover-weave produced a near-zero,
    // jittery finite-diff velocity → essentially random facing (the "not swimming right" bug).
    const posAtManta = (seat, phase, t) => {
        const w = 0.14;                          // ~45 s per loop — unhurried glide
        const a = t * w + phase;
        const cx = seat.x + ESCORT_LATERAL;      // circle beside the camera
        const cz = seat.z - 18;
        return {
            x: cx + Math.cos(a) * 30,
            y: seat.y + Math.sin(t * 0.5 + phase) * 2.5,   // gentle vertical bob
            z: cz + Math.sin(a) * 24,
        };
    };

    const posAtWhale = (seat, phase, t) => {
        const w = 0.085;                         // ~74 s per loop — slow & majestic
        const a = t * w + phase;
        const cx = seat.x - 30;                  // opposite side from the manta, but in-sightline
        const cz = seat.z - 22;
        return {
            x: cx + Math.cos(a) * 30,
            y: seat.y - 10 + Math.sin(t * 0.32 + phase) * 3,   // only slightly deeper, so it reads
            z: cz + Math.sin(a) * 26,
        };
    };

    for (let i = 0; i < flights.length; i += 1) {
        const f = flights[i];
        const { root, seat, phase, role } = f;
        if (!root) continue;
        
        const isWhale = role === 'whale';
        const p = isWhale ? posAtWhale(seat, phase, time) : posAtManta(seat, phase, time);
        root.position.set(p.x, p.y, p.z);
        
        const pAhead = isWhale ? posAtWhale(seat, phase, time + eps) : posAtManta(seat, phase, time + eps);
        _fwd.set(pAhead.x - p.x, pAhead.y - p.y, pAhead.z - p.z);
        if (_fwd.lengthSq() > 1e-6) {
            _fwd.normalize();
            const baseFwd = isWhale ? _whaleBaseFwd : _baseFwd;
            _q.setFromUnitVectors(baseFwd, _fwd);
            root.quaternion.copy(_q);
        }
        
        const activeWindow = isWhale ? whaleWindow : escort;
        const bankAmp = isWhale ? 0.12 : 0.4;
        const bank = Math.cos(time * (isWhale ? 0.1 : 0.16) + phase) * bankAmp * (1 - activeWindow * 0.7);
        root.rotateZ(bank);
    }
}

export default { loadDeepOceanMantas, updateDeepOceanMantas };
