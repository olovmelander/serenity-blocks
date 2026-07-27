/* eslint-disable import/no-unresolved */
/**
 * Himalayan Peak AAA — Eagle
 *
 * A single golden eagle soaring deep in the valley. It's a real eagle
 * reconstructed from a photo with TRELLIS.2, auto-rigged with a hand-authored
 * flap cycle in Blender (skinned glTF, "Flap" clip): a deep beat where the wings
 * fold back on the upstroke, with a slight forward sweep, a body pump and a head
 * that counter-pitches to stay level.
 *
 * Rendered as a DARK, cool-toned silhouette with a warm alpenglow rim that tracks
 * the live sun — so it reads against the sky and sits inside the theme's palette
 * rather than fighting it. Flown far back among the receding ranges with a gentle
 * crossing flight (travel + altitude undulation + nose pitch + banking roll). One
 * drifts by every so often; an extra sweeps in on a big combo.
 *
 * See assets/ATTRIBUTION.md.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn, attribute, float, mix, normalView, uniform, vec3,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneHierarchy } from 'three/addons/utils/SkeletonUtils.js';
import eagleUrl from '../assets/eagle.glb?url';

const TARGET_SIZE = 18; // world units (largest dimension) — small, distant speck

// Dark cool silhouette + warm alpenglow rim. The body is nearly black with a
// faint cool-blue cast and a whisper of plumage variation (from the baked vertex
// luminance); grazing-angle edges pick up the live sun's warmth, so the bird
// glows along its backlit wingtips like the rest of the scene at golden hour.
function createEagleSilhouetteMaterial() {
    const uTint = uniform(new THREE.Color(0xffe9cf)); // live sun colour
    const uWarmth = uniform(0.4); // 0 cold..1 golden, driven by the director
    const m = new MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    m.colorNode = Fn(() => {
        const vc = attribute('color', 'vec4').rgb;
        const lum = vc.dot(vec3(0.3, 0.6, 0.1));
        const body = vec3(0.05, 0.05, 0.07).add(lum.mul(0.05)); // cool dark + faint detail
        const fres = float(1.0).sub(normalView.z.abs()).pow(3.0); // silhouette edges
        const rim = fres.mul(uWarmth);
        return mix(body, uTint.mul(0.6), rim);
    })();
    m.emissiveNode = vec3(0.0);
    m.userData.emitsBloom = false;
    return { material: m, uTint, uWarmth };
}

export function createPeakEagles(opts = {}) {
    const group = new THREE.Group();
    group.frustumCulled = false;
    const maxEagles = Math.max(1, opts.maxEagles ?? 2);

    let variant = null;
    let sharedMaterial = null;
    let matUniforms = null;
    let disposed = false;
    const active = [];
    let nextSpawnIn = 2 + Math.random() * 4;
    let comboCooldown = 0;

    const loader = new GLTFLoader();
    const _q = new THREE.Quaternion();
    const _fwd = new THREE.Vector3();
    const _box = new THREE.Box3();
    const _size = new THREE.Vector3();

    const disposeHierarchy = (root) => {
        root?.traverse?.((child) => {
            child.geometry?.dispose?.();
            const materials = Array.isArray(child.material)
                ? child.material
                : [child.material];
            materials.filter(Boolean).forEach((material) => material.dispose?.());
        });
        root?.clear?.();
    };

    async function load() {
        try {
            const gltf = await loader.loadAsync(eagleUrl);
            const root = gltf.scene;
            if (disposed) {
                disposeHierarchy(root);
                return;
            }
            _box.setFromObject(root);
            _box.getSize(_size);
            const scale = TARGET_SIZE / (Math.max(_size.x, _size.y, _size.z) || 1);
            const { material, uTint, uWarmth } = createEagleSilhouetteMaterial();
            sharedMaterial = material;
            matUniforms = { uTint, uWarmth };
            root.traverse((o) => {
                if (o.isMesh) {
                    const old = Array.isArray(o.material) ? o.material : [o.material];
                    old.forEach((mm) => mm?.dispose && mm.dispose());
                    o.material = material;
                    o.frustumCulled = false;
                }
            });
            variant = {
                scene: root,
                clip: gltf.animations?.[0] || null,
                scale,
                forward: new THREE.Vector3(0, 0, 1),
            };
        } catch (e) {
            if (!disposed) {
                console.warn('[HimalayanPeak] eagle load failed:', e);
            }
        }
    }

    function spawn() {
        if (disposed || !variant || active.length >= maxEagles) return;

        const model = cloneHierarchy(variant.scene);
        let mixer = null;
        if (variant.clip) {
            mixer = new THREE.AnimationMixer(model);
            const action = mixer.clipAction(variant.clip);
            action.timeScale = 0.6 + Math.random() * 0.3; // unhurried wingbeat
            action.play();
        }
        model.scale.setScalar(variant.scale);
        model.frustumCulled = false;

        const pivot = new THREE.Group();
        pivot.add(model);

        const side = Math.random() > 0.5 ? 1 : -1;
        const baseY = 240 + Math.random() * 170;
        // Far back among the receding ranges (which fall to ~-1000u) so it reads as
        // a distant speck soaring deep inside the landscape.
        const z = -760 - Math.random() * 460;
        pivot.position.set(side * 1300, baseY, z);

        const speed = 55 + Math.random() * 45; // slow, gliding cross of the valley
        const vel = new THREE.Vector3(-side * speed, 0, (Math.random() - 0.5) * speed * 0.22);

        group.add(pivot);
        active.push({
            pivot,
            mixer,
            forward: variant.forward,
            vel,
            speed,
            age: 0,
            life: 60,
            baseY,
            bobPhase: Math.random() * 6.28,
            rollPhase: Math.random() * 6.28,
        });
    }

    function update(dt, time, scatter = 0, sunColor = null, warmth = 0) {
        if (disposed) return;
        if (!variant) return;

        // Keep the silhouette's warm rim in step with the live alpenglow.
        if (matUniforms) {
            if (sunColor) matUniforms.uTint.value.copy(sunColor);
            matUniforms.uWarmth.value = 0.3 + warmth * 0.6;
        }

        comboCooldown = Math.max(0, comboCooldown - dt);
        nextSpawnIn -= dt;
        if (nextSpawnIn <= 0) {
            spawn();
            nextSpawnIn = 11 + Math.random() * 14;
        }
        if (scatter > 0.55 && comboCooldown <= 0) {
            spawn();
            comboCooldown = 6;
        }

        for (let i = active.length - 1; i >= 0; i -= 1) {
            const e = active[i];
            e.age += dt;
            if (e.mixer) e.mixer.update(dt);

            e.pivot.position.x += e.vel.x * dt;
            e.pivot.position.z += e.vel.z * dt;
            const climb = Math.cos(time * 0.5 + e.bobPhase);
            e.pivot.position.y = e.baseY
                + Math.sin(time * 0.5 + e.bobPhase) * 16
                + Math.sin(time * 0.23 + e.bobPhase * 1.7) * 7;

            _fwd.set(e.vel.x, climb * e.speed * 0.16, e.vel.z).normalize();
            _q.setFromUnitVectors(e.forward, _fwd);
            e.pivot.quaternion.copy(_q);
            e.pivot.rotateZ(Math.sin(time * 0.6 + e.rollPhase) * 0.18);

            if (Math.abs(e.pivot.position.x) > 1400 || e.age > e.life) {
                if (e.mixer) e.mixer.stopAllAction();
                group.remove(e.pivot);
                active.splice(i, 1);
            }
        }
    }

    return {
        group,
        load,
        spawn,
        update,
        dispose() {
            if (disposed) return;
            disposed = true;
            active.forEach((e) => {
                if (e.mixer) e.mixer.stopAllAction();
                group.remove(e.pivot);
            });
            active.length = 0;
            if (variant) {
                disposeHierarchy(variant.scene);
                variant = null;
            }
            sharedMaterial?.dispose();
            sharedMaterial = null;
            matUniforms = null;
            group.clear();
        },
    };
}
