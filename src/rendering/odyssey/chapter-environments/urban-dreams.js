import * as THREE from 'three';
import { getChapterPathRange } from '../path-utils.js';

export const URBAN_DREAMS_CONFIG = {
    id: 8,
    name: 'urban-dreams',
    colors: {
        primary: 0x0c0818,
        secondary: 0x201135,
        tertiary: 0x00f2ff,
        accent: 0xff3fb4,
        background: 0x060712,
    },
};

function createSkyGradient() {
    return new THREE.Mesh(
        new THREE.SphereGeometry(420, 28, 20),
        new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 1 },
            },
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            vertexShader: `
                varying vec3 vPosition;
                void main() {
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uOpacity;
                varying vec3 vPosition;

                void main() {
                    float h = normalize(vPosition).y * 0.5 + 0.5;
                    vec3 base = mix(vec3(0.03, 0.03, 0.08), vec3(0.08, 0.02, 0.16), h);
                    float pulse = sin(uTime * 0.18 + h * 8.0) * 0.04 + 0.08;
                    gl_FragColor = vec4(base + pulse, uOpacity);
                }
            `,
        }),
    );
}

function createCityBlocks() {
    const group = new THREE.Group();
    const buildingMaterial = new THREE.MeshStandardMaterial({
        color: 0x090a14,
        emissive: 0x090a14,
        roughness: 0.7,
        metalness: 0.3,
    });

    for (let index = 0; index < 18; index += 1) {
        const width = 12 + (Math.random() * 8);
        const height = 18 + (Math.random() * 44);
        const depth = 10 + (Math.random() * 12);
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            buildingMaterial.clone(),
        );
        mesh.position.set(
            -110 + (index * 13),
            height * 0.5 - 18,
            -650 - (Math.random() * 110),
        );
        mesh.material.emissiveIntensity = 0.18;
        group.add(mesh);

        const windowMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(width * 0.7, height * 0.8),
            new THREE.MeshBasicMaterial({
                color: index % 2 === 0 ? 0x00f2ff : 0xff3fb4,
                transparent: true,
                opacity: 0.18,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        windowMesh.position.set(mesh.position.x, mesh.position.y, mesh.position.z + (depth * 0.5) + 0.1);
        group.add(windowMesh);
    }

    return group;
}

function createNeonRails() {
    const group = new THREE.Group();
    const lineMaterial = new THREE.MeshBasicMaterial({
        color: 0x00f2ff,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    for (let index = 0; index < 6; index += 1) {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(26 + index * 10, 0.4, 8, 96),
            lineMaterial.clone(),
        );
        ring.rotation.x = Math.PI * 0.5;
        ring.position.set(0, -12 + index * 10, -620 - index * 14);
        ring.material.color = new THREE.Color(index % 2 === 0 ? 0x00f2ff : 0xff3fb4);
        group.add(ring);
    }

    return group;
}

function createRainCurtain() {
    const count = 320;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        positions[stride] = (Math.random() - 0.5) * 260;
        positions[stride + 1] = Math.random() * 160 - 30;
        positions[stride + 2] = -560 - Math.random() * 140;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
            color: 0xb8f3ff,
            size: 1.4,
            transparent: true,
            opacity: 0.32,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
}

export function createUrbanDreamsEnvironment() {
    const group = new THREE.Group();
    group.name = 'urban-dreams-environment';
    group.userData.chapterId = 8;

    const chapterRange = getChapterPathRange(8);
    const fallbackCenterY = 940;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;

    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    const sky = createSkyGradient();
    sky.position.z = -590;
    group.add(sky);
    group.add(createCityBlocks());
    group.add(createNeonRails());
    group.add(createRainCurtain());

    group.position.y = chapterCenterY;
    return group;
}

export function updateUrbanDreamsEnvironment(group, delta, time, camera) {
    group.traverse((child) => {
        if (child.material?.uniforms?.uTime) {
            child.material.uniforms.uTime.value = time;
        }
    });

    const rails = group.children[2];
    if (rails?.children) {
        rails.children.forEach((ring, index) => {
            ring.rotation.z += delta * (0.18 + index * 0.05);
        });
    }

    const rain = group.children[3];
    if (rain?.geometry?.attributes?.position) {
        const { array } = rain.geometry.attributes.position;
        const cameraY = camera?.position?.y ?? group.position.y;
        for (let index = 0; index < array.length; index += 3) {
            array[index + 1] -= 0.9 + (index % 5) * 0.04;
            if (array[index + 1] < -55) {
                array[index + 1] = 120 + ((cameraY - group.position.y) * 0.02);
            }
        }
        rain.geometry.attributes.position.needsUpdate = true;
    }
}

export default {
    config: URBAN_DREAMS_CONFIG,
    create: createUrbanDreamsEnvironment,
    update: updateUrbanDreamsEnvironment,
};
