import * as THREE from 'three';
import { getChapterPathRange } from '../path-utils.js';

export const BLACK_HOLE_TRANSCENDENCE_CONFIG = {
    id: 7,
    name: 'black-hole-transcendence',
    colors: {
        primary: 0x040208,
        secondary: 0x1b0f2d,
        tertiary: 0xff33cc,
        accent: 0x66e3ff,
        background: 0x000000,
    },
};

function createVoidDome() {
    return new THREE.Mesh(
        new THREE.SphereGeometry(520, 32, 24),
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

                float hash(vec3 p) {
                    return fract(sin(dot(p, vec3(12.9898, 78.233, 53.539))) * 43758.5453);
                }

                void main() {
                    vec3 dir = normalize(vPosition);
                    float nebula = hash(floor(dir * 28.0 + uTime * 0.3));
                    float veil = smoothstep(0.18, 0.95, nebula) * 0.28;
                    vec3 base = mix(vec3(0.0, 0.0, 0.0), vec3(0.08, 0.02, 0.14), max(dir.y * 0.5 + 0.5, 0.0));
                    vec3 color = base + vec3(0.16, 0.03, 0.18) * veil;
                    gl_FragColor = vec4(color, uOpacity);
                }
            `,
        }),
    );
}

function createEventHorizon() {
    const geometry = new THREE.PlaneGeometry(220, 220, 1, 1);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 1 },
            uPrimary: { value: new THREE.Color(BLACK_HOLE_TRANSCENDENCE_CONFIG.colors.primary) },
            uAccent: { value: new THREE.Color(BLACK_HOLE_TRANSCENDENCE_CONFIG.colors.tertiary) },
        },
        transparent: true,
        depthWrite: false,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uOpacity;
            uniform vec3 uPrimary;
            uniform vec3 uAccent;
            varying vec2 vUv;

            void main() {
                vec2 centered = vUv - 0.5;
                float dist = length(centered);
                float angle = atan(centered.y, centered.x);
                float vortex = sin(angle * 8.0 - uTime * 1.8 + dist * 30.0) * 0.5 + 0.5;
                float disk = smoothstep(0.42, 0.18, abs(dist - 0.24));
                float ring = smoothstep(0.21, 0.16, abs(dist - 0.19));
                float voidMask = smoothstep(0.16, 0.13, dist);
                vec3 color = mix(uAccent, vec3(0.95, 0.72, 0.34), vortex);
                color *= disk * 1.2 + ring * 2.0;
                color *= voidMask;
                gl_FragColor = vec4(color, (disk * 0.85 + ring * 0.9) * uOpacity);
            }
        `,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, -780);
    return mesh;
}

function createAccretionRings() {
    const group = new THREE.Group();
    const ringColors = [0xff33cc, 0x66e3ff, 0xffb347];

    ringColors.forEach((color, index) => {
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.18 + (index * 0.04),
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(32 + (index * 9), 1.8 + (index * 0.6), 16, 96),
            material,
        );
        ring.rotation.x = Math.PI * (0.42 + index * 0.06);
        ring.rotation.y = index * 0.55;
        ring.position.set(0, 0, -780);
        group.add(ring);
    });

    return group;
}

function createTranscendenceShards() {
    const count = 180;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        const angle = Math.random() * Math.PI * 2;
        const radius = 30 + (Math.random() * 95);
        positions[stride] = Math.cos(angle) * radius;
        positions[stride + 1] = (Math.random() - 0.5) * 120;
        positions[stride + 2] = -760 - (Math.random() * 120);

        const tint = index % 3;
        colors[stride] = tint === 0 ? 1 : 0.4;
        colors[stride + 1] = tint === 1 ? 1 : 0.3;
        colors[stride + 2] = tint === 2 ? 1 : 0.9;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
            size: 2.4,
            vertexColors: true,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
}

export function createBlackHoleTranscendenceEnvironment() {
    const group = new THREE.Group();
    group.name = 'black-hole-transcendence-environment';
    group.userData.chapterId = 7;

    const chapterRange = getChapterPathRange(7);
    const fallbackCenterY = 875;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;

    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    const voidDome = createVoidDome();
    voidDome.position.z = -740;
    group.add(voidDome);

    group.add(createEventHorizon());
    group.add(createAccretionRings());
    group.add(createTranscendenceShards());

    group.position.y = chapterCenterY;
    return group;
}

export function updateBlackHoleTranscendenceEnvironment(group, delta, time, camera) {
    group.traverse((child) => {
        if (child.material?.uniforms?.uTime) {
            child.material.uniforms.uTime.value = time;
        }
    });

    const dome = group.children[0];
    if (dome) {
        dome.rotation.y += delta * 0.015;
    }

    const rings = group.children[2];
    if (rings?.children) {
        rings.children.forEach((ring, index) => {
            ring.rotation.z += delta * (0.18 + index * 0.07);
            ring.rotation.y += delta * 0.06 * (index % 2 === 0 ? 1 : -1);
        });
    }

    const shards = group.children[3];
    if (shards?.geometry?.attributes?.position) {
        const { array } = shards.geometry.attributes.position;
        const cameraY = camera?.position?.y ?? group.position.y;
        for (let index = 0; index < array.length; index += 3) {
            array[index + 1] += Math.sin(time * 0.6 + index * 0.1 + cameraY * 0.002) * 0.0025;
        }
        shards.geometry.attributes.position.needsUpdate = true;
    }
}

export default {
    config: BLACK_HOLE_TRANSCENDENCE_CONFIG,
    create: createBlackHoleTranscendenceEnvironment,
    update: updateBlackHoleTranscendenceEnvironment,
};
