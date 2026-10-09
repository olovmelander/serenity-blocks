/**
 * Winter — the snow ghosts, drawn.
 *
 * Every tree is an instance of one of the baked ghosts (winter-ghosts.js). The moon stands
 * behind them, so they are figures against the light: its light on the pillows turned to it,
 * a rim where the snow is thin enough to let it through, the sky's blue in the hollows, the
 * twilight's rose on the side turned to the horizon, and the dark of the boughs under each
 * pillow. They take the fires' colour from above as the chain grows, sparkle where they mirror
 * the moon, and flash as a ring of powder passes their foot.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    reflect,
    smoothstep,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import {
    wAir, wPow4, wRingLight, wSolidMaterial,
} from './winter-tsl.js';
import { ghostMesh } from './winter-ghosts.js';
import { snowGlint } from './winter-ground.js';

function ghostGeometry(mesh) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 4, true));
    geometry.setAttribute('aShade', new THREE.BufferAttribute(mesh.shade, 4, true));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    return geometry;
}

function ghostMaterial(u, { glints }) {
    const material = wSolidMaterial('WinterGhosts');
    const vShade = varying(attribute('aShade', 'vec4'), 'wGhostShade');
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const toEye = cameraPosition.sub(P);
        const V = toEye.div(max(length(toEye), 1e-3)).toVar();
        const shade = clamp(vShade, 0.0, 1.0);
        const open = shade.x;
        const needles = smoothstep(0.3, 0.62, shade.y);
        const thin = shade.z;

        // Rime is rough: the pillows' skin, from the noise's own slope.
        const skin = u.noise(vec2(P.x.add(P.z.mul(0.6)).mul(0.9), P.y.mul(0.9).add(P.z.mul(0.3))));
        const N = normalize(normalWorld.add(vec3(skin.g, skin.b.mul(0.6), skin.g.negate()).mul(0.22))).toVar();

        const ndl = dot(N, u.moonDir);
        const cavity = open.mul(open.mul(0.5).add(0.5));
        const moonLit = u.moonCol.mul(max(ndl, 0.0).mul(1.15)).mul(open);
        // Light that enters the far side of thin snow and comes out toward the eye.
        const behind = max(dot(V.negate(), u.moonDir), 0.0);
        const through = u.moonCol.mul(vec3(0.6, 0.82, 1.0)).mul(max(ndl.negate(), 0.0).mul(0.45).add(0.12))
            .mul(thin).mul(behind.mul(0.8).add(0.2))
            .mul(0.5);
        const facing = clamp(dot(N, V), 0.0, 1.0);
        const edge = float(1.0).sub(facing);
        const rim = u.moonCol.mul(edge.mul(edge).mul(edge)).mul(behind.mul(0.9).add(0.1)).mul(open).mul(0.75);
        const skyFill = u.shade.mul(N.y.mul(0.35).add(0.8)).add(u.zenith.mul(max(N.y, 0.0)).mul(0.55)).add(u.band.mul(0.14));
        const toGlow = normalize(vec3(u.glowDir.x, 0.25, u.glowDir.y));
        const rose = u.glow.mul(max(dot(N, toGlow), 0.0).mul(0.6).add(0.06));
        const burning = u.curtains.x.add(u.curtains.y).add(u.curtains.z).add(u.curtains.w);
        const fireLight = mix(u.fire, u.crown, 0.2).mul(burning.mul(0.05)).mul(max(N.y, 0.0).add(0.15)).mul(u.breath);
        const snow = vec3(0.9, 0.93, 1.0).mul(moonLit.add(through).add(rim).add(skyFill.add(rose).add(fireLight).mul(cavity)));

        // The boughs: nearly black, a little of the sky's light, snow dust where they face up.
        const bough = vec3(0.012, 0.03, 0.028).add(u.shade.mul(0.07)).add(u.moonCol.mul(max(ndl, 0.0)).mul(0.03))
            .mul(open.mul(0.6).add(0.4));
        const dusted = needles.mul(float(1.0).sub(smoothstep(0.25, 0.85, N.y).mul(0.75)));
        const col = mix(snow, bough, dusted).toVar();

        // A ring of powder passing the foot lights the tree, most on its edges.
        const ringNow = wRingLight(u, P);
        const foot = float(1.0).sub(smoothstep(0.02, 0.3, shade.w));
        col.addAssign(ringNow.rgb.mul(edge.mul(0.8).add(0.25)).mul(float(1.0).sub(dusted)).mul(foot).mul(0.55));

        if (glints) {
            const R = reflect(V.negate(), N);
            const lobe = wPow4(max(dot(R, u.moonDir), 0.0));
            const glint = snowGlint(u, P, lobe.mul(0.7), ringNow.a.mul(0.4));
            col.addAssign(u.moonCol.mul(glint.x).mul(glint.y.mul(4.0).add(1.5)).mul(float(1.0).sub(dusted)).mul(open)
                .mul(u.breath));
        }
        return wAir(u, col, P);
    })();
    return material;
}

/**
 * @param {object} u
 * @param {object} ghosts   loadGhosts() / planGhosts()
 * @param {object[]} trees  plantTrees()
 * @param {object} o
 * @param {number} o.ghostLod  the coarsest mesh the framing trees may use
 * @param {boolean} o.glints
 */
export function createTrees(u, ghosts, trees, { ghostLod = 0, glints = true } = {}) {
    const group = new THREE.Group();
    group.name = 'WinterGhosts';
    group.matrixAutoUpdate = false;
    const material = ghostMaterial(u, { glints });
    const geometries = [];
    const meshes = [];
    const dummy = new THREE.Object3D();
    let triangles = 0;

    const lay = (list) => {
        // One instanced mesh for each (kind, level of detail) that is planted.
        const buckets = new Map();
        list.forEach((tree) => {
            const lod = Math.max(tree.lod, tree.frame ? ghostLod : 0);
            const mesh = ghostMesh(ghosts, tree.kind, lod);
            if (!mesh) return;
            const key = `${mesh.kind}:${mesh.lod}`;
            if (!buckets.has(key)) buckets.set(key, { mesh, trees: [] });
            buckets.get(key).trees.push(tree);
        });
        return buckets;
    };

    const buckets = lay(trees);
    buckets.forEach(({ mesh, trees: members }, key) => {
        const geometry = ghostGeometry(mesh);
        geometries.push(geometry);
        const instanced = new THREE.InstancedMesh(geometry, material, members.length);
        instanced.name = `WinterGhosts:${key}`;
        instanced.frustumCulled = false;
        instanced.matrixAutoUpdate = false;
        instanced.renderOrder = mesh.lod <= 1 ? 0 : 1;
        instanced.userData.key = key;
        instanced.userData.height = mesh.height;
        meshes.push(instanced);
        group.add(instanced);
        triangles += (mesh.indices.length / 3) * members.length;
    });

    /** Put every instance where its tree stands (again, after the frame's shape changed). */
    const plant = (list) => {
        const again = lay(list);
        meshes.forEach((instanced) => {
            const bucket = again.get(instanced.userData.key);
            const members = bucket ? bucket.trees : [];
            const n = Math.min(members.length, instanced.instanceMatrix.count);
            for (let i = 0; i < n; i++) {
                const tree = members[i];
                dummy.position.set(tree.x, tree.y - 0.06, tree.z);
                dummy.rotation.set(0, tree.turn, 0);
                dummy.scale.setScalar(tree.height / instanced.userData.height);
                dummy.updateMatrix();
                instanced.setMatrixAt(i, dummy.matrix);
            }
            instanced.count = n;
            instanced.instanceMatrix.needsUpdate = true;
        });
    };
    plant(trees);

    return {
        mesh: group,
        material,
        geometry: { dispose: () => geometries.forEach((g) => g.dispose()) },
        plant,
        count: trees.length,
        triangles,
    };
}
