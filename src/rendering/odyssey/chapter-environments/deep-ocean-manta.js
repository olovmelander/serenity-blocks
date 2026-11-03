/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter 2 Deep Ocean diorama — the GLB whale on the recovery path.
 *
 * Only the ADR-0015 recovery path builds this diorama (`?odysseyOneWorld=0` or a world-build
 * failure); the One World never does. It loads the humpback (humpback-swim.glb, through
 * shared/chapter-02-creature-assets.js), gives it a TSL bioluminescent silhouette (a dark
 * charcoal-indigo body with a cyan-teal VENTRAL rim), ticks its keyed stroke and swims it on a
 * slow loop beside the corridor.
 *
 * The hero manta GLB that used to swim here too (manta-glide.glb, a photo-to-3D mesh whose wings
 * curled down with two lumps hanging below) was removed on 2026-11-03 (owner's call). The
 * diorama's billboard manta trio (deep-ocean.js, createCreatureSilhouettes) carries the mantas.
 * The exported names keep "manta" for the chapter's and the playground's hooks.
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

// The whale's station along the chapter (0..1 ascent).
const WHALE_PASS_T = 0.40;

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();
// The humpback (humpback-swim.glb, as the whale pass swims it) leads with -Z.
const _whaleBaseFwd = new THREE.Vector3(0, 0, -1);

function smoothstep01(edge0, edge1, x) {
    const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
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
    // The seat (a random angle round the corridor) is drawn before the load, while the chapter
    // is built, not when the GLB lands: a build whose randomness is seeded (the playground's
    // captures) then seats the creature the same way every time.
    const seat = corridor?.ok
        ? corridor.sample(WHALE_PASS_T, 6)
        : { x: 0, y: -5, z: -34 };
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

    const material = createWhaleBioluminescentMaterial(uniforms);

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

    root.userData.seat = seat;
    root.userData.phase = 3.14;
    root.userData.role = role;
    group.add(root);

    let mixer = null;
    if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach((clip) => {
            const action = mixer.clipAction(clip);
            action.timeScale = 0.45; // slow and majestic
            action.play();
        });
        group.userData.mantaMixers.push(mixer);
    }

    group.userData.mantaFlights.push({
        root, model, mixer, seat: root.userData.seat, phase: root.userData.phase, role,
    });
}

/**
 * Load the diorama's GLB creature (the humpback), apply its material, and seat it.
 */
export async function loadDeepOceanMantas(group, uniforms, corridor) {
    if (!hasChapter2CreatureAssets()) return;

    group.userData.mantaFlights = group.userData.mantaFlights || [];
    group.userData.mantaMixers = group.userData.mantaMixers || [];

    const whaleRecord = getChapter2CreatureAssetById('humpback-swim');
    if (whaleRecord?.url) await loadCreature(group, uniforms, corridor, whaleRecord, 'whale');
}

/**
 * Per-frame choreography: swim the whale on its loop, heading along its path, banking gently.
 */
export function updateDeepOceanMantas(group, delta, time) {
    const flights = group.userData.mantaFlights;
    if (!flights || flights.length === 0) return;
    const { uniforms } = group.userData;
    const depth = uniforms?.uDepth?.value ?? 0;

    // Companion window for the whale (camera progress 0.22 -> 0.30 -> stays -> 0.46 -> 0.54):
    // its bank settles while the camera is close.
    const whaleWindow = smoothstep01(0.22, 0.30, depth) * (1 - smoothstep01(0.46, 0.54, depth));

    const mixers = group.userData.mantaMixers || [];
    for (let i = 0; i < mixers.length; i += 1) mixers[i].update(delta);

    const eps = 0.05;

    // A wide, slow horizontal ellipse GLIDE around a centre beside the corridor. The large
    // radii + steady angular speed make the velocity DOMINANT and well-defined, so the head
    // leads cleanly every frame.
    const posAtWhale = (seat, phase, t) => {
        const w = 0.085; // ~74 s per loop — slow & majestic
        const a = t * w + phase;
        const cx = seat.x - 30;
        const cz = seat.z - 22;
        return {
            x: cx + Math.cos(a) * 30,
            y: seat.y - 10 + Math.sin(t * 0.32 + phase) * 3, // only slightly deeper, so it reads
            z: cz + Math.sin(a) * 26,
        };
    };

    for (let i = 0; i < flights.length; i += 1) {
        const { root, seat, phase } = flights[i];
        if (!root) continue;

        const p = posAtWhale(seat, phase, time);
        root.position.set(p.x, p.y, p.z);

        const pAhead = posAtWhale(seat, phase, time + eps);
        _fwd.set(pAhead.x - p.x, pAhead.y - p.y, pAhead.z - p.z);
        if (_fwd.lengthSq() > 1e-6) {
            _fwd.normalize();
            _q.setFromUnitVectors(_whaleBaseFwd, _fwd);
            root.quaternion.copy(_q);
        }

        const bank = Math.cos(time * 0.1 + phase) * 0.12 * (1 - whaleWindow * 0.7);
        root.rotateZ(bank);
    }
}

export default { loadDeepOceanMantas, updateDeepOceanMantas };
