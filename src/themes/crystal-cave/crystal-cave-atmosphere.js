/** Shared artwork: the playground and production theme render the same cave. */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraProjectionMatrix, cameraViewMatrix, exp, float, instanceIndex,
    instancedBufferAttribute, length, positionGeometry, sin, uv, vec3, vec4,
} from 'three/tsl';
import { seededRandom } from '../../utils/helpers.js';
import { createCrystalCaveScene } from './crystal-cave-scene.js';
import { createCrystalCaveMaterials, createCrystalCaveUniforms } from './crystal-cave-materials.js';
import { resolveCrystalCaveQuality } from './crystal-cave-quality.js';

export class CrystalCaveAtmosphere {
    constructor({ scene, camera, quality = 'High' }) {
        this.scene = scene;
        this.camera = camera;
        this.quality = resolveCrystalCaveQuality(quality);
        this.uniforms = createCrystalCaveUniforms();
        this.resources = createCrystalCaveMaterials({ scene, uniforms: this.uniforms, quality: this.quality.preset });
        this.art = createCrystalCaveScene({ scene, materials: this.resources.materials, quality: this.quality.preset });
        this.group = this.art.group;
        this.anchors = this.art.anchors;
        this.disposed = false;
        this.lights = new THREE.Group();
        const ambient = new THREE.HemisphereLight(0x90a9dc, 0x331548, 1.1);
        const cyan = new THREE.DirectionalLight(0x84ddf6, 1.65);
        cyan.position.set(16, 19, 14);
        const violet = new THREE.DirectionalLight(0xaf87f6, 1.25);
        violet.position.set(-18, 8, 10);
        const warm = new THREE.DirectionalLight(0xe9b28a, 0.65);
        warm.position.set(-8, 13, -50);
        this.lights.add(ambient, cyan, violet, warm);
        scene.add(this.lights);
        scene.fog = new THREE.FogExp2(0x101322, 0.008);
        this.createDust();
        this.prepareCamera(camera.aspect || 16 / 9);
    }

    createDust() {
        const count = this.quality.preset.dustCount;
        const rng = seededRandom(971);
        const centers = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
        }), count);
        const matrix = new THREE.Matrix4();
        const tint = new THREE.Color();
        for (let i = 0; i < count; i += 1) {
            centers.set([(rng() - 0.5) * 82, rng() * 32 - 5, 18 - rng() * 100], i * 3);
            sizes[i] = 0.035 + rng() ** 4 * 0.19;
            mesh.setMatrixAt(i, matrix);
            let hex = 0x69c9da;
            if (i % 3 === 0) hex = 0x9776d7;
            if (i % 4 === 0) hex = 0xe4b681;
            tint.setHex(hex);
            mesh.setColorAt(i, tint);
        }
        const center = instancedBufferAttribute(new THREE.InstancedBufferAttribute(centers, 3));
        const size = instancedBufferAttribute(new THREE.InstancedBufferAttribute(sizes, 1));
        const phase = float(instanceIndex).mul(2.39996);
        const t = this.uniforms.time;
        const drift = vec3(sin(t.mul(0.1).add(phase)).mul(0.85), sin(t.mul(0.16).add(phase)).mul(1.4), sin(t.mul(0.08).add(phase)).mul(0.55));
        mesh.material.vertexNode = Fn(() => {
            const view = cameraViewMatrix.mul(vec4(center.add(drift), 1));
            return cameraProjectionMatrix.mul(vec4(view.xyz.add(vec3(positionGeometry.xy.mul(size), 0)), 1));
        })();
        const dist = length(uv().sub(0.5).mul(2));
        mesh.material.colorNode = vec3(1.5);
        mesh.material.opacityNode = exp(dist.mul(dist).mul(-7)).mul(float(0.45)
            .add(sin(t.mul(0.55).add(phase)).mul(0.25))).mul(this.uniforms.energy.mul(0.35).add(1));
        mesh.material.name = 'Crystal Cave — drifting mineral dust';
        mesh.name = 'Crystal Cave — instanced dust';
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        this.dust = mesh;
        this.group.add(mesh);
    }

    prepareCamera(aspect) {
        if (!this.camera || !Number.isFinite(aspect) || aspect <= 0) return;
        const portrait = aspect < 0.9;
        this.camera.fov = portrait ? 68 : 55;
        this.camera.aspect = aspect;
        this.camera.near = 0.1;
        this.camera.far = 260;
        this.cameraDistance = Math.max(29, 19.5 / (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect));
        this.camera.position.set(0, portrait ? 5 : 4, this.cameraDistance);
        this.camera.lookAt(0, 2, -18);
        this.camera.updateProjectionMatrix();
    }

    update(time, dt = 0, pointer = { x: 0, y: 0 }) {
        if (!Number.isFinite(time) || !Number.isFinite(dt)) return;
        this.uniforms.time.value = time;
        // Small camera motion reveals facets without swaying the entire cavern.
        this.camera.position.x = Math.sin(time * 0.07) * 0.3 + pointer.x * 0.5;
        this.camera.position.y = (this.camera.aspect < 0.9 ? 5 : 4) + Math.sin(time * 0.09) * 0.15 - pointer.y * 0.25;
        this.camera.position.z = this.cameraDistance;
        this.camera.lookAt(this.camera.position.x * 0.15, 2, -18);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.dust.dispose();
        this.dust.geometry.dispose();
        this.dust.material.dispose();
        this.dust.removeFromParent();
        this.art.dispose();
        this.resources.dispose();
        this.lights.removeFromParent();
        this.scene.fog = null;
    }
}
