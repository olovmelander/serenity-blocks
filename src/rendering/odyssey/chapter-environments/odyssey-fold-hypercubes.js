/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE HYPERCUBES — chapter 7's other dimension, step 4 (2026-10-26;
 * docs/ODYSSEY_CH7_FOLD_2026-10.md). Round every orb that parks inside the hole, a true
 * four-dimensional cube turning through the fourth dimension: its sixteen corners rotated in 4D
 * (in the x-w, y-w and z-w planes, and x-y) and projected into this space in perspective from a
 * point out along w, so its inner cube swells through the outer and turns it inside out, the way
 * no object in three dimensions can.
 *
 * Drawn as light: each of its 32 edges a ribbon turned to face the eye, built on the CPU every
 * frame (a few hundred vertices), additive, with a soft glowing profile. Three-free maths in
 * `hypercubeEdges` (tested); `createFoldHypercubes` draws a set of them.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, exp, float, uniform, vec3, vec4,
} from 'three/tsl';

/** The 16 corners of the unit hypercube (+-1 in x, y, z, w). */
const CORNERS = Array.from({ length: 16 }, (_, i) => [
    (i & 1) ? 1 : -1,
    (i & 2) ? 1 : -1,
    (i & 4) ? 1 : -1,
    (i & 8) ? 1 : -1,
]);

/** The 32 edges: corner pairs differing in exactly one coordinate. */
export const HYPERCUBE_EDGES = Object.freeze((() => {
    const edges = [];
    for (let a = 0; a < 16; a += 1) {
        for (let bit = 0; bit < 4; bit += 1) {
            const b = a ^ (1 << bit);
            if (b > a) edges.push([a, b]);
        }
    }
    return edges;
})());

export const CH7_HYPERCUBE = Object.freeze({
    /** Turn rates (rad/s) in the x-w, y-w, z-w and x-y planes. */
    turn: Object.freeze([0.31, 0.19, 0.13, 0.07]),
    /** The eye's distance out along w for the 4D -> 3D perspective (larger = flatter). */
    eyeW: 2.6,
    /** Ribbon half-width as a share of the cube's size, and the edge light. */
    width: 0.035,
    gain: 1.1,
});

const rotate = (v, i, j, a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = v[i];
    const y = v[j];
    v[i] = (x * c) - (y * s);
    v[j] = (x * s) + (y * c);
};

/**
 * The hypercube's 32 edges in 3D at time `t` (seconds), for a cube of `size` (half-width of the
 * projected outer cube at rest), as [[x0,y0,z0, x1,y1,z1], ...] about the origin.
 * @param {number} t
 * @param {number} [size]
 * @param {number} [phase] per-cube offset (rad)
 * @returns {number[][]}
 */
export function hypercubeEdges(t, size = 1, phase = 0) {
    const projected = projectHypercubeCorners(t, size, phase, new Array(48));
    return HYPERCUBE_EDGES.map(([i, j]) => [
        projected[i * 3], projected[(i * 3) + 1], projected[(i * 3) + 2],
        projected[j * 3], projected[(j * 3) + 1], projected[(j * 3) + 2],
    ]);
}

const cornerScratch = [0, 0, 0, 0];

/**
 * The 16 projected corners into `out` (x, y, z each), the arithmetic of hypercubeEdges to the
 * bit, with nothing allocated: the frame loop's own path (it ran ~320 throwaway arrays per cube
 * per frame, ~2,600 for the eight).
 * @param {number} t
 * @param {number} size
 * @param {number} phase
 * @param {number[]|Float64Array} out 48 numbers
 * @returns {number[]|Float64Array} out
 */
export function projectHypercubeCorners(t, size, phase, out) {
    const [a, b, c, d] = CH7_HYPERCUBE.turn;
    const { eyeW } = CH7_HYPERCUBE;
    const v = cornerScratch;
    for (let n = 0; n < 16; n += 1) {
        const corner = CORNERS[n];
        v[0] = corner[0];
        v[1] = corner[1];
        v[2] = corner[2];
        v[3] = corner[3];
        rotate(v, 0, 3, (t * a) + phase);
        rotate(v, 1, 3, (t * b) + (phase * 0.7));
        rotate(v, 2, 3, (t * c) + (phase * 0.4));
        rotate(v, 0, 1, (t * d) + (phase * 1.3));
        const k = (size / (eyeW - v[3])) * (eyeW - 1);
        out[n * 3] = v[0] * k;
        out[(n * 3) + 1] = v[1] * k;
        out[(n * 3) + 2] = v[2] * k;
    }
    return out;
}

/**
 * A set of hypercubes drawn as light.
 * @param {{ count?: number }} [opts]
 * @returns {{ mesh: THREE.Mesh, update: (camera: THREE.Camera, time: number,
 *   cubes: Array<{ position: THREE.Vector3, size: number, presence: number, phase?: number,
 *   colour?: THREE.Color }>) => void, dispose: () => void }}
 */
export function createFoldHypercubes({ count = 8 } = {}) {
    const E = HYPERCUBE_EDGES.length;
    const verts = count * E * 4;
    const position = new Float32Array(verts * 3);
    const across = new Float32Array(verts);
    const colour = new Float32Array(verts * 4);
    const index = new Uint32Array(count * E * 6);
    for (let q = 0; q < count * E; q += 1) {
        const v = q * 4;
        index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], q * 6);
        across.set([-1, 1, -1, 1], v);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
    geometry.setAttribute('aColour', new THREE.BufferAttribute(colour, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const uGain = uniform(CH7_HYPERCUBE.gain);
    const material = new THREE.MeshBasicNodeMaterial();
    const x = attribute('aAcross');
    const tint = attribute('aColour');
    // A hot core and a soft glow across the ribbon.
    const profile = exp(x.mul(x).mul(-9.0)).add(exp(x.mul(x).mul(-2.2)).mul(0.25));
    material.colorNode = vec3(tint.xyz).mul(profile).mul(tint.w).mul(uGain);
    material.outputNode = vec4(vec3(tint.xyz).mul(profile).mul(tint.w).mul(uGain), float(0));
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-fold-hypercubes';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const toEye = new THREE.Vector3();
    const side = new THREE.Vector3();
    const white = new THREE.Color(1, 1, 1);
    const corners = new Array(48);
    const writeVertex = (vertex, p, sx, sy, sz, sign) => {
        const o = vertex * 3;
        position[o] = p.x + (sign * sx);
        position[o + 1] = p.y + (sign * sy);
        position[o + 2] = p.z + (sign * sz);
    };

    function update(camera, time, cubes) {
        const n = Math.min(count, cubes?.length ?? 0);
        // Nothing to draw: hidden, and no buffer rewritten or uploaded (it is rewritten in full
        // before it shows again).
        if (n === 0) {
            mesh.visible = false;
            return;
        }
        const posAttr = geometry.getAttribute('position');
        const colAttr = geometry.getAttribute('aColour');
        colour.fill(0);
        for (let k = 0; k < n; k += 1) {
            const cube = cubes[k];
            if (!cube || !(cube.presence > 0.001)) continue;
            projectHypercubeCorners(time, cube.size, cube.phase ?? (k * 1.7), corners);
            const tintColour = cube.colour ?? white;
            const half = cube.size * CH7_HYPERCUBE.width;
            for (let j = 0; j < E; j += 1) {
                const i0 = HYPERCUBE_EDGES[j][0] * 3;
                const i1 = HYPERCUBE_EDGES[j][1] * 3;
                a.set(corners[i0], corners[i0 + 1], corners[i0 + 2]).add(cube.position);
                b.set(corners[i1], corners[i1 + 1], corners[i1 + 2]).add(cube.position);
                dir.subVectors(b, a);
                toEye.subVectors(camera.position, a);
                side.crossVectors(dir, toEye);
                const len = side.length();
                if (len < 1e-9) side.set(0, 0, 0);
                else side.multiplyScalar(half / len);
                const v = ((k * E) + j) * 4;
                writeVertex(v, a, side.x, side.y, side.z, -1);
                writeVertex(v + 1, a, side.x, side.y, side.z, 1);
                writeVertex(v + 2, b, side.x, side.y, side.z, -1);
                writeVertex(v + 3, b, side.x, side.y, side.z, 1);
                for (let m = 0; m < 4; m += 1) {
                    const o = (v + m) * 4;
                    colour[o] = tintColour.r;
                    colour[o + 1] = tintColour.g;
                    colour[o + 2] = tintColour.b;
                    colour[o + 3] = cube.presence;
                }
            }
        }
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
        mesh.visible = true;
    }

    return {
        mesh,
        update,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
