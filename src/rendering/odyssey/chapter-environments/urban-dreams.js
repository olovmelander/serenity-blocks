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

function createNeonCitySpire() {
    const group = new THREE.Group();
    group.name = 'neon-megastructure-spire';
    group.position.set(0, 14, -680);

    const coreMaterial = new THREE.MeshStandardMaterial({
        color: 0x080914,
        emissive: 0x00f2ff,
        emissiveIntensity: 0.45,
        roughness: 0.35,
        metalness: 0.75,
    });

    const tiers = [
        { height: 92, width: 18, y: 6 },
        { height: 64, width: 28, y: -20 },
        { height: 38, width: 42, y: -44 },
    ];

    tiers.forEach(({ height, width, y }, index) => {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, width * 0.55),
            coreMaterial.clone(),
        );
        mesh.position.y = y;
        mesh.material.emissive = new THREE.Color(index % 2 === 0 ? 0x00f2ff : 0xff3fb4);
        mesh.material.emissiveIntensity = 0.35 + index * 0.15;
        group.add(mesh);

        const frame = new THREE.Mesh(
            new THREE.TorusGeometry(width * 0.72, 0.8, 8, 72),
            new THREE.MeshBasicMaterial({
                color: index % 2 === 0 ? 0x00f2ff : 0xff3fb4,
                transparent: true,
                opacity: 0.42,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        frame.rotation.x = Math.PI * 0.5;
        frame.position.y = y + height * 0.42;
        group.add(frame);
    });

    const crown = new THREE.Mesh(
        new THREE.ConeGeometry(20, 42, 6),
        new THREE.MeshBasicMaterial({
            color: 0xff3fb4,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
    crown.position.y = 74;
    group.add(crown);

    return group;
}

function createHologramSigns() {
    const group = new THREE.Group();
    group.name = 'hologram-sign-stack';
    const configs = [
        {
            x: -92, y: 42, z: -615, w: 42, h: 12, color: 0x00f2ff,
        },
        {
            x: 88, y: 22, z: -640, w: 50, h: 15, color: 0xff3fb4,
        },
        {
            x: -52, y: -6, z: -585, w: 36, h: 11, color: 0xa66cff,
        },
        {
            x: 42, y: 62, z: -700, w: 58, h: 14, color: 0x00ffae,
        },
    ];

    configs.forEach((config, index) => {
        const material = new THREE.MeshBasicMaterial({
            color: config.color,
            transparent: true,
            opacity: 0.32,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(config.w, config.h), material);
        sign.position.set(config.x, config.y, config.z);
        sign.rotation.y = (index % 2 === 0 ? 1 : -1) * 0.18;
        sign.userData.baseOpacity = material.opacity;
        group.add(sign);

        const border = new THREE.Mesh(
            new THREE.TorusGeometry(Math.max(config.w, config.h) * 0.36, 0.35, 8, 64),
            new THREE.MeshBasicMaterial({
                color: config.color,
                transparent: true,
                opacity: 0.24,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        border.position.copy(sign.position);
        border.scale.y = config.h / config.w;
        border.rotation.copy(sign.rotation);
        group.add(border);
    });

    return group;
}

function createWetReflectionPlane() {
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(360, 180, 1, 1),
        new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec2 vUv;
                void main() {
                    float lanes = pow(abs(sin(vUv.x * 42.0)), 18.0);
                    float ripple = sin(vUv.y * 32.0 + uTime * 1.6) * 0.5 + 0.5;
                    vec3 cyan = vec3(0.0, 0.85, 1.0);
                    vec3 magenta = vec3(1.0, 0.18, 0.68);
                    vec3 color = mix(cyan, magenta, vUv.x) * (lanes * 0.45 + ripple * 0.08);
                    float fade = smoothstep(1.0, 0.1, vUv.y);
                    gl_FragColor = vec4(color, fade * 0.28);
                }
            `,
        }),
    );
    plane.name = 'wet-neon-reflection-plane';
    plane.position.set(0, -58, -610);
    plane.rotation.x = -Math.PI * 0.48;
    return plane;
}

function createSkyTraffic() {
    const group = new THREE.Group();
    group.name = 'sky-traffic-light-trails';
    const colors = [0x00f2ff, 0xff3fb4, 0xffd36f];

    for (let index = 0; index < 10; index += 1) {
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-170, 65 - index * 8, -700 - index * 8),
            new THREE.Vector3(-30, 82 - index * 5, -650 - index * 5),
            new THREE.Vector3(170, 48 - index * 6, -710 - index * 9),
        ]);
        const trail = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 24, 0.35, 6, false),
            new THREE.MeshBasicMaterial({
                color: colors[index % colors.length],
                transparent: true,
                opacity: 0.18,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        trail.userData.baseX = 0;
        trail.userData.speed = 0.12 + index * 0.018;
        group.add(trail);
    }

    return group;
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

    const rails = createNeonRails();
    group.add(rails);
    group.userData.rails = rails;

    const rain = createRainCurtain();
    group.add(rain);
    group.userData.rain = rain;

    const spire = createNeonCitySpire();
    group.add(spire);
    group.userData.spire = spire;

    const signs = createHologramSigns();
    group.add(signs);
    group.userData.signs = signs;

    const reflectionPlane = createWetReflectionPlane();
    group.add(reflectionPlane);
    group.userData.reflectionPlane = reflectionPlane;

    const traffic = createSkyTraffic();
    group.add(traffic);
    group.userData.traffic = traffic;

    group.position.y = chapterCenterY;
    return group;
}

export function updateUrbanDreamsEnvironment(group, delta, time, camera) {
    group.traverse((child) => {
        if (child.material?.uniforms?.uTime) {
            child.material.uniforms.uTime.value = time;
        }
    });

    const rails = group.userData.rails || group.children[2];
    if (rails?.children) {
        rails.children.forEach((ring, index) => {
            ring.rotation.z += delta * (0.18 + index * 0.05);
        });
    }

    const rain = group.userData.rain || group.children[3];
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

    const { spire, signs, traffic } = group.userData;
    if (spire) {
        spire.rotation.y = Math.sin(time * 0.18) * 0.08;
        spire.children.forEach((child, index) => {
            if (child.material?.emissiveIntensity !== undefined) {
                child.material.emissiveIntensity = 0.35 + Math.sin(time * 1.2 + index) * 0.12;
            } else if (child.material?.opacity !== undefined) {
                child.material.opacity = 0.38 + Math.sin(time * 1.8 + index) * 0.12;
            }
        });
    }

    if (signs?.children) {
        signs.children.forEach((sign, index) => {
            if (sign.material?.opacity !== undefined) {
                const base = sign.userData.baseOpacity || 0.22;
                sign.material.opacity = base + Math.sin(time * 3.5 + index * 1.7) * 0.08;
            }
        });
    }

    if (traffic?.children) {
        traffic.children.forEach((trail, index) => {
            trail.position.x = Math.sin(time * trail.userData.speed + index) * 18;
        });
    }
}

export default {
    config: URBAN_DREAMS_CONFIG,
    create: createUrbanDreamsEnvironment,
    update: updateUrbanDreamsEnvironment,
};
