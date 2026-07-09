/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Sakura petal billboards - isolated parity proof for the Sakura Twilight theme.
// Uses instanced camera-facing quads instead of THREE.Points so petal shape,
// rotation, and alpha stay consistent across Electron render-scale/DPR paths.
import * as THREE from 'three/webgpu';
import {
    attribute,
    clamp,
    cos,
    float,
    mod,
    positionLocal,
    sin,
    texture as textureNode,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';

export const meta = {
    id: 'sakura-petal-billboards',
    title: 'Sakura Petal Billboards',
    description: 'Instanced camera-facing sakura petals with deterministic fall and wrap motion.',
};

function createPetalTexture() {
    const canvas = document.createElement('canvas');
    const size = 64;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;

    const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
    glowGrad.addColorStop(0, 'rgba(255, 200, 210, 0.8)');
    glowGrad.addColorStop(0.5, 'rgba(255, 180, 200, 0.4)');
    glowGrad.addColorStop(1, 'rgba(255, 150, 180, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.35);
    ctx.bezierCurveTo(size * 0.25, -size * 0.15, size * 0.3, size * 0.15, 0, size * 0.35);
    ctx.bezierCurveTo(-size * 0.3, size * 0.15, -size * 0.25, -size * 0.15, 0, -size * 0.35);
    ctx.closePath();

    const petalGrad = ctx.createLinearGradient(0, -size * 0.35, 0, size * 0.35);
    petalGrad.addColorStop(0, 'rgba(255, 245, 250, 0.95)');
    petalGrad.addColorStop(0.3, 'rgba(255, 200, 220, 0.9)');
    petalGrad.addColorStop(0.7, 'rgba(255, 170, 195, 0.85)');
    petalGrad.addColorStop(1, 'rgba(240, 150, 175, 0.8)');
    ctx.fillStyle = petalGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -size * 0.3);
    ctx.lineTo(0, size * 0.25);
    ctx.strokeStyle = 'rgba(220, 140, 160, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
}

function createPetalGeometry(count) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        -0.5, -0.5, 0,
        0.5, -0.5, 0,
        -0.5, 0.5, 0,
        0.5, 0.5, 0,
    ]), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        1, 1,
    ]), 2));

    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);

    let seed = 4319;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };

    const camX = 20;
    const camZ = 30;

    for (let i = 0; i < count; i += 1) {
        const i3 = i * 3;
        const i4 = i * 4;
        const inFront = random() < 0.7;

        if (inFront) {
            positions[i3] = camX + (random() - 0.5) * 60;
            positions[i3 + 1] = 35 + random() * 15;
            positions[i3 + 2] = camZ + (random() - 0.3) * 40;
        } else {
            positions[i3] = (random() - 0.5) * 100;
            positions[i3 + 1] = 35 + random() * 15;
            positions[i3 + 2] = (random() - 0.5) * 100;
        }

        seeds[i4] = random() * 100;
        seeds[i4 + 1] = 0.3 + random() * 0.7;
        seeds[i4 + 2] = random() * Math.PI * 2;
        seeds[i4 + 3] = 0.5 + random();

        sizes[i] = 3 + random() * 5;
        alphas[i] = 0.7 + random() * 0.3;
    }

    geometry.setAttribute('aBasePosition', new THREE.InstancedBufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(alphas, 1));
    geometry.instanceCount = count;
    return geometry;
}

function createPetalMaterial(petalTexture) {
    const material = new THREE.MeshBasicNodeMaterial();
    const uTime = uniform(0);
    const aBasePosition = attribute('aBasePosition', 'vec3');
    const aSeed = attribute('aSeed', 'vec4');
    const aSize = attribute('aSize', 'float');
    const aAlpha = attribute('aAlpha', 'float');

    const phase = aSeed.x;
    const fallSpeed = aSeed.y;
    const spiralPhase = aSeed.z;
    const spiralRadius = aSeed.w;
    const t = uTime.mul(fallSpeed);

    const fallY = t.mul(2.0);
    const spiralT = t.mul(1.5).add(spiralPhase);
    const wobbleX = sin(spiralT).mul(spiralRadius);
    const wobbleZ = cos(spiralT.mul(0.7).add(phase)).mul(spiralRadius).mul(0.7);
    const windX = sin(uTime.mul(0.3).add(phase.mul(0.1))).mul(3.0);
    const windZ = cos(uTime.mul(0.25).add(phase.mul(0.15))).mul(2.0);

    const centerX = mod(aBasePosition.x.add(wobbleX).add(windX).add(60.0), 120.0).sub(60.0);
    const centerY = mod(aBasePosition.y.sub(fallY).add(100.0), 55.0).sub(5.0);
    const centerZ = mod(aBasePosition.z.add(wobbleZ).add(windZ).add(60.0), 120.0).sub(60.0);

    const rotation = t.mul(2.0).add(phase);
    const c = cos(rotation);
    const s = sin(rotation);
    const quad = vec2(
        positionLocal.x.mul(c).sub(positionLocal.y.mul(s)),
        positionLocal.x.mul(s).add(positionLocal.y.mul(c)),
    );
    const worldSize = clamp(aSize.mul(0.16), 0.42, 1.25);

    material.positionNode = vec3(
        centerX.add(quad.x.mul(worldSize)),
        centerY.add(quad.y.mul(worldSize)),
        centerZ,
    );

    const sample = textureNode(petalTexture, uv());
    material.colorNode = sample.rgb;
    material.opacityNode = sample.a.mul(aAlpha).mul(float(0.95));
    material.alphaTestNode = float(0.1);
    material.transparent = true;
    material.depthWrite = false;
    material.alphaTest = 0.1;
    material.side = THREE.DoubleSide;
    material.userData.uTime = uTime;
    return material;
}

function createSceneContext(scene) {
    scene.background = new THREE.Color(0x261848);
    scene.fog = new THREE.Fog(0x261848, 26, 88);

    const roots = [];
    const geometries = [];
    const materials = [];

    const track = (object) => {
        roots.push(object);
        scene.add(object);
        return object;
    };
    const trackGeometry = (geometry) => {
        geometries.push(geometry);
        return geometry;
    };
    const trackMaterial = (material) => {
        materials.push(material);
        return material;
    };

    const ground = new THREE.Mesh(
        trackGeometry(new THREE.PlaneGeometry(160, 160)),
        trackMaterial(new THREE.MeshBasicMaterial({ color: 0x07110d })),
    );
    ground.rotation.x = -Math.PI / 2;
    track(ground);

    const trunkMaterial = trackMaterial(new THREE.MeshBasicMaterial({ color: 0x191020 }));
    const blossomMaterial = trackMaterial(new THREE.MeshBasicMaterial({ color: 0x5a2f58 }));

    [-24, -8, 12, 30].forEach((x, index) => {
        const trunk = new THREE.Mesh(
            trackGeometry(new THREE.CylinderGeometry(0.8, 1.2, 13 + index, 6)),
            trunkMaterial,
        );
        trunk.position.set(x, 5.8, -12 - index * 4);
        track(trunk);

        const canopy = new THREE.Mesh(
            trackGeometry(new THREE.IcosahedronGeometry(8 + index, 1)),
            blossomMaterial,
        );
        canopy.position.set(x, 15 + index * 0.8, -12 - index * 4);
        canopy.scale.set(1.5, 0.75, 1.2);
        track(canopy);
    });

    const moon = new THREE.Mesh(
        trackGeometry(new THREE.CircleGeometry(8, 48)),
        trackMaterial(new THREE.MeshBasicMaterial({ color: 0xd9d7ee })),
    );
    moon.position.set(-36, 34, -80);
    track(moon);

    return {
        dispose() {
            roots.forEach((object) => scene.remove(object));
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
        },
    };
}

export function create({ scene }) {
    const backdrop = createSceneContext(scene);
    const petalTexture = createPetalTexture();
    const geometry = createPetalGeometry(400);
    const material = createPetalMaterial(petalTexture);
    const petals = new THREE.Mesh(geometry, material);
    petals.frustumCulled = false;
    scene.add(petals);

    return {
        cameraRadius: 48,
        camera(_time, activeCamera) {
            activeCamera.position.set(20, 5.5, 34);
            activeCamera.lookAt(0, 12, -10);
        },
        update(time) {
            material.userData.uTime.value = time;
        },
        dispose() {
            scene.remove(petals);
            geometry.dispose();
            material.dispose();
            petalTexture.dispose();
            backdrop.dispose();
        },
    };
}
