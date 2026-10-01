/* eslint-disable import/no-unresolved */
import * as THREE from 'three/webgpu';
import {
    abs, attribute as vertexAttribute, cameraPosition, dot, float, normalWorld, normalize, positionWorld, pow,
    smoothstep, uniform, vec3,
} from 'three/tsl';

const TAU = Math.PI * 2;
const animationStates = new WeakMap();

/**
 * Sample Blender's morph clip with a per-creature phase in radians. The returned
 * function reuses its Float32Array; consume/copy its values before sampling again.
 * Analytic motion is used only when the asset has no applicable morph track.
 */
export function createOceanMorphSampler(sourceMesh, clip = null) {
    const count = sourceMesh.geometry.morphAttributes.position?.length ?? 0;
    const dictionary = sourceMesh.morphTargetDictionary || {};
    const values = new Float32Array(count);
    const candidates = (clip?.tracks || []).map((track) => ({
        track,
        binding: THREE.PropertyBinding.parseTrackName(track.name),
    })).filter(({ binding }) => binding.propertyName === 'morphTargetInfluences');
    const matches = candidates.filter(({ binding }) => (
        binding.nodeName === sourceMesh.name || binding.nodeName === sourceMesh.uuid || !binding.nodeName
    ));
    let applicable = matches;
    if (matches.length === 0 && candidates.length === 1) applicable = candidates;
    const tracks = applicable.map(({ track, binding }) => {
        // GLTF cubic-spline tracks pack tangent/value/tangent triples. Their
        // interpolant's output width, unlike getValueSize(), is the morph count.
        const interpolant = track.createInterpolant();
        let index = null;
        if (binding.propertyIndex !== undefined) {
            index = dictionary[binding.propertyIndex] ?? Number(binding.propertyIndex);
            if (!Number.isInteger(index) || index < 0 || index >= count || interpolant.valueSize !== 1) return null;
        } else if (interpolant.valueSize !== count) return null;
        return {
            index, interpolant, start: track.times[0], end: track.times[track.times.length - 1],
        };
    }).filter(Boolean);
    const start = tracks.length > 0 ? Math.min(...tracks.map((track) => track.start)) : 0;
    const end = tracks.length > 0 ? Math.max(...tracks.map((track) => track.end)) : 4;
    const duration = Math.max(0.0001, end - start);
    const pulseIndex = dictionary.bellPulse;
    const swayIndex = dictionary.currentSway;
    const sample = (time, phase = 0) => {
        values.fill(0);
        if (tracks.length > 0) {
            const shifted = time + (phase / TAU) * duration;
            const localTime = start + (((shifted % duration) + duration) % duration);
            for (const { index, interpolant } of tracks) {
                const result = interpolant.evaluate(localTime);
                if (index === null) values.set(result);
                else values[index] = result[0];
            }
        } else {
            if (pulseIndex !== undefined) values[pulseIndex] = 0.5 + Math.sin(time * 1.8 + phase) * 0.5;
            if (swayIndex !== undefined) values[swayIndex] = Math.sin(time * 0.8 + phase);
        }
        return values;
    };
    sample.authored = tracks.length > 0;
    sample.duration = duration;
    sample.startTime = start;
    return sample;
}

// BufferGeometry.applyMatrix4 transforms base attributes only. Morph deltas must
// receive the linear transform without translation; transformed normal targets
// are reconstructed before subtracting the transformed base normal.
export function transformMorphGeometry(geometry, matrix) {
    const relative = geometry.morphTargetsRelative;
    const linear = new THREE.Matrix3().setFromMatrix4(matrix);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const baseNormals = geometry.attributes.normal;
    const base = new THREE.Vector3();
    const target = new THREE.Vector3();
    for (const attribute of geometry.morphAttributes.position || []) {
        if (relative) attribute.applyMatrix3(linear);
        else attribute.applyMatrix4(matrix);
    }
    for (const attribute of geometry.morphAttributes.normal || []) {
        if (!relative) {
            attribute.applyNormalMatrix(normalMatrix);
            continue;
        }
        for (let index = 0; index < attribute.count; index += 1) {
            base.fromBufferAttribute(baseNormals, index);
            target.fromBufferAttribute(attribute, index).add(base).applyNormalMatrix(normalMatrix);
            base.applyNormalMatrix(normalMatrix);
            target.sub(base);
            attribute.setXYZ(index, target.x, target.y, target.z);
        }
    }
    geometry.boundingBox = null;
    geometry.boundingSphere = null;
    geometry.applyMatrix4(matrix);
}

function cloneNormalizedGeometry(source) {
    const geometry = source.geometry.clone();
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    transformMorphGeometry(geometry, source.matrixWorld);
    const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const horizontalScale = 0.7 / Math.max(size.x, size.z, 0.0001);
    const verticalScale = 1 / Math.max(size.y, 0.0001);
    const normalization = new THREE.Matrix4().makeScale(horizontalScale, verticalScale, horizontalScale)
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
    transformMorphGeometry(geometry, normalization);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

function createModelMaterial(isWebGPU) {
    const MaterialClass = isWebGPU ? THREE.MeshStandardNodeMaterial : THREE.MeshStandardMaterial;
    const material = new MaterialClass({
        color: new THREE.Color().setRGB(0.72, 0.96, 0.90),
        vertexColors: true,
        transparent: true,
        opacity: 0.68,
        roughness: 0.62,
        metalness: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        forceSinglePass: true,
    });
    const uTime = isWebGPU ? uniform(0) : { value: 0 };
    const uGlowIntensity = isWebGPU ? uniform(0.8) : { value: 0.8 };
    if (isWebGPU) {
        const viewDirection = normalize(cameraPosition.sub(positionWorld));
        const rim = pow(float(1).sub(abs(dot(normalWorld, viewDirection))).clamp(0, 1), float(3));
        const bell = float(1).sub(smoothstep(float(0.48), float(0.68), vertexAttribute('color', 'vec4').a));
        material.emissiveNode = vec3(0.18, 0.58, 0.62).mul(rim.mul(bell).mul(0.12).add(0.007))
            .mul(float(0.8).add(uGlowIntensity.mul(0.2)));
    } else {
        material.emissive.setRGB(0.004, 0.017, 0.018);
    }
    material.name = 'Ocean Blender jellyfish translucent tissue';
    material.userData = { uTime, uGlowIntensity };
    return material;
}

/**
 * One instanced population; the GLTF remains caller-owned and unmodified.
 * Update on Ocean's existing jellyfish CPU phase. Dispose with the exported
 * helper (also available as mesh.userData.dispose) to release the morph texture.
 */
export function createOceanJellyfishModels(gltf, population, { isWebGPU = true } = {}) {
    const sources = [];
    gltf?.scene?.traverse((child) => {
        if (child.isMesh && child.geometry?.attributes.position) sources.push(child);
    });
    if (sources.length !== 1 || sources[0].isSkinnedMesh) {
        throw new TypeError('Ocean jellyfish requires one unskinned morph mesh.');
    }
    const source = sources[0];
    const dictionary = source.morphTargetDictionary || {};
    if (!source.geometry.morphAttributes.position?.length
        || dictionary.bellPulse === undefined || dictionary.currentSway === undefined) {
        throw new TypeError('Ocean jellyfish requires bellPulse and currentSway morph targets.');
    }
    const {
        count, positions, phases, sizes,
    } = population || {};
    if (!Number.isInteger(count) || count < 0 || positions?.length !== count * 3
        || phases?.length !== count || sizes?.length !== count) {
        throw new TypeError('Ocean jellyfish population buffers must match count.');
    }
    gltf.scene.updateWorldMatrix(true, true);
    const geometry = cloneNormalizedGeometry(source);
    const material = createModelMaterial(isWebGPU);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'OceanBlenderJellyfish';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.morphTargetDictionary = { ...dictionary };
    const influenceSource = {
        morphTargetInfluences: new Array(geometry.morphAttributes.position.length).fill(0),
    };
    // r186's count=1 branch needs a built uniform array. Larger populations
    // read morphTexture: exposing an ordinary array there creates an unused
    // UniformArrayNode that Morph.js updates before its buffer ever exists.
    if (count === 1) mesh.morphTargetInfluences = influenceSource.morphTargetInfluences;
    mesh.visible = count > 0;
    mesh.userData.isOceanJellyfishModel = true;
    mesh.userData.primitive = 'instanced-morph-model';
    mesh.userData.update = (time, glow) => updateOceanJellyfishModels(mesh, time, glow);
    mesh.userData.dispose = () => disposeOceanJellyfishModels(mesh);
    const clip = (gltf.animations || []).find((candidate) => (
        candidate.tracks.some((track) => track.name.includes('morphTargetInfluences'))
    ));
    const sampler = createOceanMorphSampler(source, clip);
    mesh.userData.authoredMorphAnimation = sampler.authored;
    animationStates.set(mesh, {
        population, sampler, dummy: new THREE.Object3D(), isWebGPU, influenceSource,
    });
    updateOceanJellyfishModels(mesh, 0, 0.8);

    // Keep a conservative static bound over all population positions, morph
    // displacement and drifting/rotating model extents instead of rebuilding it.
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    let maxSize = 0;
    for (let index = 0; index < count; index += 1) {
        bounds.expandByPoint(point.fromArray(positions, index * 3));
        maxSize = Math.max(maxSize, sizes[index]);
    }
    let morphReach = 0;
    const basePoint = new THREE.Vector3();
    for (const target of geometry.morphAttributes.position) {
        let reach = 0;
        for (let index = 0; index < target.count; index += 1) {
            point.fromBufferAttribute(target, index);
            if (!geometry.morphTargetsRelative) {
                point.sub(basePoint.fromBufferAttribute(geometry.attributes.position, index));
            }
            reach = Math.max(reach, point.length());
        }
        morphReach += reach;
    }
    if (count > 0) bounds.expandByScalar(maxSize * (geometry.boundingSphere.radius + morphReach) + 3.5);
    mesh.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
    return mesh;
}

export function updateOceanJellyfishModels(mesh, time, glow = 0.8) {
    const state = animationStates.get(mesh);
    if (!state) return;
    const {
        population: {
            positions, phases, sizes, count,
        }, sampler, dummy, isWebGPU, influenceSource,
    } = state;
    mesh.material.userData.uTime.value = time;
    mesh.material.userData.uGlowIntensity.value = glow;
    if (!isWebGPU) mesh.material.emissiveIntensity = 0.8 + glow * 0.2;
    for (let index = 0; index < count; index += 1) {
        const phase = phases[index];
        const offset = index * 3;
        dummy.position.set(
            positions[offset] + Math.sin(time * 0.18 + phase * 1.3) * 1.35,
            positions[offset + 1] + Math.sin(time * 0.38 + phase) * 2.2,
            positions[offset + 2] + Math.sin(time * 0.22 + phase * 0.8) * 1.1,
        );
        dummy.rotation.set(
            Math.sin(time * 0.28 + phase) * 0.1,
            phase * 0.35 + time * 0.04,
            Math.sin(time * 0.23 + phase * 1.2) * 0.09,
        );
        dummy.scale.setScalar(sizes[index] * (0.78 + glow * 0.025));
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        const weights = sampler(time, phase);
        for (let target = 0; target < weights.length; target += 1) {
            influenceSource.morphTargetInfluences[target] = weights[target];
        }
        mesh.setMorphAt(index, influenceSource);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
}

export function disposeOceanJellyfishModels(mesh) {
    if (!animationStates.has(mesh)) return;
    animationStates.delete(mesh);
    mesh.removeFromParent();
    mesh.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
}
