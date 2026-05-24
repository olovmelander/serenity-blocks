/* eslint-disable import/no-extraneous-dependencies */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class NodeFileReader {
        readAsArrayBuffer(blob) {
            blob.arrayBuffer().then(
                (buffer) => {
                    this.result = buffer;
                    this.onloadend?.();
                },
                (error) => {
                    this.onerror?.(error);
                },
            );
        }

        readAsDataURL(blob) {
            blob.arrayBuffer().then(
                (buffer) => {
                    const mime = blob.type || 'application/octet-stream';
                    this.result = `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
                    this.onloadend?.();
                },
                (error) => {
                    this.onerror?.(error);
                },
            );
        }
    };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const faunaDir = path.join(repoRoot, 'src', 'themes', 'ocean', 'assets', 'fauna');

const assetContract = {
    sourceMode: 'self-generated',
    license: 'MIT-project-local',
    author: 'Serenity Blocks procedural asset generator',
    coordinateContract: 'local +X forward, Y up, origin at body center',
};

function material(name, color, {
    roughness = 0.72,
    metalness = 0,
    emissive = 0x000000,
    emissiveIntensity = 0,
    side = THREE.FrontSide,
} = {}) {
    const mat = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        emissive,
        emissiveIntensity,
        side,
    });
    mat.name = name;
    mat.userData = {
        aquaticMaterial: true,
        underwaterGrade: 'soft-rim-tinted',
    };
    return mat;
}

function addEllipsoid(parent, name, mat, position, scale, widthSegments = 32, heightSegments = 16) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, widthSegments, heightSegments), mat);
    mesh.name = name;
    mesh.position.fromArray(position);
    mesh.scale.fromArray(scale);
    parent.add(mesh);
    return mesh;
}

function addCone(parent, name, mat, position, scale, radialSegments = 32) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(1, 1, radialSegments, 1, false), mat);
    mesh.name = name;
    mesh.position.fromArray(position);
    mesh.rotation.z = -Math.PI * 0.5;
    mesh.scale.fromArray(scale);
    parent.add(mesh);
    return mesh;
}

function addFin(parent, name, mat, points) {
    const vertices = new Float32Array(points.flat());
    const indices = points.length === 3
        ? [0, 1, 2]
        : Array.from({ length: points.length - 2 }, (_, i) => [0, i + 1, i + 2]).flat();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
}

function addDiscPlate(parent, name, mat, position, scale, segments = 6) {
    const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 0.055, segments, 1, false),
        mat,
    );
    mesh.name = name;
    mesh.position.fromArray(position);
    mesh.scale.fromArray(scale);
    parent.add(mesh);
    return mesh;
}

function pivot(parent, name, position = [0, 0, 0]) {
    const group = new THREE.Group();
    group.name = name;
    group.position.fromArray(position);
    parent.add(group);
    return group;
}

function makeRoot(name, speciesId) {
    const root = new THREE.Group();
    root.name = name;
    root.userData = {
        serenityOceanFauna: {
            ...assetContract,
            speciesId,
            generatedAt: 'deterministic-v1',
        },
    };
    return root;
}

function quaternionTrack(name, times, eulers) {
    const values = [];
    eulers.forEach(([x, y, z]) => {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
        values.push(q.x, q.y, q.z, q.w);
    });
    return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values);
}

function positionTrack(name, times, positions) {
    return new THREE.VectorKeyframeTrack(`${name}.position`, times, positions.flat());
}

function makeClip(name, duration, tracks) {
    const clip = new THREE.AnimationClip(name, duration, tracks);
    clip.optimize();
    return clip;
}

function createShark() {
    const root = makeRoot('OceanRareSharkV2', 'rare-shark-v2');
    const bodyPivot = pivot(root, 'SharkBodySway');

    const bodyMat = material('shark blue grey skin', 0x547f84, { roughness: 0.66 });
    const flankMat = material('shark teal flank wash', 0x79aeb0, { roughness: 0.7 });
    const bellyMat = material('shark pale belly', 0xc8e1de, { roughness: 0.78 });
    const finMat = material('shark deep teal fins', 0x355a61, {
        roughness: 0.74,
        side: THREE.DoubleSide,
    });
    const markMat = material('shark gill and eye marks', 0x0b2630, { roughness: 0.82 });

    addEllipsoid(bodyPivot, 'SharkMainBody', bodyMat, [0, 0, 0], [2.85, 0.54, 0.42], 64, 24);
    addEllipsoid(bodyPivot, 'SharkHeadVolume', flankMat, [2.28, 0.02, 0], [0.82, 0.43, 0.35], 40, 18);
    addCone(bodyPivot, 'SharkSnoutWedge', flankMat, [2.9, 0.02, 0], [0.48, 0.86, 0.48], 36);
    addEllipsoid(bodyPivot, 'SharkBellyPlane', bellyMat, [0.36, -0.36, 0], [1.9, 0.14, 0.36], 32, 10);
    addEllipsoid(bodyPivot, 'SharkCaudalPeduncle', bodyMat, [-2.85, 0, 0], [0.88, 0.24, 0.2], 32, 12);

    addFin(bodyPivot, 'SharkDorsalFin', finMat, [
        [-0.45, 0.43, 0],
        [-0.05, 1.34, 0.02],
        [0.62, 0.34, 0],
    ]);
    addFin(bodyPivot, 'SharkRearDorsalFin', finMat, [
        [-1.78, 0.25, 0],
        [-1.5, 0.62, 0],
        [-1.18, 0.21, 0],
    ]);
    addFin(bodyPivot, 'SharkRightPectoralFin', finMat, [
        [0.8, -0.05, 0.34],
        [-0.1, -0.55, 1.35],
        [0.25, -0.18, 0.34],
    ]);
    addFin(bodyPivot, 'SharkLeftPectoralFin', finMat, [
        [0.8, -0.05, -0.34],
        [0.25, -0.18, -0.34],
        [-0.1, -0.55, -1.35],
    ]);
    addFin(bodyPivot, 'SharkVentralFin', finMat, [
        [-0.7, -0.4, 0],
        [-0.18, -0.92, 0],
        [0.15, -0.35, 0],
    ]);

    const tailPivot = pivot(bodyPivot, 'SharkTailPivot', [-3.38, 0, 0]);
    addFin(tailPivot, 'SharkUpperCaudalLobe', finMat, [
        [0, 0.12, 0],
        [-0.88, 0.82, 0.08],
        [-0.28, 0.12, 0.04],
    ]);
    addFin(tailPivot, 'SharkLowerCaudalLobe', finMat, [
        [0, -0.12, 0],
        [-0.28, -0.12, 0.04],
        [-0.8, -0.65, 0.08],
    ]);
    addEllipsoid(tailPivot, 'SharkTailCenter', finMat, [-0.28, 0, 0], [0.22, 0.14, 0.08], 16, 8);

    [-1, 1].forEach((side) => {
        addEllipsoid(
            bodyPivot,
            `SharkEye${side > 0 ? 'Right' : 'Left'}`,
            markMat,
            [2.78, 0.2, side * 0.28],
            [0.055, 0.05, 0.03],
            12,
            8,
        );
        for (let i = 0; i < 4; i++) {
            const mark = addFin(bodyPivot, `SharkGill${side > 0 ? 'Right' : 'Left'}${i + 1}`, markMat, [
                [2.18 - i * 0.11, 0.14, side * 0.36],
                [2.12 - i * 0.11, -0.1, side * 0.38],
                [2.08 - i * 0.11, 0.1, side * 0.37],
            ]);
            mark.renderOrder = 1;
        }
    });

    const times = [0, 0.5, 1, 1.5, 2, 2.5, 3];
    const clips = [
        makeClip('shark_s_curve_swim_loop', 3, [
            quaternionTrack('SharkBodySway', times, [
                [0, 0, 0],
                [0.018, -0.035, 0.012],
                [0, 0, 0],
                [-0.018, 0.035, -0.012],
                [0, 0, 0],
                [0.018, -0.035, 0.012],
                [0, 0, 0],
            ]),
            quaternionTrack('SharkTailPivot', times, [
                [0, 0, 0],
                [0, 0.33, 0],
                [0, 0, 0],
                [0, -0.33, 0],
                [0, 0, 0],
                [0, 0.33, 0],
                [0, 0, 0],
            ]),
            positionTrack('SharkBodySway', times, [
                [0, 0, 0],
                [0, 0.035, 0],
                [0, 0, 0],
                [0, -0.025, 0],
                [0, 0, 0],
                [0, 0.035, 0],
                [0, 0, 0],
            ]),
        ]),
    ];

    return { root, clips };
}

function createTurtle() {
    const root = makeRoot('OceanRareTurtleV2', 'rare-turtle-v2');
    const glidePivot = pivot(root, 'TurtleGlidePivot');

    const shellMat = material('turtle olive shell', 0x55725d, { roughness: 0.82 });
    const shellRidgeMat = material('turtle amber scute ridges', 0x9aa76b, { roughness: 0.86 });
    const bodyMat = material('turtle soft teal body', 0x789b91, { roughness: 0.78 });
    const bellyMat = material('turtle pale plastron', 0xc8c9a0, { roughness: 0.84 });
    const eyeMat = material('turtle eye marks', 0x162e2d, { roughness: 0.8 });
    const flipperMat = material('turtle flipper dark edge', 0x466d67, {
        roughness: 0.8,
        side: THREE.DoubleSide,
    });

    addEllipsoid(glidePivot, 'TurtleShellDome', shellMat, [0, 0.12, 0], [1.45, 0.42, 0.92], 56, 24);
    addEllipsoid(glidePivot, 'TurtlePlastron', bellyMat, [0.05, -0.24, 0], [1.25, 0.14, 0.64], 40, 12);
    addEllipsoid(glidePivot, 'TurtleHead', bodyMat, [1.58, 0.08, 0], [0.34, 0.27, 0.24], 32, 16);
    addEllipsoid(glidePivot, 'TurtleNeck', bodyMat, [1.23, -0.02, 0], [0.36, 0.17, 0.18], 24, 12);
    addEllipsoid(glidePivot, 'TurtleTailStub', bodyMat, [-1.42, -0.08, 0], [0.22, 0.12, 0.1], 18, 10);

    const scutePositions = [
        [0.55, 0.56, 0], [0.08, 0.6, 0], [-0.42, 0.54, 0],
        [0.36, 0.48, 0.38], [-0.2, 0.5, 0.42], [0.36, 0.48, -0.38], [-0.2, 0.5, -0.42],
        [0.8, 0.38, 0.32], [-0.72, 0.36, 0.3], [0.8, 0.38, -0.32], [-0.72, 0.36, -0.3],
    ];
    scutePositions.forEach((position, index) => {
        addDiscPlate(
            glidePivot,
            `TurtleScutePlate${index + 1}`,
            shellRidgeMat,
            position,
            [0.18 + (index % 3) * 0.03, 0.38, 0.13 + (index % 2) * 0.03],
            6,
        );
    });

    const frontRight = pivot(glidePivot, 'TurtleFrontRightFlipperPivot', [0.82, -0.07, 0.68]);
    addFin(frontRight, 'TurtleFrontRightFlipper', flipperMat, [
        [0.15, 0.04, 0],
        [-0.76, -0.18, 0.8],
        [0.34, -0.22, 0.22],
        [0.68, -0.05, 0.02],
    ]);
    const frontLeft = pivot(glidePivot, 'TurtleFrontLeftFlipperPivot', [0.82, -0.07, -0.68]);
    addFin(frontLeft, 'TurtleFrontLeftFlipper', flipperMat, [
        [0.15, 0.04, 0],
        [0.68, -0.05, -0.02],
        [0.34, -0.22, -0.22],
        [-0.76, -0.18, -0.8],
    ]);
    const rearRight = pivot(glidePivot, 'TurtleRearRightFlipperPivot', [-0.92, -0.12, 0.56]);
    addFin(rearRight, 'TurtleRearRightFlipper', flipperMat, [
        [0.28, 0.02, 0],
        [-0.54, -0.12, 0.45],
        [-0.06, -0.22, 0.16],
    ]);
    const rearLeft = pivot(glidePivot, 'TurtleRearLeftFlipperPivot', [-0.92, -0.12, -0.56]);
    addFin(rearLeft, 'TurtleRearLeftFlipper', flipperMat, [
        [0.28, 0.02, 0],
        [-0.06, -0.22, -0.16],
        [-0.54, -0.12, -0.45],
    ]);

    [-1, 1].forEach((side) => {
        addEllipsoid(
            glidePivot,
            `TurtleEye${side > 0 ? 'Right' : 'Left'}`,
            eyeMat,
            [1.82, 0.18, side * 0.16],
            [0.035, 0.035, 0.025],
            10,
            8,
        );
    });

    const times = [0, 0.7, 1.4, 2.1, 2.8, 3.5, 4.2];
    const clips = [
        makeClip('turtle_flipper_glide_loop', 4.2, [
            quaternionTrack('TurtleGlidePivot', times, [
                [0, 0, 0],
                [0.025, 0.018, 0.01],
                [0, 0, 0],
                [-0.018, -0.012, -0.008],
                [0, 0, 0],
                [0.025, 0.018, 0.01],
                [0, 0, 0],
            ]),
            quaternionTrack('TurtleFrontRightFlipperPivot', times, [
                [0.08, 0, -0.12],
                [-0.48, 0.1, 0.06],
                [-0.2, 0.02, 0.18],
                [0.22, -0.04, -0.02],
                [0.08, 0, -0.12],
                [-0.48, 0.1, 0.06],
                [0.08, 0, -0.12],
            ]),
            quaternionTrack('TurtleFrontLeftFlipperPivot', times, [
                [0.08, 0, 0.12],
                [-0.48, -0.1, -0.06],
                [-0.2, -0.02, -0.18],
                [0.22, 0.04, 0.02],
                [0.08, 0, 0.12],
                [-0.48, -0.1, -0.06],
                [0.08, 0, 0.12],
            ]),
            quaternionTrack('TurtleRearRightFlipperPivot', times, [
                [0.02, 0, -0.04],
                [-0.18, 0.06, 0.02],
                [0.08, 0, 0.05],
                [0.02, 0, -0.04],
                [-0.18, 0.06, 0.02],
                [0.08, 0, 0.05],
                [0.02, 0, -0.04],
            ]),
            quaternionTrack('TurtleRearLeftFlipperPivot', times, [
                [0.02, 0, 0.04],
                [-0.18, -0.06, -0.02],
                [0.08, 0, -0.05],
                [0.02, 0, 0.04],
                [-0.18, -0.06, -0.02],
                [0.08, 0, -0.05],
                [0.02, 0, 0.04],
            ]),
        ]),
    ];

    return { root, clips };
}

function createHeroFish({
    rootName,
    speciesId,
    bodyColor,
    accentColor,
    finColor,
    bodyScale,
    banner = false,
}) {
    const root = makeRoot(rootName, speciesId);
    const bodyPivot = pivot(root, `${speciesId}-body-sway`);
    const bodyMat = material(`${speciesId} body color`, bodyColor, { roughness: 0.72 });
    const accentMat = material(`${speciesId} accent panels`, accentColor, {
        roughness: 0.74,
        emissive: accentColor,
        emissiveIntensity: 0.015,
    });
    const finMat = material(`${speciesId} translucent fins`, finColor, {
        roughness: 0.78,
        side: THREE.DoubleSide,
    });
    const eyeMat = material(`${speciesId} eye marks`, 0x0a2934, { roughness: 0.82 });

    addEllipsoid(bodyPivot, `${speciesId}-body`, bodyMat, [0, 0, 0], bodyScale, 36, 18);
    addEllipsoid(
        bodyPivot,
        `${speciesId}-belly-flash`,
        accentMat,
        [0.2, -bodyScale[1] * 0.55, 0],
        [bodyScale[0] * 0.62, bodyScale[1] * 0.12, bodyScale[2] * 0.82],
        24,
        8,
    );
    addCone(
        bodyPivot,
        `${speciesId}-snout`,
        bodyMat,
        [bodyScale[0] * 0.92, 0.02, 0],
        [bodyScale[1] * 0.45, bodyScale[0] * 0.32, bodyScale[2] * 1.05],
        28,
    );

    const stripeCount = banner ? 3 : 2;
    for (let i = 0; i < stripeCount; i++) {
        const x = bodyScale[0] * (0.36 - i * 0.34);
        addFin(bodyPivot, `${speciesId}-body-panel-${i + 1}`, accentMat, [
            [x, bodyScale[1] * 0.58, bodyScale[2] * 1.01],
            [x - bodyScale[0] * 0.08, -bodyScale[1] * 0.52, bodyScale[2] * 1.02],
            [x + bodyScale[0] * 0.1, -bodyScale[1] * 0.48, bodyScale[2] * 1.02],
        ]);
        addFin(bodyPivot, `${speciesId}-body-panel-mirror-${i + 1}`, accentMat, [
            [x, bodyScale[1] * 0.58, -bodyScale[2] * 1.01],
            [x + bodyScale[0] * 0.1, -bodyScale[1] * 0.48, -bodyScale[2] * 1.02],
            [x - bodyScale[0] * 0.08, -bodyScale[1] * 0.52, -bodyScale[2] * 1.02],
        ]);
    }

    addFin(bodyPivot, `${speciesId}-dorsal-fin`, finMat, [
        [-bodyScale[0] * 0.18, bodyScale[1] * 0.66, 0],
        [bodyScale[0] * 0.06, bodyScale[1] * (banner ? 2.35 : 1.65), 0],
        [bodyScale[0] * 0.46, bodyScale[1] * 0.5, 0],
    ]);
    addFin(bodyPivot, `${speciesId}-ventral-fin`, finMat, [
        [-bodyScale[0] * 0.1, -bodyScale[1] * 0.62, 0],
        [bodyScale[0] * 0.18, -bodyScale[1] * (banner ? 1.72 : 1.24), 0],
        [bodyScale[0] * 0.46, -bodyScale[1] * 0.48, 0],
    ]);
    addFin(bodyPivot, `${speciesId}-right-pectoral`, finMat, [
        [bodyScale[0] * 0.18, -bodyScale[1] * 0.05, bodyScale[2] * 0.88],
        [-bodyScale[0] * 0.05, -bodyScale[1] * 0.7, bodyScale[2] * 1.9],
        [bodyScale[0] * 0.38, -bodyScale[1] * 0.24, bodyScale[2] * 0.92],
    ]);
    addFin(bodyPivot, `${speciesId}-left-pectoral`, finMat, [
        [bodyScale[0] * 0.18, -bodyScale[1] * 0.05, -bodyScale[2] * 0.88],
        [bodyScale[0] * 0.38, -bodyScale[1] * 0.24, -bodyScale[2] * 0.92],
        [-bodyScale[0] * 0.05, -bodyScale[1] * 0.7, -bodyScale[2] * 1.9],
    ]);

    const tailPivot = pivot(bodyPivot, `${speciesId}-tail-pivot`, [-bodyScale[0] * 1.06, 0, 0]);
    addFin(tailPivot, `${speciesId}-tail-upper`, finMat, [
        [0, bodyScale[1] * 0.16, 0],
        [-bodyScale[0] * 0.48, bodyScale[1] * 1.18, 0],
        [-bodyScale[0] * 0.16, bodyScale[1] * 0.1, 0],
    ]);
    addFin(tailPivot, `${speciesId}-tail-lower`, finMat, [
        [0, -bodyScale[1] * 0.16, 0],
        [-bodyScale[0] * 0.16, -bodyScale[1] * 0.1, 0],
        [-bodyScale[0] * 0.48, -bodyScale[1] * 1.18, 0],
    ]);
    if (banner) {
        addFin(tailPivot, `${speciesId}-banner-trailer`, finMat, [
            [-bodyScale[0] * 0.18, -bodyScale[1] * 0.22, 0],
            [-bodyScale[0] * 0.76, -bodyScale[1] * 2.4, 0.02],
            [-bodyScale[0] * 0.02, -bodyScale[1] * 0.2, 0],
        ]);
    }

    [-1, 1].forEach((side) => {
        addEllipsoid(
            bodyPivot,
            `${speciesId}-eye-${side > 0 ? 'right' : 'left'}`,
            eyeMat,
            [bodyScale[0] * 0.86, bodyScale[1] * 0.16, side * bodyScale[2] * 0.78],
            [0.035, 0.035, 0.02],
            10,
            8,
        );
    });

    const duration = banner ? 1.8 : 1.55;
    const times = [0, duration * 0.25, duration * 0.5, duration * 0.75, duration];
    const clips = [
        makeClip(`${speciesId}_tail_body_swim_loop`, duration, [
            quaternionTrack(`${speciesId}-body-sway`, times, [
                [0, 0, 0],
                [0.01, -0.045, 0.01],
                [0, 0, 0],
                [-0.01, 0.045, -0.01],
                [0, 0, 0],
            ]),
            quaternionTrack(`${speciesId}-tail-pivot`, times, [
                [0, 0, 0],
                [0, 0.42, 0],
                [0, 0, 0],
                [0, -0.42, 0],
                [0, 0, 0],
            ]),
            positionTrack(`${speciesId}-body-sway`, times, [
                [0, 0, 0],
                [0, 0.015, 0],
                [0, 0, 0],
                [0, -0.015, 0],
                [0, 0, 0],
            ]),
        ]),
    ];

    return { root, clips };
}

function parseGlbJson(buffer) {
    const magic = buffer.readUInt32LE(0);
    if (magic !== 0x46546c67) throw new Error('Not a binary glTF asset');
    const jsonLength = buffer.readUInt32LE(12);
    const jsonType = buffer.readUInt32LE(16);
    if (jsonType !== 0x4e4f534a) throw new Error('Missing glTF JSON chunk');
    return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
}

function countTriangles(json) {
    return (json.meshes || []).reduce((sum, mesh) => {
        const meshTriangles = (mesh.primitives || []).reduce((primitiveSum, primitive) => {
            const mode = primitive.mode ?? 4;
            if (mode !== 4) return primitiveSum;
            if (Number.isInteger(primitive.indices)) {
                const accessor = json.accessors?.[primitive.indices];
                return primitiveSum + Math.floor((accessor?.count || 0) / 3);
            }
            const positionAccessor = json.accessors?.[primitive.attributes?.POSITION];
            return primitiveSum + Math.floor((positionAccessor?.count || 0) / 3);
        }, 0);
        return sum + meshTriangles;
    }, 0);
}

async function exportGlb(fileName, asset) {
    const exporter = new GLTFExporter();
    const glb = await new Promise((resolve, reject) => {
        exporter.parse(
            asset.root,
            resolve,
            reject,
            {
                binary: true,
                animations: asset.clips,
                onlyVisible: true,
                trs: true,
            },
        );
    });
    const buffer = Buffer.from(glb);
    await fs.writeFile(path.join(faunaDir, fileName), buffer);
    const json = parseGlbJson(buffer);
    return {
        fileName,
        bytes: buffer.byteLength,
        triangles: countTriangles(json),
        animations: (json.animations || []).map((animation) => animation.name || '(unnamed)'),
        meshes: json.meshes?.length || 0,
        materials: json.materials?.length || 0,
        textures: json.textures?.length || 0,
    };
}

async function main() {
    await fs.mkdir(faunaDir, { recursive: true });
    const assets = [
        ['rare-shark-v2.glb', createShark()],
        ['rare-turtle-v2.glb', createTurtle()],
        [
            'hero-reef-fish.glb',
            createHeroFish({
                rootName: 'OceanHeroReefFish',
                speciesId: 'hero-reef-fish',
                bodyColor: 0x16a8b8,
                accentColor: 0xffc45e,
                finColor: 0x0f6f8c,
                bodyScale: [0.88, 0.34, 0.18],
            }),
        ],
        [
            'hero-bannerfish.glb',
            createHeroFish({
                rootName: 'OceanHeroBannerfish',
                speciesId: 'hero-bannerfish',
                bodyColor: 0xffe58a,
                accentColor: 0x15394f,
                finColor: 0xf7f1c4,
                bodyScale: [0.78, 0.42, 0.14],
                banner: true,
            }),
        ],
    ];

    const report = [];
    for (const [fileName, asset] of assets) {
        report.push(await exportGlb(fileName, asset));
    }
    console.table(report);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
angularSharpness: 1.4,
    });

// ── Splashguard ridge in front of the (visual) blowhole ──
addEllipsoid(bodyPivot, 'WhaleSplashguard', bodyMat,
    [4.6, 0.82, 0], [0.28, 0.08, 0.22], 16, 8);

// ── Mouth slit along the lower jaw line, with a baleen strip behind it ──
addFin(bodyPivot, 'WhaleMouthline', mouthlineMat, [
    [6.05, -0.08, 0.42],
    [5.30, -0.18, 0.78],
    [4.40, -0.22, 0.88],
    [4.40, -0.22, -0.88],
    [5.30, -0.18, -0.78],
    [6.05, -0.08, -0.42],
]);
addFin(bodyPivot, 'WhaleBaleenStrip', baleenMat, [
    [5.95, -0.02, 0.36],
    [5.20, -0.10, 0.72],
    [4.55, -0.14, 0.82],
    [4.55, -0.14, -0.82],
    [5.20, -0.10, -0.72],
    [5.95, -0.02, -0.36],
]);

// ── Dorsal fin: small, hooked, set ~⅔ back along the body ──
buildAirfoilFin(bodyPivot, 'WhaleDorsalFin', finMat, {
    base: [-2.85, 0.85, 0],
    tip: [-2.95, 1.20, 0],
    rootChord: [-0.85, 0, 0],
    tipChord: [-0.32, -0.04, 0],
    thickness: [0, 0, 1],
    rootThickness: 0.10,
    tipThickness: 0.0,
    spanSegments: 5,
    chordSegments: 6,
});

// ── Pectoral fins: long, narrow paddles (~2.4m), gentle downward sweep ──
[-1, 1].forEach((side) => {
    buildAirfoilFin(bodyPivot, `Whale${side > 0 ? 'Right' : 'Left'}PectoralFin`, finMat, {
        base: [2.30, -0.40, side * 0.78],
        tip: [0.85, -0.78, side * 2.45],
        rootChord: [-0.65, -0.04, 0],
        tipChord: [-0.30, -0.02, 0],
        thickness: [0, 1, 0],
        rootThickness: 0.14,
        tipThickness: 0.0,
        spanSegments: 8,
        chordSegments: 7,
    });
});

// ── Peduncle pivot (kept for animation track binding) ──
const pedunclePivot = pivot(bodyPivot, 'WhalePedunclePivot', [-5.6, 0, 0]);

// ── Fluke: two horizontal lobes meeting at a slight notch, upcurled tips ──
const flukePivot = pivot(pedunclePivot, 'WhaleFlukePivot', [-1.2, 0, 0]);
[-1, 1].forEach((side) => {
    buildAirfoilFin(flukePivot, `WhaleFluke${side > 0 ? 'Right' : 'Left'}`, finMat, {
        base: [0.05, 0, side * 0.12],
        tip: [-0.55, 0.18, side * 2.45],
        rootChord: [-0.50, -0.02, 0],
        tipChord: [-0.18, -0.02, 0],
        thickness: [0, 1, 0],
        rootThickness: 0.16,
        tipThickness: 0.0,
        spanSegments: 8,
        chordSegments: 7,
    });
});

// ── Eyes (tiny relative to head) with catchlights ──
[-1, 1].forEach((side) => {
    addEyeSocket(
        bodyPivot,
        `Whale${side > 0 ? 'Right' : 'Left'}`,
        [5.30, 0.12, side * 0.66],
        [0, 0, side],
        0.075,
    );
});

// ── Animation: slow majestic undulation ──
const duration = 6.0;
const times = [0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
const clips = [
    makeClip('whale_body_undulation_loop', duration, [
        // Whole body: gentle roll and pitch
        quaternionTrack('WhaleBodySway', times, [
            [0, 0, 0],
            [0.012, -0.018, 0.008],
            [0, 0, 0],
            [-0.012, 0.018, -0.008],
            [0, 0, 0],
            [0.012, -0.018, 0.008],
            [0, 0, 0],
        ]),
        positionTrack('WhaleBodySway', times, [
            [0, 0, 0],
            [0, 0.06, 0],
            [0, 0, 0],
            [0, -0.04, 0],
            [0, 0, 0],
            [0, 0.06, 0],
            [0, 0, 0],
        ]),
        // Peduncle: slow power stroke
        quaternionTrack('WhalePedunclePivot', times, [
            [0.02, 0, 0],
            [-0.06, 0, 0],
            [0.04, 0, 0],
            [-0.06, 0, 0],
            [0.02, 0, 0],
            [-0.06, 0, 0],
            [0.02, 0, 0],
        ]),
        // Fluke: follows peduncle with delay
        quaternionTrack('WhaleFlukePivot', times, [
            [-0.04, 0, 0],
            [0.1, 0, 0],
            [-0.08, 0, 0],
            [0.1, 0, 0],
            [-0.04, 0, 0],
            [0.1, 0, 0],
            [-0.04, 0, 0],
        ]),
    ]),
];

return { root, clips };
}

function createHeroFish({
    rootName,
    speciesId,
    bodyColor,
    accentColor,
    finColor,
    bodyScale,
    banner = false,
}) {
    const root = makeRoot(rootName, speciesId);
    const bodyPivot = pivot(root, `${speciesId}-body-sway`);
    const bodyMat = material(`${speciesId} body color`, bodyColor, { roughness: 0.72 });
    const accentMat = material(`${speciesId} accent panels`, accentColor, {
        roughness: 0.74,
        emissive: accentColor,
        emissiveIntensity: 0.015,
    });
    const finMat = material(`${speciesId} translucent fins`, finColor, {
        roughness: 0.78,
        side: THREE.DoubleSide,
    });
    const eyeMat = material(`${speciesId} eye marks`, 0x0a2934, { roughness: 0.82 });

    addEllipsoid(bodyPivot, `${speciesId}-body`, bodyMat, [0, 0, 0], bodyScale, 36, 18);
    addEllipsoid(
        bodyPivot,
        `${speciesId}-belly-flash`,
        accentMat,
        [0.2, -bodyScale[1] * 0.55, 0],
        [bodyScale[0] * 0.62, bodyScale[1] * 0.12, bodyScale[2] * 0.82],
        24,
        8,
    );
    addCone(
        bodyPivot,
        `${speciesId}-snout`,
        bodyMat,
        [bodyScale[0] * 0.92, 0.02, 0],
        [bodyScale[1] * 0.45, bodyScale[0] * 0.32, bodyScale[2] * 1.05],
        28,
    );

    const stripeCount = banner ? 3 : 2;
    for (let i = 0; i < stripeCount; i++) {
        const x = bodyScale[0] * (0.36 - i * 0.34);
        addFin(bodyPivot, `${speciesId}-body-panel-${i + 1}`, accentMat, [
            [x, bodyScale[1] * 0.58, bodyScale[2] * 1.01],
            [x - bodyScale[0] * 0.08, -bodyScale[1] * 0.52, bodyScale[2] * 1.02],
            [x + bodyScale[0] * 0.1, -bodyScale[1] * 0.48, bodyScale[2] * 1.02],
        ]);
        addFin(bodyPivot, `${speciesId}-body-panel-mirror-${i + 1}`, accentMat, [
            [x, bodyScale[1] * 0.58, -bodyScale[2] * 1.01],
            [x + bodyScale[0] * 0.1, -bodyScale[1] * 0.48, -bodyScale[2] * 1.02],
            [x - bodyScale[0] * 0.08, -bodyScale[1] * 0.52, -bodyScale[2] * 1.02],
        ]);
    }

    addFin(bodyPivot, `${speciesId}-dorsal-fin`, finMat, [
        [-bodyScale[0] * 0.18, bodyScale[1] * 0.66, 0],
        [bodyScale[0] * 0.06, bodyScale[1] * (banner ? 2.35 : 1.65), 0],
        [bodyScale[0] * 0.46, bodyScale[1] * 0.5, 0],
    ]);
    addFin(bodyPivot, `${speciesId}-ventral-fin`, finMat, [
        [-bodyScale[0] * 0.1, -bodyScale[1] * 0.62, 0],
        [bodyScale[0] * 0.18, -bodyScale[1] * (banner ? 1.72 : 1.24), 0],
        [bodyScale[0] * 0.46, -bodyScale[1] * 0.48, 0],
    ]);
    addFin(bodyPivot, `${speciesId}-right-pectoral`, finMat, [
        [bodyScale[0] * 0.18, -bodyScale[1] * 0.05, bodyScale[2] * 0.88],
        [-bodyScale[0] * 0.05, -bodyScale[1] * 0.7, bodyScale[2] * 1.9],
        [bodyScale[0] * 0.38, -bodyScale[1] * 0.24, bodyScale[2] * 0.92],
    ]);
    addFin(bodyPivot, `${speciesId}-left-pectoral`, finMat, [
        [bodyScale[0] * 0.18, -bodyScale[1] * 0.05, -bodyScale[2] * 0.88],
        [bodyScale[0] * 0.38, -bodyScale[1] * 0.24, -bodyScale[2] * 0.92],
        [-bodyScale[0] * 0.05, -bodyScale[1] * 0.7, -bodyScale[2] * 1.9],
    ]);

    const tailPivot = pivot(bodyPivot, `${speciesId}-tail-pivot`, [-bodyScale[0] * 1.06, 0, 0]);
    addFin(tailPivot, `${speciesId}-tail-upper`, finMat, [
        [0, bodyScale[1] * 0.16, 0],
        [-bodyScale[0] * 0.48, bodyScale[1] * 1.18, 0],
        [-bodyScale[0] * 0.16, bodyScale[1] * 0.1, 0],
    ]);
    addFin(tailPivot, `${speciesId}-tail-lower`, finMat, [
        [0, -bodyScale[1] * 0.16, 0],
        [-bodyScale[0] * 0.16, -bodyScale[1] * 0.1, 0],
        [-bodyScale[0] * 0.48, -bodyScale[1] * 1.18, 0],
    ]);
    if (banner) {
        addFin(tailPivot, `${speciesId}-banner-trailer`, finMat, [
            [-bodyScale[0] * 0.18, -bodyScale[1] * 0.22, 0],
            [-bodyScale[0] * 0.76, -bodyScale[1] * 2.4, 0.02],
            [-bodyScale[0] * 0.02, -bodyScale[1] * 0.2, 0],
        ]);
    }

    [-1, 1].forEach((side) => {
        addEllipsoid(
            bodyPivot,
            `${speciesId}-eye-${side > 0 ? 'right' : 'left'}`,
            eyeMat,
            [bodyScale[0] * 0.86, bodyScale[1] * 0.16, side * bodyScale[2] * 0.78],
            [0.035, 0.035, 0.02],
            10,
            8,
        );
    });

    const duration = banner ? 1.8 : 1.55;
    const times = [0, duration * 0.25, duration * 0.5, duration * 0.75, duration];
    const clips = [
        makeClip(`${speciesId}_tail_body_swim_loop`, duration, [
            quaternionTrack(`${speciesId}-body-sway`, times, [
                [0, 0, 0],
                [0.01, -0.045, 0.01],
                [0, 0, 0],
                [-0.01, 0.045, -0.01],
                [0, 0, 0],
            ]),
            quaternionTrack(`${speciesId}-tail-pivot`, times, [
                [0, 0, 0],
                [0, 0.42, 0],
                [0, 0, 0],
                [0, -0.42, 0],
                [0, 0, 0],
            ]),
            positionTrack(`${speciesId}-body-sway`, times, [
                [0, 0, 0],
                [0, 0.015, 0],
                [0, 0, 0],
                [0, -0.015, 0],
                [0, 0, 0],
            ]),
        ]),
    ];

    return { root, clips };
}

function parseGlbJson(buffer) {
    const magic = buffer.readUInt32LE(0);
    if (magic !== 0x46546c67) throw new Error('Not a binary glTF asset');
    const jsonLength = buffer.readUInt32LE(12);
    const jsonType = buffer.readUInt32LE(16);
    if (jsonType !== 0x4e4f534a) throw new Error('Missing glTF JSON chunk');
    return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
}

function countTriangles(json) {
    return (json.meshes || []).reduce((sum, mesh) => {
        const meshTriangles = (mesh.primitives || []).reduce((primitiveSum, primitive) => {
            const mode = primitive.mode ?? 4;
            if (mode !== 4) return primitiveSum;
            if (Number.isInteger(primitive.indices)) {
                const accessor = json.accessors?.[primitive.indices];
                return primitiveSum + Math.floor((accessor?.count || 0) / 3);
            }
            const positionAccessor = json.accessors?.[primitive.attributes?.POSITION];
            return primitiveSum + Math.floor((positionAccessor?.count || 0) / 3);
        }, 0);
        return sum + meshTriangles;
    }, 0);
}

async function exportGlb(fileName, asset) {
    const exporter = new GLTFExporter();
    const glb = await new Promise((resolve, reject) => {
        exporter.parse(
            asset.root,
            resolve,
            reject,
            {
                binary: true,
                animations: asset.clips,
                onlyVisible: true,
                trs: true,
            },
        );
    });
    const buffer = Buffer.from(glb);
    await fs.writeFile(path.join(faunaDir, fileName), buffer);
    const json = parseGlbJson(buffer);
    return {
        fileName,
        bytes: buffer.byteLength,
        triangles: countTriangles(json),
        animations: (json.animations || []).map((animation) => animation.name || '(unnamed)'),
        meshes: json.meshes?.length || 0,
        materials: json.materials?.length || 0,
        textures: json.textures?.length || 0,
    };
}

async function main() {
    await fs.mkdir(faunaDir, { recursive: true });
    const assets = [
        ['rare-shark-v2.glb', createShark()],
        ['rare-turtle-v2.glb', createTurtle()],
        ['rare-blue-whale-v1.glb', createBlueWhale()],
        [
            'hero-reef-fish.glb',
            createHeroFish({
                rootName: 'OceanHeroReefFish',
                speciesId: 'hero-reef-fish',
                bodyColor: 0x16a8b8,
                accentColor: 0xffc45e,
                finColor: 0x0f6f8c,
                bodyScale: [0.88, 0.34, 0.18],
            }),
        ],
        [
            'hero-bannerfish.glb',
            createHeroFish({
                rootName: 'OceanHeroBannerfish',
                speciesId: 'hero-bannerfish',
                bodyColor: 0xffe58a,
                accentColor: 0x15394f,
                finColor: 0xf7f1c4,
                bodyScale: [0.78, 0.42, 0.14],
                banner: true,
            }),
        ],
    ];

    const report = [];
    for (const [fileName, asset] of assets) {
        report.push(await exportGlb(fileName, asset));
    }
    console.table(report);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
