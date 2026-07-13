/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Serenity Warp — isolated composition study for the selectable intro theme.
 *
 * This intentionally keeps the playground workload small: the production theme
 * reuses the intro renderer's GPU compute simulation, while this deterministic
 * scene proves the art direction, safe central composition, materials, bloom,
 * and drifting tetromino silhouettes without booting the game.
 */
import * as THREE from 'three/webgpu';
import {
    color,
    float,
    pass,
    screenUV,
    smoothstep,
    vec2,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import { createIntroNebulaSky } from '../../ui/intro-nebula-sky.js';

export const meta = {
    id: 'serenity-warp',
    title: 'Serenity Warp',
    description: 'The intro nebula, crystalline drifting tetrominos, and chromatic starlight.',
};

const PIECE_COLORS = {
    I: 0x52ef32,
    O: 0xffa31a,
    T: 0x536dff,
    S: 0x35e6ef,
    Z: 0xff3b30,
    J: 0xffe23d,
    L: 0xd33bea,
};

const SHAPE_POINTS = {
    I: [[-4, -1], [4, -1], [4, 1], [-4, 1]],
    O: [[-2, -2], [2, -2], [2, 2], [-2, 2]],
    T: [[-3, -1], [3, -1], [3, 1], [1, 1], [1, 3], [-1, 3], [-1, 1], [-3, 1]],
    S: [[-3, -2], [1, -2], [1, 0], [3, 0], [3, 2], [-1, 2], [-1, 0], [-3, 0]],
    Z: [[-1, -2], [3, -2], [3, 0], [1, 0], [1, 2], [-3, 2], [-3, 0], [-1, 0]],
    J: [[-2, -3], [2, -3], [2, 3], [0, 3], [0, -1], [-2, -1]],
    L: [[-2, -3], [2, -3], [2, -1], [0, -1], [0, 3], [-2, 3]],
};

const PIECES = [
    {
        type: 'I', position: [-12.5, 6.5, -5], scale: 0.62, phase: 0.2, drift: [1.1, 0.8],
    },
    {
        type: 'T', position: [4.8, 6.2, -2], scale: 0.7, phase: 1.7, drift: [0.8, 1.1],
    },
    {
        type: 'Z', position: [13.8, 4.8, -7], scale: 0.55, phase: 2.8, drift: [1.3, 0.6],
    },
    {
        type: 'L', position: [-14.8, -5.2, -4], scale: 0.58, phase: 4.1, drift: [0.7, 1.0],
    },
    {
        type: 'S', position: [13.6, -5.7, -8], scale: 0.62, phase: 5.2, drift: [1.0, 0.8],
    },
    {
        type: 'O', position: [-7.8, -8.8, -12], scale: 0.48, phase: 3.4, drift: [0.8, 0.7],
    },
    {
        type: 'J', position: [7.5, -8.5, -10], scale: 0.5, phase: 0.9, drift: [0.9, 0.9],
    },
    {
        type: 'I', position: [-2.5, 11.5, -15], scale: 0.38, phase: 2.2, drift: [0.7, 0.5],
    },
    {
        type: 'T', position: [18.2, -0.8, -16], scale: 0.38, phase: 5.8, drift: [0.6, 0.8],
    },
];

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function createPieceGeometry(type) {
    const points = SHAPE_POINTS[type];
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
        shape.lineTo(points[i][0], points[i][1]);
    }
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 1.15,
        bevelEnabled: true,
        bevelSegments: 3,
        bevelSize: 0.16,
        bevelThickness: 0.16,
        curveSegments: 1,
    });
    geometry.center();
    return geometry;
}

function createPieceMaterials(hex) {
    const base = color(hex);
    const material = new THREE.MeshStandardNodeMaterial();
    material.colorNode = base;
    material.emissiveNode = base.mul(float(0.42));
    material.metalnessNode = float(0.18);
    material.roughnessNode = float(0.3);

    const glow = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
    });
    glow.colorNode = base.mul(float(1.25));
    glow.opacityNode = float(0.2);

    return { material, glow };
}

function createStars(count, seed) {
    const random = seededRandom(seed);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [
        new THREE.Color(0x75efff),
        new THREE.Color(0xff55c8),
        new THREE.Color(0xffdc5c),
        new THREE.Color(0x7aff98),
        new THREE.Color(0xa38cff),
    ];

    for (let i = 0; i < count; i += 1) {
        const i3 = i * 3;
        positions[i3] = (random() - 0.5) * 62;
        positions[i3 + 1] = (random() - 0.5) * 36;
        positions[i3 + 2] = -4 - random() * 42;

        const tint = palette[Math.floor(random() * palette.length)];
        colors[i3] = tint.r;
        colors[i3 + 1] = tint.g;
        colors[i3 + 2] = tint.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsNodeMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.82,
        size: 2.1,
        sizeAttenuation: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return { points, geometry, material };
}

export function create({
    scene,
    camera,
    renderer,
}) {
    const previousFog = scene.fog;
    const previousBackground = scene.background;
    const previousToneMapping = renderer.toneMapping;
    scene.background = new THREE.Color(0x02000d);
    scene.fog = new THREE.FogExp2(0x08051f, 0.007);
    renderer.toneMapping = THREE.NoToneMapping;

    camera.fov = 57;
    camera.near = 0.1;
    camera.far = 500;
    camera.position.set(0, 0, 40);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const root = new THREE.Group();
    scene.add(root);

    const nebula = createIntroNebulaSky({ radius: 190 });
    nebula.setIntensity(0.54);
    root.add(nebula.mesh);

    const stars = createStars(1200, 0x5e71e1);
    root.add(stars.points);

    const ambient = new THREE.AmbientLight(0x5140a8, 1.8);
    const cyanLight = new THREE.PointLight(0x63dbff, 2.1, 105);
    cyanLight.position.set(18, 16, 22);
    const violetLight = new THREE.PointLight(0xb14cff, 1.8, 105);
    violetLight.position.set(-20, -12, 14);
    root.add(ambient, cyanLight, violetLight);

    const geometryByType = new Map();
    const materialsByType = new Map();
    const pieceMeshes = PIECES.map((spec, index) => {
        let geometry = geometryByType.get(spec.type);
        if (!geometry) {
            geometry = createPieceGeometry(spec.type);
            geometryByType.set(spec.type, geometry);
        }

        let materials = materialsByType.get(spec.type);
        if (!materials) {
            materials = createPieceMaterials(PIECE_COLORS[spec.type]);
            materialsByType.set(spec.type, materials);
        }

        const group = new THREE.Group();
        const mesh = new THREE.Mesh(geometry, materials.material);
        const glowMesh = new THREE.Mesh(geometry, materials.glow);
        glowMesh.scale.setScalar(1.08);
        group.add(glowMesh, mesh);
        group.scale.setScalar(spec.scale);
        group.position.set(...spec.position);
        group.rotation.set(spec.phase * 0.17, spec.phase * 0.23, spec.phase * 0.31);
        group.userData = { ...spec, index };
        root.add(group);
        return group;
    });

    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    const bloomNode = bloom(sceneColor, 0.34, 0.58, 0.62);
    const edgeDistance = screenUV.sub(vec2(0.5)).length();
    const vignette = float(1).sub(smoothstep(0.24, 0.72, edgeDistance).mul(0.72));
    const graded = sceneColor.rgb.add(bloomNode.rgb).mul(0.78).mul(vignette);
    const post = new THREE.PostProcessing(renderer);
    post.outputNode = vec4(graded, sceneColor.a);
    post.needsUpdate = true;

    return {
        cameraRadius: 40,
        camera(time, activeCamera) {
            activeCamera.position.set(
                Math.sin(time * 0.11) * 1.15,
                Math.cos(time * 0.09) * 0.75,
                40 + Math.sin(time * 0.07) * 0.45,
            );
            activeCamera.lookAt(0, 0, -2);
        },
        update(time) {
            nebula.uniforms.uTime.value = time;
            nebula.uniforms.uPulse.value = Math.sin(time * 0.32) * 0.16 + 0.18;
            stars.points.rotation.z = time * 0.003;

            pieceMeshes.forEach((group) => {
                const spec = group.userData;
                group.position.x = spec.position[0] + Math.sin(time * 0.18 + spec.phase) * spec.drift[0];
                group.position.y = spec.position[1] + Math.cos(time * 0.15 + spec.phase) * spec.drift[1];
                group.rotation.x = spec.phase * 0.17 + time * (0.025 + spec.index * 0.0015);
                group.rotation.y = spec.phase * 0.23 + time * (0.035 + spec.index * 0.0012);
                group.rotation.z = spec.phase * 0.31 + time * (0.018 + spec.index * 0.001);
            });
        },
        render() {
            post.render();
        },
        renderAsync() {
            post.render();
            return Promise.resolve();
        },
        resize(width, height) {
            if (bloomNode?._separableBlurMaterials?.length) {
                bloomNode.setSize(width, height);
            }
        },
        dispose() {
            scene.remove(root);
            post.dispose();
            bloomNode.dispose?.();
            scenePass.dispose?.();
            nebula.dispose();
            stars.geometry.dispose();
            stars.material.dispose();
            geometryByType.forEach((geometry) => geometry.dispose());
            materialsByType.forEach(({ material, glow }) => {
                material.dispose();
                glow.dispose();
            });
            scene.fog = previousFog;
            scene.background = previousBackground;
            renderer.toneMapping = previousToneMapping;
        },
    };
}
