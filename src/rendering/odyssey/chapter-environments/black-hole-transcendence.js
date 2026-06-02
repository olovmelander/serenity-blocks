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
    const group = new THREE.Group();
    group.name = 'dominant-event-horizon-anchor';
    group.position.set(0, 0, -780);

    const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(34, 64, 40),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    horizon.scale.set(1, 0.96, 0.82);
    group.add(horizon);

    const photonRing = new THREE.Mesh(
        new THREE.TorusGeometry(38, 2.2, 16, 192),
        new THREE.MeshBasicMaterial({
            color: 0xffd28a,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
    photonRing.scale.y = 0.24;
    photonRing.rotation.x = 0.08;
    group.add(photonRing);

    const diskColors = [0xff33cc, 0xff8844, 0x66e3ff, 0xffd28a];
    diskColors.forEach((color, index) => {
        const disk = new THREE.Mesh(
            new THREE.TorusGeometry(48 + index * 11, 1.6 + index * 0.55, 16, 192),
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.34 - index * 0.045,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        disk.scale.y = 0.16 + index * 0.025;
        disk.rotation.x = Math.PI * (0.03 + index * 0.015);
        disk.rotation.y = index * 0.17;
        group.add(disk);
    });

    const lensShell = new THREE.Mesh(
        new THREE.SphereGeometry(72, 48, 24),
        new THREE.MeshBasicMaterial({
            color: 0x66e3ff,
            transparent: true,
            opacity: 0.055,
            wireframe: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
    group.add(lensShell);

    return group;
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

function createLensingStarfield() {
    const count = 900;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        const angle = Math.random() * Math.PI * 2;
        const radius = 58 + Math.random() * 170;
        const bend = 1 + Math.sin(angle * 3.0) * 0.18;
        positions[stride] = Math.cos(angle) * radius * bend;
        positions[stride + 1] = Math.sin(angle) * radius * 0.42;
        positions[stride + 2] = -790 - Math.random() * 180;

        const hot = index % 4 === 0;
        colors[stride] = hot ? 1.0 : 0.55;
        colors[stride + 1] = hot ? 0.62 : 0.78;
        colors[stride + 2] = 1.0;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
            size: 2.0,
            vertexColors: true,
            transparent: true,
            opacity: 0.48,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
    points.name = 'lensing-starfield';
    return points;
}

function createInfallStreams() {
    const group = new THREE.Group();
    group.name = 'infall-streams';
    const colors = [0xff33cc, 0x66e3ff, 0xffb347];

    for (let index = 0; index < 9; index += 1) {
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-160 + index * 40, 85 - index * 11, -650 - index * 12),
            new THREE.Vector3(-72 + index * 18, 30 - index * 5, -720),
            new THREE.Vector3(-18 + index * 4, 5 - index * 2, -775),
        ]);
        const mesh = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 32, 0.7, 8, false),
            new THREE.MeshBasicMaterial({
                color: colors[index % colors.length],
                transparent: true,
                opacity: 0.22,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        mesh.userData.spin = (index % 2 === 0 ? 1 : -1) * (0.015 + index * 0.002);
        group.add(mesh);
    }

    return group;
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

    const eventHorizon = createEventHorizon();
    group.add(eventHorizon);
    group.userData.eventHorizon = eventHorizon;

    group.add(createAccretionRings());
    group.add(createTranscendenceShards());

    const lensingStarfield = createLensingStarfield();
    group.add(lensingStarfield);
    group.userData.lensingStarfield = lensingStarfield;

    const infallStreams = createInfallStreams();
    group.add(infallStreams);
    group.userData.infallStreams = infallStreams;

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

    const { eventHorizon } = group.userData;
    if (eventHorizon?.children) {
        eventHorizon.rotation.z -= delta * 0.08;
        eventHorizon.children.forEach((child, index) => {
            if (index > 0) {
                child.rotation.z += delta * (0.03 + index * 0.01);
            }
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

    const { lensingStarfield, infallStreams } = group.userData;
    if (lensingStarfield) {
        lensingStarfield.rotation.z += delta * 0.012;
    }
    if (infallStreams?.children) {
        infallStreams.children.forEach((stream) => {
            stream.rotation.z += delta * stream.userData.spin;
        });
    }
}

export default {
    config: BLACK_HOLE_TRANSCENDENCE_CONFIG,
    create: createBlackHoleTranscendenceEnvironment,
    update: updateBlackHoleTranscendenceEnvironment,
};
