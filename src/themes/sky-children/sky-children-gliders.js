/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: the children, folded paper gliders (one instanced draw).
 *
 * A small dart of folded paper: two vanes meeting at a crease and a keel under it, no head, no
 * limbs, no face. Their poses come from the closed-form flock (sky-children-flock.js) and are
 * written per frame into one interleaved instance buffer; the vertex stage builds each glider's
 * frame (heading, bank) and keeps it at least a few pixels across however far away it flies.
 *
 * Paper shading: front-lit white from the sun behind the eye, the sky as ambient, a sharp glint on
 * the crease when a bank turns it to the light (the flash of a turning glider), translucent edges,
 * and an inner glow: warm at the rose hour, at night and at dawn; in the link's colour while a
 * glider paints a stroke of the bow.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, cross, dot, float, length, max, min, mix, normalGeometry,
    normalize, positionGeometry, pow, sin, varying, vec3, vec4,
} from 'three/tsl';
import { scWrap, skyBase } from './sky-children-tsl.js';

/** The dart: nose +z, span 1 along x. Returns a non-indexed geometry with flat normals. */
export function buildGliderGeometry() {
    const nose = [0, 0, 0.55];
    const tipL = [-0.5, 0.07, -0.42];
    const tipR = [0.5, 0.07, -0.42];
    const back = [0, 0.01, -0.48];
    const keel = [0, -0.14, -0.3];
    const foldL = [-0.42, 0.16, -0.38];
    const foldR = [0.42, 0.16, -0.38];
    const tris = [
        nose, tipL, back, // left vane
        nose, back, tipR, // right vane
        nose, back, keel, // keel
        nose, keel, back,
        tipL, foldL, back, // a winglet's fold
        tipR, back, foldR,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
    g.computeVertexNormals();
    return g;
}

/**
 * @param {object} p
 * @param {number} p.capacity
 * @param {object} p.U        the world's uniforms (U.pixelAngle: radians per buffer pixel)
 */
export function createGliders({ capacity, U }) {
    const base = buildGliderGeometry();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setAttribute('normal', base.getAttribute('normal'));
    geometry.instanceCount = capacity;
    const data = new Float32Array(capacity * 12);
    const buffer = new THREE.InstancedInterleavedBuffer(data, 12);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPos', new THREE.InterleavedBufferAttribute(buffer, 4, 0)); // xyz, scale
    geometry.setAttribute('aVel', new THREE.InterleavedBufferAttribute(buffer, 4, 4)); // xyz, bank
    geometry.setAttribute('aCol', new THREE.InterleavedBufferAttribute(buffer, 4, 8)); // rgb, glow

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    const vN = varying(vec3(0.0, 1.0, 0.0), 'vGliderN');
    const vP = varying(vec3(0.0), 'vGliderP');
    const vCol = varying(vec4(1.0), 'vGliderCol');
    material.positionNode = Fn(() => {
        const ap = attribute('aPos', 'vec4');
        const av = attribute('aVel', 'vec4');
        const P = ap.xyz;
        const f = normalize(av.xyz.add(vec3(0.0, 0.0, -1e-4)));
        const side = normalize(cross(f, vec3(0.0, 1.0, 0.0)).add(vec3(1e-4, 0.0, 0.0)));
        const upv = cross(side, f);
        // Bank: roll the frame about the heading.
        const cb = cos(av.w);
        const sb = sin(av.w);
        const r = side.mul(cb).add(upv.mul(sb));
        const u = upv.mul(cb).sub(side.mul(sb));
        // Never smaller than a dozen pixels (a paper dart must read), never larger than ~4 % of the frame.
        const dist = length(cameraPosition.sub(P));
        const minSpan = dist.mul(U.pixelAngle).mul(12.0);
        const size = clamp(max(ap.w, minSpan), 0.0, dist.mul(0.035)).mul(step01(ap.w));
        const g = positionGeometry;
        const n = normalGeometry;
        vN.assign(normalize(r.mul(n.x).add(u.mul(n.y)).add(f.mul(n.z))));
        const world = P.add(r.mul(g.x.mul(size))).add(u.mul(g.y.mul(size))).add(f.mul(g.z.mul(size)));
        vP.assign(world);
        vCol.assign(attribute('aCol', 'vec4'));
        return world;
    })();
    material.colorNode = Fn(() => {
        const { light } = U;
        const N0 = normalize(vN);
        const V = normalize(cameraPosition.sub(vP));
        const N = N0.mul(dot(N0, V).sign().add(0.001).sign()).toVar(); // face the eye (double-sided)
        const L = U.shadeKey;
        const paper = vec3(0.96, 0.95, 0.92);
        const diffuse = scWrap(dot(N, L), float(0.5));
        const ambient = skyBase(N, U).mul(0.55);
        const col = paper.mul(light.key.mul(U.keyGain).mul(diffuse).mul(0.85).add(ambient)).toVar();
        // The crease glint as a bank turns it to the light.
        const H = normalize(L.add(V));
        col.addAssign(light.key.mul(pow(clamp(dot(N, H), 0.0, 1.0), 48.0)).mul(U.keyGain).mul(1.2));
        // Translucent edges: a little of the sky through the paper.
        col.addAssign(skyBase(V.negate(), U).mul(pow(float(1.0).sub(abs(dot(N, V))), 2.0)).mul(0.25));
        // The inner glow: the hour's warmth, or the link's colour while painting.
        const warm = light.hearth.mul(U.gliderGlow).mul(1.4);
        const own = vCol.xyz.mul(vCol.w).mul(2.2);
        col.addAssign(mix(warm, own, min(vCol.w, 1.0)).mul(max(U.gliderGlow, vCol.w)));
        return vec4(col, 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sky-children-gliders';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;

    return {
        mesh,
        capacity,
        data,
        /** Write the flock's poses into the instance buffer. */
        write(poses) {
            for (let i = 0; i < capacity; i++) {
                const p = poses[i];
                const o = i * 12;
                if (!p) {
                    data[o + 3] = 0;
                    continue;
                }
                data[o] = p.pos[0]; data[o + 1] = p.pos[1]; data[o + 2] = p.pos[2]; data[o + 3] = p.scale;
                data[o + 4] = p.vel[0]; data[o + 5] = p.vel[1]; data[o + 6] = p.vel[2]; data[o + 7] = p.bank;
                data[o + 8] = p.colour[0]; data[o + 9] = p.colour[1]; data[o + 10] = p.colour[2]; data[o + 11] = p.glow;
            }
            buffer.needsUpdate = true;
        },
        dispose() {
            base.dispose();
            geometry.dispose();
            material.dispose();
        },
    };
}

/** 1 for a live glider (scale > 0), 0 for a sleeping one. */
function step01(x) {
    return clamp(x.mul(1e4), 0.0, 1.0);
}
