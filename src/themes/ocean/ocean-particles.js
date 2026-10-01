/* eslint-disable import/no-unresolved */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraWorldMatrix, float, fract, modelWorldMatrixInverse,
    positionGeometry, sin, uniform, vec3, vec4,
} from 'three/tsl';
import {
    createBubbleNodeMaterial,
    createPlanktonNodeMaterial,
} from './ocean-materials.js';
import { getReefSeabedHeight } from './ocean-composition.js';

const GARDENS = [
    [-42, 22, 12], [44, 20, 13], [-54, -24, 20],
    [57, -30, 21], [-68, -82, 26], [72, -88, 27],
];

function sampleGarden(rng, spread, radiusScale) {
    const [gx, gz, radiusBase] = GARDENS[Math.floor(rng() * GARDENS.length)];
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * radiusBase * radiusScale;
    return {
        x: THREE.MathUtils.clamp(gx + Math.cos(angle) * radius, -spread, spread),
        z: THREE.MathUtils.clamp(gz + Math.sin(angle) * radius, -150, 92),
    };
}

function samplePlankton(count, rng, seabedHeight) {
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const sizes = new Float32Array(count);
    const between = (lo, hi) => lo + rng() * (hi - lo);
    for (let i = 0; i < count; i += 1) {
        const { x, z } = rng() < 0.64
            ? sampleGarden(rng, 160, between(0.7, 1.45))
            : { x: between(-160, 160), z: between(-155, 85) };
        const nearReef = rng() < 0.58;
        positions.set([
            x,
            nearReef ? seabedHeight(x, z) + between(4, 28) : rng() * 70 + 5,
            z,
        ], i * 3);
        phases[i] = rng() * 6.28;
        sizes[i] = nearReef ? between(0.48, 1.55) : between(0.42, 1.9);
    }
    return {
        positions, phases, sizes, count,
    };
}

function sampleBubbles(count, rng, seabedHeight) {
    const between = (lo, hi) => lo + rng() * (hi - lo);
    const columnCount = Math.max(5, Math.round(Math.sqrt(count) * 0.62));
    const columns = [];
    for (let c = 0; c < columnCount; c += 1) {
        let side = 0;
        if (rng() < 0.66) side = rng() < 0.5 ? -1 : 1;
        let { x, z } = rng() < 0.62
            ? sampleGarden(rng, 120, 0.72)
            : {
                x: side === 0 ? between(-70, 70) : side * between(28, 105),
                z: between(-120, 70),
            };
        if (Math.abs(x) < 28 && z >= -42 && z <= 70) {
            x = (x < 0 ? -1 : 1) * between(40, 120);
            z = z < 12 ? z - between(24, 54) : z + between(20, 48);
        }
        columns.push({
            x, z, y: seabedHeight(x, z) + between(0.8, 2.5), spread: between(0.7, 3.6),
        });
    }
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const phases = new Float32Array(count);
    const sizes = new Float32Array(count);
    const lifeOffsets = new Float32Array(count);
    const columnSpread = new Float32Array(count);
    const micro = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        const column = columns[i % columnCount];
        const angle = rng() * Math.PI * 2;
        const radius = rng() * column.spread;
        const isMicro = rng() < 0.84;
        positions.set([
            column.x + Math.cos(angle) * radius,
            column.y,
            column.z + Math.sin(angle) * radius,
        ], i * 3);
        speeds[i] = isMicro ? between(0.72, 1.65) : between(0.38, 0.9);
        phases[i] = rng() * 6.28;
        sizes[i] = isMicro ? between(0.4, 1.15) : between(1.2, 2.6);
        lifeOffsets[i] = rng();
        columnSpread[i] = column.spread;
        micro[i] = isMicro ? 1 : 0;
    }
    return {
        positions, speeds, phases, sizes, lifeOffsets, columnSpread, micro, count,
    };
}

function createGeometry(data, upwardTravel) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.attributes = { ...plane.attributes };
    geometry.instanceCount = data.count;
    geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(data.positions, 3));
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < data.count; i += 1) {
        point.fromArray(data.positions, i * 3);
        box.expandByPoint(point);
        point.y += upwardTravel;
        box.expandByPoint(point);
    }
    box.expandByScalar(12);
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    // Plane owns no GPU allocation yet; attributes now belong to geometry.
    plane.dispose();
    return geometry;
}

function billboardOffset(size) {
    const worldOffset = cameraWorldMatrix.mul(vec4(positionGeometry.xy.mul(size), 0, 0));
    // Convert the view-facing world offset back to the mesh's local space;
    // positionNode then follows the normal projection/fog path in r186.
    return modelWorldMatrixInverse.mul(worldOffset).xyz;
}

export function createOceanPlanktonBillboards(data) {
    const geometry = createGeometry(data, 0);
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(data.phases, 1));
    geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(data.sizes, 1));
    const material = createPlanktonNodeMaterial({ glowIntensity: 0.66 });
    const { uTime, uGlowIntensity, uCurrentStrength } = material.userData;
    const phase = attribute('aPhase');
    const center = attribute('aCenter', 'vec3').add(vec3(
        sin(uTime.mul(0.1).add(phase.mul(1.2))).mul(float(0.52).add(uCurrentStrength.mul(0.26))),
        sin(uTime.mul(0.14).add(phase)).mul(0.45),
        sin(uTime.mul(0.11).add(phase.mul(0.9))).mul(float(0.42).add(uCurrentStrength.mul(0.18))),
    ));
    const size = attribute('aSize').add(
        sin(uTime.mul(0.72).add(phase.mul(3.5))).mul(0.5).add(0.5)
            .mul(uGlowIntensity)
            .mul(0.32 * 1.2),
    );
    material.positionNode = center.add(billboardOffset(size));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ocean-plankton-gpu-billboards';
    mesh.count = data.count;
    mesh.userData.primitive = 'billboard-quad';
    mesh.userData.gpuAnimatedBillboard = true;
    mesh.visible = data.count > 0;
    return mesh;
}

export function createOceanBubbleBillboards(data) {
    const geometry = createGeometry(data, 98);
    const pack1 = new Float32Array(data.count * 4);
    const pack2 = new Float32Array(data.count * 2);
    for (let i = 0; i < data.count; i += 1) {
        pack1.set([data.speeds[i], data.phases[i], data.sizes[i], data.lifeOffsets[i]], i * 4);
        pack2.set([data.columnSpread[i], data.micro?.[i] ?? (data.sizes[i] < 1.2 ? 1 : 0)], i * 2);
    }
    geometry.setAttribute('aBubblePack1', new THREE.InstancedBufferAttribute(pack1, 4));
    geometry.setAttribute('aBubblePack2', new THREE.InstancedBufferAttribute(pack2, 2));
    const material = createBubbleNodeMaterial();
    const { uTime } = material.userData;
    const uCurrentStrength = uniform(0.5);
    material.userData.uCurrentStrength = uCurrentStrength;
    const packed = attribute('aBubblePack1', 'vec4');
    const spread = attribute('aBubblePack2', 'vec2').x;
    const phase = packed.y;
    const travel = fract(packed.w.add(uTime.mul(packed.x).mul(0.035)));
    const drift = spread.mul(float(0.12).add(travel.mul(0.26)))
        .mul(float(1.0).add(uCurrentStrength.mul(0.16)));
    const center = attribute('aCenter', 'vec3').add(vec3(
        sin(uTime.mul(1.35).add(phase).add(travel.mul(6.0))).mul(drift)
            .add(travel.mul(uCurrentStrength).mul(0.9)),
        travel.mul(98.0),
        sin(uTime.mul(1.2).add(phase.mul(1.3)).add(travel.mul(5.0))).mul(drift).mul(0.8),
    ));
    const size = packed.z.mul(float(1.0).add(spread.mul(0.01)));
    material.positionNode = center.add(billboardOffset(size));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ocean-bubbles-gpu-billboards';
    mesh.count = data.count;
    mesh.userData.primitive = 'billboard-quad';
    mesh.userData.gpuAnimatedBillboard = true;
    mesh.visible = data.count > 0;
    return mesh;
}

/** Two existing particle draws, static attributes, only scalar uniform writes per frame. */
export function createOceanReefParticles({
    rng,
    planktonCount = 600,
    bubbleCount = 280,
    getSeabedHeight = getReefSeabedHeight,
    planktonData = null,
    bubbleData = null,
} = {}) {
    if (typeof rng !== 'function' && (!planktonData || !bubbleData)) {
        throw new TypeError('Ocean reef particles require a deterministic rng or both population data sets.');
    }
    const plankton = planktonData || samplePlankton(planktonCount, rng, getSeabedHeight);
    const bubbles = bubbleData || sampleBubbles(bubbleCount, rng, getSeabedHeight);
    const planktonMesh = createOceanPlanktonBillboards(plankton);
    const bubbleMesh = createOceanBubbleBillboards(bubbles);
    const group = new THREE.Group();
    group.name = 'ocean-reef-particles';
    group.add(planktonMesh, bubbleMesh);
    const materials = [planktonMesh.material, bubbleMesh.material];
    let disposed = false;
    return {
        group,
        planktonMesh,
        bubbleMesh,
        data: { plankton, bubbles },
        update(time, current = 0.5, glow = 0.8) {
            if (disposed) return;
            materials.forEach(({ userData }) => {
                userData.uTime.value = time;
                userData.uCurrentStrength.value = current;
                if (userData.uGlowIntensity) userData.uGlowIntensity.value = glow;
            });
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            group.removeFromParent();
            group.clear();
            [planktonMesh, bubbleMesh].forEach(({ geometry, material }) => {
                geometry.dispose();
                material.dispose();
            });
        },
    };
}
