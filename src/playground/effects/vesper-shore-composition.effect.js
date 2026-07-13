/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Vesper Chrysalis — isolated shore-composition study.
 *
 * Keeps only the lake plane, small rock islands, and their rooted crystal groups
 * so silhouette, spacing, and water gaps can be judged without the full hero scene.
 * Once verified, the same layout is ported to vesper-chrysalis.effect.js.
 */
import * as THREE from 'three/webgpu';
import {
    abs, attribute, cameraPosition, clamp, dot, float, mix, normalWorld,
    normalize, positionGeometry, positionLocal, positionWorld, pow, sin,
    smoothstep, uniform, vec3,
} from 'three/tsl';

export const meta = {
    id: 'vesper-shore-composition',
    title: 'Vesper Chrysalis (shore composition)',
    description: 'Isolated crystal-island silhouette and spacing study.',
};

const SHORE_ISLANDS = [
    {
        x: -55, z: -58, rx: 18.5, rz: 11.5, crown: 5.0, rotation: -0.10, seed: 1207,
    },
    {
        x: -78, z: -88, rx: 12.5, rz: 7.5, crown: 3.4, rotation: 0.18, seed: 2333,
    },
    {
        x: -49, z: -113, rx: 9, rz: 5.5, crown: 2.7, rotation: -0.22, seed: 3469,
    },
    {
        x: 47, z: -64, rx: 16.5, rz: 9.5, crown: 4.0, rotation: 0.14, seed: 4591,
    },
    {
        x: 85, z: -101, rx: 11.5, rz: 7.2, crown: 3.2, rotation: -0.20, seed: 5717,
    },
];

const ISLAND_SEQUENCE = [0, 3, 1, 4, 0, 3, 2, 0, 4, 1, 3];
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function makeRng(seed) {
    let state = seed % 2147483647;
    if (state <= 0) state += 2147483646;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

function sampleIslandSurface(island, localX, localZ) {
    const r = Math.min(1, Math.hypot(localX / island.rx, localZ / island.rz));
    if (r <= 0.38) return THREE.MathUtils.lerp(island.crown, island.crown * 0.82, r / 0.38);
    if (r <= 0.72) return THREE.MathUtils.lerp(island.crown * 0.82, island.crown * 0.42, (r - 0.38) / 0.34);
    return THREE.MathUtils.lerp(island.crown * 0.42, 1.15, (r - 0.72) / 0.28);
}

function islandLocalToWorld(island, localX, localZ) {
    const c = Math.cos(island.rotation);
    const s = Math.sin(island.rotation);
    return {
        x: island.x + localX * c + localZ * s,
        z: island.z - localX * s + localZ * c,
    };
}

function buildIslandGeometry(island) {
    const segments = 14;
    const rng = makeRng(island.seed);
    const edgeScale = Array.from({ length: segments }, () => 0.90 + rng() * 0.20);
    const angleJitter = Array.from({ length: segments }, () => (rng() - 0.5) * 0.08);
    const heightJitter = Array.from({ length: segments }, () => (rng() - 0.5) * 0.34);
    const rings = [
        { radius: 0.38, height: island.crown * 0.82, irregularity: 0.35 },
        { radius: 0.72, height: island.crown * 0.42, irregularity: 0.65 },
        { radius: 1.00, height: 1.15, irregularity: 1.00 },
        { radius: 1.08, height: -1.10, irregularity: 1.00 },
        { radius: 0.74, height: -3.2 - island.crown * 0.12, irregularity: 0.80 },
    ];
    const positions = [0, island.crown, 0];
    rings.forEach((ring, ringIndex) => {
        for (let i = 0; i < segments; i += 1) {
            const angle = (i / segments) * Math.PI * 2 + angleJitter[i];
            const radial = ring.radius * THREE.MathUtils.lerp(1, edgeScale[i], ring.irregularity);
            const jitter = heightJitter[i] * (ringIndex < 2 ? 0.45 : 1.0);
            positions.push(
                Math.cos(angle) * island.rx * radial,
                ring.height + jitter,
                Math.sin(angle) * island.rz * radial,
            );
        }
    });
    const bottomIndex = positions.length / 3;
    positions.push(0, -3.5 - island.crown * 0.12, 0);
    const index = [];
    const at = (ring, segment) => 1 + ring * segments + (segment % segments);
    for (let i = 0; i < segments; i += 1) index.push(0, at(0, i + 1), at(0, i));
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
        for (let i = 0; i < segments; i += 1) {
            const a0 = at(ring, i); const a1 = at(ring, i + 1);
            const b0 = at(ring + 1, i); const b1 = at(ring + 1, i + 1);
            index.push(a0, a1, b0, a1, b1, b0);
        }
    }
    for (let i = 0; i < segments; i += 1) {
        index.push(at(rings.length - 1, i), at(rings.length - 1, i + 1), bottomIndex);
    }
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    indexed.setIndex(index);
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function buildCrystalGeometry({ radii, skew, seed }) {
    const sides = 6;
    const ringY = [-0.48, -0.08, 0.28];
    const ringTwist = [0, 0.17, -0.08];
    const rng = makeRng(seed);
    const positions = [];
    for (let ring = 0; ring < ringY.length; ring += 1) {
        for (let i = 0; i < sides; i += 1) {
            const angle = (i / sides) * Math.PI * 2 + ringTwist[ring];
            const radius = radii[ring] * (0.86 + rng() * 0.25);
            positions.push(
                Math.cos(angle) * radius + Math.sin(i * 1.7 + ring) * skew,
                ringY[ring],
                Math.sin(angle) * radius * (0.72 + rng() * 0.06) + Math.cos(i * 1.4 + ring) * skew,
            );
        }
    }
    const apexIndex = positions.length / 3;
    positions.push(skew * 0.5, 0.52, skew * -0.25);
    const baseIndex = apexIndex + 1;
    positions.push(0, -0.53, 0);
    const index = [];
    const at = (ring, segment) => ring * sides + (segment % sides);
    for (let ring = 0; ring < 2; ring += 1) {
        for (let i = 0; i < sides; i += 1) {
            const a0 = at(ring, i); const a1 = at(ring, i + 1);
            const b0 = at(ring + 1, i); const b1 = at(ring + 1, i + 1);
            index.push(a0, b0, a1, a1, b0, b1);
        }
    }
    for (let i = 0; i < sides; i += 1) index.push(at(2, i), apexIndex, at(2, i + 1));
    for (let i = 0; i < sides; i += 1) index.push(at(0, i + 1), baseIndex, at(0, i));
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    indexed.setIndex(index);
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

export function create({ scene, camera }) {
    const root = new THREE.Group();
    scene.add(root);
    scene.background = new THREE.Color(0x160b36);
    const uTime = uniform(0);

    const lakeMaterial = new THREE.MeshBasicNodeMaterial();
    lakeMaterial.colorNode = mix(
        vec3(0.018, 0.012, 0.055),
        vec3(0.085, 0.028, 0.16),
        smoothstep(-125, -30, positionWorld.z),
    );
    lakeMaterial.toneMapped = false;
    const lake = new THREE.Mesh(new THREE.PlaneGeometry(600, 400), lakeMaterial);
    lake.rotation.x = -Math.PI / 2;
    lake.position.z = -75;
    root.add(lake);

    const islandMaterial = new THREE.MeshBasicNodeMaterial();
    {
        const N = normalize(normalWorld);
        const top = smoothstep(0.58, 0.90, N.y);
        const key = clamp(dot(N, normalize(vec3(-0.35, 0.78, 0.52))), 0, 1);
        const waterline = smoothstep(0.22, 1.35, abs(positionWorld.y.sub(0.10))).oneMinus()
            .mul(smoothstep(0.30, 0.72, N.y).oneMinus());
        const crown = smoothstep(0.5, 4.5, positionWorld.y).mul(top);
        const fillMask = top.mul(0.55).add(0.35);
        islandMaterial.colorNode = mix(vec3(0.014, 0.008, 0.032), vec3(0.095, 0.029, 0.130), top)
            .add(vec3(0.20, 0.08, 0.27).mul(key).mul(0.40).mul(fillMask))
            .add(vec3(0.50, 0.12, 0.38).mul(waterline).mul(0.34))
            .add(vec3(0.13, 0.06, 0.23).mul(crown).mul(0.24));
        islandMaterial.toneMapped = false;
    }
    SHORE_ISLANDS.forEach((island) => {
        const mesh = new THREE.Mesh(buildIslandGeometry(island), islandMaterial);
        mesh.position.set(island.x, 0, island.z);
        mesh.rotation.y = island.rotation;
        root.add(mesh);
    });

    const crystalMaterial = new THREE.MeshStandardNodeMaterial();
    crystalMaterial.vertexColors = true;
    crystalMaterial.roughness = 0.12;
    crystalMaterial.metalness = 0;
    crystalMaterial.transparent = true;
    crystalMaterial.depthWrite = true;
    {
        const tint = attribute('aTint', 'vec3');
        const phase = attribute('aPhase', 'float');
        const rate = attribute('aRate', 'float');
        const fresnel = pow(
            clamp(float(1).sub(dot(normalize(normalWorld), normalize(cameraPosition.sub(positionWorld)))), 0, 1),
            float(2.2),
        );
        const tip = pow(clamp(positionGeometry.y.mul(0.95).add(0.5), 0, 1), float(2));
        const breath = sin(uTime.mul(rate).add(phase.mul(6.283))).mul(0.15).add(0.90);
        crystalMaterial.emissiveNode = tint.mul(fresnel.mul(0.55).add(tip.mul(0.42)).add(0.16)).mul(breath);
        crystalMaterial.opacityNode = clamp(float(0.68).add(fresnel.mul(0.30)), 0, 1);
        crystalMaterial.positionNode = positionLocal;
    }
    const HERO_ANCHORS = [
        {
            island: 0, ux: 0.46, uz: -0.05, warm: true,
        },
        {
            island: 3, ux: -0.40, uz: 0.02, warm: true,
        },
        {
            island: 1, ux: 0.24, uz: -0.02, warm: false,
        },
        {
            island: 4, ux: -0.20, uz: -0.04, warm: false,
        },
        {
            island: 2, ux: 0.10, uz: 0.02, warm: true,
        },
        {
            island: 0, ux: -0.34, uz: 0.16, warm: false,
        },
    ];
    const relic = { x: 0, z: -95 };
    const twilightSink = new THREE.Color(0x1a0e30);
    const pickHue = (rng, x, z, forceWarm) => {
        const color = new THREE.Color();
        if (forceWarm || (Math.hypot(x - relic.x, z - relic.z) < 42 && rng() < 0.35)) {
            color.set(rng() < 0.5 ? 0xffb060 : 0xff7d9e);
        } else {
            const choice = rng();
            if (choice < 0.16) color.set(0x76dfff);
            else if (choice < 0.32) color.set(0xff72d1);
            else if (choice < 0.46) color.set(0xd486ff);
            else color.set(0x8b61e8);
        }
        const far = Math.min(1, Math.max(0, (-z - 18) / 178));
        return color.lerp(twilightSink, far * 0.45);
    };

    const buildCrystalMesh = (geometry, count, { seed, hero }) => {
        const mesh = new THREE.InstancedMesh(geometry, crystalMaterial, count);
        const rng = makeRng(seed);
        const islandOrdinals = new Array(SHORE_ISLANDS.length).fill(0);
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const euler = new THREE.Euler();
        const scale = new THREE.Vector3();
        const position = new THREE.Vector3();
        const phases = new Float32Array(count);
        const rates = new Float32Array(count);
        const tints = new Float32Array(count * 3);
        for (let i = 0; i < count; i += 1) {
            let islandIndex; let localX; let localZ; let forceWarm = false;
            if (hero) {
                const anchor = HERO_ANCHORS[i % HERO_ANCHORS.length];
                islandIndex = anchor.island;
                const island = SHORE_ISLANDS[islandIndex];
                localX = anchor.ux * island.rx;
                localZ = anchor.uz * island.rz;
                forceWarm = anchor.warm;
            } else {
                islandIndex = ISLAND_SEQUENCE[i % ISLAND_SEQUENCE.length];
                const island = SHORE_ISLANDS[islandIndex];
                const ordinal = islandOrdinals[islandIndex];
                islandOrdinals[islandIndex] += 1;
                const angle = ordinal * GOLDEN_ANGLE + island.seed * 0.013 + (rng() - 0.5) * 0.34;
                const radius = 0.22 + Math.sqrt(rng()) * 0.46;
                localX = Math.cos(angle) * island.rx * radius;
                localZ = Math.sin(angle) * island.rz * radius;
            }
            const island = SHORE_ISLANDS[islandIndex];
            const world = islandLocalToWorld(island, localX, localZ);
            const depthScale = Math.max(0.65, Math.min(1, (world.z + 125) / 72));
            const stub = !hero && rng() < 0.34;
            let height;
            if (hero) height = (8.8 + rng() * 3.6) * depthScale;
            else if (stub) height = (2.6 + rng() * 2.2) * depthScale;
            else height = (4.6 + rng() * 4.3) * depthScale;
            let widthBase;
            if (hero) widthBase = 2.45;
            else if (stub) widthBase = 1.9;
            else widthBase = 1.5;
            const width = widthBase * (0.86 + rng() * 0.28);
            let lean = 0.20;
            if (hero) lean = 0.12;
            else if (stub) lean = 0.26;
            const surfaceY = sampleIslandSurface(island, localX, localZ);
            const sink = height * (hero ? 0.12 : 0.16) + 0.18;
            euler.set((rng() - 0.5) * lean, rng() * Math.PI * 2, (rng() - 0.5) * lean);
            quaternion.setFromEuler(euler);
            scale.set(width, height, width * (0.82 + rng() * 0.36));
            position.set(world.x, surfaceY + 0.53 * height - sink, world.z);
            matrix.compose(position, quaternion, scale);
            mesh.setMatrixAt(i, matrix);
            const color = pickHue(rng, world.x, world.z, forceWarm);
            mesh.setColorAt(i, color.clone().multiplyScalar(0.42));
            tints[i * 3] = color.r;
            tints[i * 3 + 1] = color.g;
            tints[i * 3 + 2] = color.b;
            phases[i] = rng();
            rates[i] = 0.5 + rng() * 0.7;
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
        geometry.setAttribute('aRate', new THREE.InstancedBufferAttribute(rates, 1));
        geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
        mesh.frustumCulled = false;
        root.add(mesh);
    };

    const fieldGeometry = buildCrystalGeometry({
        radii: [0.72, 0.56, 0.30], skew: 0.16, seed: 91713,
    });
    buildCrystalMesh(fieldGeometry, 30, { seed: 91713, hero: false });
    const heroGeometry = buildCrystalGeometry({
        radii: [0.84, 0.70, 0.48], skew: 0.10, seed: 20477,
    });
    buildCrystalMesh(heroGeometry, 4, { seed: 20477, hero: true });

    const hemi = new THREE.HemisphereLight(0x8b72ca, 0x2b102d, 1.3);
    const key = new THREE.DirectionalLight(0xff82bd, 2.2);
    key.position.set(-35, 65, 35);
    root.add(hemi, key);

    return {
        camera(time, activeCamera) {
            activeCamera.position.set(2.4, 16.4, 44.6);
            activeCamera.lookAt(0.15, 14.5, -95);
            activeCamera.fov = 58;
            activeCamera.near = 0.1;
            activeCamera.far = 9000;
            activeCamera.updateProjectionMatrix();
        },
        update(time) { uTime.value = time; },
        dispose() {
            scene.remove(root);
            root.traverse((child) => {
                child.geometry?.dispose?.();
                if (child.material && child.material !== islandMaterial) child.material.dispose?.();
            });
            islandMaterial.dispose();
            scene.background = null;
            if (camera) camera.clearViewOffset?.();
        },
    };
}
