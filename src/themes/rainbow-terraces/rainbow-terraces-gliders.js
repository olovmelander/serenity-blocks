/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Rainbow Terraces: the paper birds, the gliders (one instanced draw).
 *
 * A small bird of folded paper, 30 flat facets (designed in Blender, its points written out here):
 * a creased body with a pointed head and a notched fan of a tail, and on each side a broad inner
 * wing and a swept, pointed hand. The wing hinges at the shoulder and the hand at the wrist (both
 * hinges run nose to tail, so the folds stay on their creases however the wing beats), and every
 * facet belongs to one part, so the vertex stage beats the wings by turning each part about its
 * hinge: no skinning, no texture. Their poses come from the closed-form flock
 * (rainbow-terraces-flock.js) and are written per frame into one interleaved instance buffer;
 * the vertex stage builds each bird's frame (heading, bank), beats its wings, and keeps it a few
 * pixels across however far away it flies (fewer the further: the far flock reads smaller).
 *
 * Paper shading: front-lit white from the sun behind the eye, the sky as ambient, a sharp glint on
 * a crease when a bank or a wingbeat turns it to the light, translucent edges, a breath of the
 * air's colour on the far ones, and an inner glow: warm at the rose hour, at night and at dawn; in
 * the link's colour while a bird paints a stroke of the bow.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, cross, dot, float, length, max, min, mix, normalGeometry,
    normalize, positionGeometry, pow, sin, smoothstep, step, varying, vec3, vec4,
    pow2,
} from 'three/tsl';
import { scWrap, skyBase } from './rainbow-terraces-tsl.js';

/** The hinges: the shoulder and the wrist (|x| in the bird's frame, at y = 0, running along z). */
export const BIRD_HINGE = Object.freeze({ shoulder: 0.06, wrist: 0.27 });

/** The bird's parts. */
export const BIRD_PART = Object.freeze({ body: 0, wing: 1, hand: 2 });

/**
 * The paper bird in its own frame: nose +z, up +y, span 1 along x (tip to tip, wings level).
 * Each entry is one facet [a, b, c] and its part. Points on a hinge line lie exactly on it, so a
 * facet turned about its hinge stays joined to its neighbours.
 */
export function birdFacets() {
    const { shoulder: SX, wrist: WX } = BIRD_HINGE;
    const mirror = (p) => [-p[0], p[1], p[2]];
    const head = [0, 0.03, 0.27];
    const ridge = [0, 0.04, 0];
    const keel = [0, -0.06, 0.03];
    const sf = [SX, 0, 0.11];
    const sb = [SX, 0, -0.09];
    const tailR = [0.085, 0.012, -0.31];
    const tailL = mirror(tailR);
    const notch = [0, 0.02, -0.27];
    const body = [
        [head, sf, ridge], [head, ridge, mirror(sf)], [ridge, sf, sb], [ridge, mirror(sb), mirror(sf)],
        [ridge, sb, tailR], [ridge, tailR, notch], [ridge, notch, tailL], [ridge, tailL, mirror(sb)],
        [head, mirror(sf), keel], [head, keel, sf], [keel, mirror(sf), mirror(sb)], [keel, sb, sf],
        [keel, mirror(sb), tailL], [keel, tailR, sb], [keel, tailL, notch], [keel, notch, tailR],
    ];
    const wf = [WX, 0, 0.12];
    const wb = [WX, 0, -0.075];
    const crease = [0.165, 0.028, 0.025];
    const tip = [0.5, 0, -0.13];
    const fold = [0.355, 0.016, -0.01];
    const wing = [[sf, wf, crease], [wf, wb, crease], [wb, sb, crease], [sb, sf, crease]];
    const hand = [[wf, tip, fold], [tip, wb, fold], [wb, wf, fold]];
    const facets = body.map((f) => ({ points: f, part: BIRD_PART.body }));
    const both = (list, part) => list.forEach((f) => {
        facets.push({ points: f, part });
        facets.push({ points: [mirror(f[0]), mirror(f[2]), mirror(f[1])], part });
    });
    both(wing, BIRD_PART.wing);
    both(hand, BIRD_PART.hand);
    return facets;
}

/**
 * The CPU twin of the vertex stage's wingbeat: point `p` of part `part` with the shoulder at
 * `shoulder` and the wrist at `wrist` radians (+ raises the tip).
 */
export function beatPoint(p, part, shoulder, wrist, out = [0, 0, 0]) {
    const { shoulder: SX, wrist: WX } = BIRD_HINGE;
    const side = p[0] >= 0 ? 1 : -1;
    let ax = Math.abs(p[0]);
    let y = p[1];
    if (part === BIRD_PART.hand) {
        const hx = ax - WX;
        ax = WX + hx * Math.cos(wrist) - y * Math.sin(wrist);
        y = hx * Math.sin(wrist) + y * Math.cos(wrist);
    }
    if (part !== BIRD_PART.body) {
        const hx = ax - SX;
        ax = SX + hx * Math.cos(shoulder) - y * Math.sin(shoulder);
        y = hx * Math.sin(shoulder) + y * Math.cos(shoulder);
    }
    out[0] = side * ax;
    out[1] = y;
    out[2] = p[2];
    return out;
}

/** The bird: a non-indexed geometry with flat normals and each vertex's part (`aSeg`). */
export function buildGliderGeometry() {
    const facets = birdFacets();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(facets.flatMap((f) => f.points.flat()), 3));
    g.setAttribute('aSeg', new THREE.Float32BufferAttribute(facets.flatMap((f) => [f.part, f.part, f.part]), 1));
    g.computeVertexNormals();
    return g;
}

/** Floats per bird in the instance buffer: position + scale, velocity + bank, colour + glow, wings + presence. */
export const GLIDER_STRIDE = 16;

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
    geometry.setAttribute('aSeg', base.getAttribute('aSeg'));
    geometry.instanceCount = capacity;
    const data = new Float32Array(capacity * GLIDER_STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, GLIDER_STRIDE);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPos', new THREE.InterleavedBufferAttribute(buffer, 4, 0)); // xyz, scale
    geometry.setAttribute('aVel', new THREE.InterleavedBufferAttribute(buffer, 4, 4)); // xyz, bank
    geometry.setAttribute('aCol', new THREE.InterleavedBufferAttribute(buffer, 4, 8)); // rgb, glow
    geometry.setAttribute('aWing', new THREE.InterleavedBufferAttribute(buffer, 4, 12)); // shoulder, wrist, presence, -

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    const vN = varying(vec3(0.0, 1.0, 0.0), 'vGliderN');
    const vP = varying(vec3(0.0), 'vGliderP');
    const vCol = varying(vec4(1.0), 'vGliderCol');
    material.positionNode = Fn(() => {
        const ap = attribute('aPos', 'vec4');
        const av = attribute('aVel', 'vec4');
        const aw = attribute('aWing', 'vec4');
        const seg = attribute('aSeg', 'float');
        const P = ap.xyz;
        const f = normalize(av.xyz.add(vec3(0.0, 0.0, -1e-4)));
        const side = normalize(cross(f, vec3(0.0, 1.0, 0.0)).add(vec3(1e-4, 0.0, 0.0)));
        const upv = cross(side, f);
        // Bank: roll the frame about the heading.
        const cb = cos(av.w);
        const sb = sin(av.w);
        const r = side.mul(cb).add(upv.mul(sb));
        const u = upv.mul(cb).sub(side.mul(sb));
        // A few pixels across however far (fewer the further), never more than ~4 % of the frame;
        // a bird fading out (presence) shrinks to nothing.
        const dist = length(cameraPosition.sub(P));
        const floorPx = clamp(float(4800.0).div(dist), 10.5, 18.0);
        const minSpan = dist.mul(U.pixelAngle).mul(floorPx).mul(aw.z);
        const size = clamp(max(ap.w, minSpan), 0.0, dist.mul(0.035)).mul(step01(ap.w));
        // The wingbeat: the hand turns about the wrist, then the whole wing about the shoulder (the
        // bird's right side; the left is its mirror).
        const g = positionGeometry;
        const n = normalGeometry;
        const mirror = step(0.0, g.x).mul(2.0).sub(1.0);
        const wing = step(0.5, seg);
        const hand = step(1.5, seg);
        const cw = cos(aw.y);
        const sw = sin(aw.y);
        const cs = cos(aw.x);
        const ss = sin(aw.x);
        const ax0 = abs(g.x);
        const hx = ax0.sub(BIRD_HINGE.wrist);
        const ax1 = mix(ax0, hx.mul(cw).sub(g.y.mul(sw)).add(BIRD_HINGE.wrist), hand);
        const y1 = mix(g.y, hx.mul(sw).add(g.y.mul(cw)), hand);
        const sx = ax1.sub(BIRD_HINGE.shoulder);
        const ax2 = mix(ax1, sx.mul(cs).sub(y1.mul(ss)).add(BIRD_HINGE.shoulder), wing);
        const y2 = mix(y1, sx.mul(ss).add(y1.mul(cs)), wing);
        const nx0 = n.x.mul(mirror);
        const nx1 = mix(nx0, nx0.mul(cw).sub(n.y.mul(sw)), hand);
        const ny1 = mix(n.y, nx0.mul(sw).add(n.y.mul(cw)), hand);
        const nx2 = mix(nx1, nx1.mul(cs).sub(ny1.mul(ss)), wing);
        const ny2 = mix(ny1, nx1.mul(ss).add(ny1.mul(cs)), wing);
        vN.assign(normalize(r.mul(nx2.mul(mirror)).add(u.mul(ny2)).add(f.mul(n.z))));
        const world = P.add(r.mul(ax2.mul(mirror).mul(size))).add(u.mul(y2.mul(size))).add(f.mul(g.z.mul(size)));
        vP.assign(world);
        vCol.assign(attribute('aCol', 'vec4'));
        return world;
    })();
    material.colorNode = Fn(() => {
        const { light } = U;
        const N0 = normalize(vN);
        const toEye = cameraPosition.sub(vP);
        const V = normalize(toEye);
        const N = N0.mul(dot(N0, V).sign().add(0.001).sign()).toVar(); // face the eye (double-sided)
        const L = U.shadeKey;
        const paper = vec3(0.96, 0.95, 0.92);
        const diffuse = scWrap(dot(N, L), float(0.5));
        const ambient = skyBase(N, U).mul(0.55);
        const col = paper.mul(light.key.mul(U.keyGain).mul(diffuse).mul(0.85).add(ambient)).toVar();
        // The crease glint as a bank or a wingbeat turns a facet to the light.
        const H = normalize(L.add(V));
        col.addAssign(light.key.mul(pow(clamp(dot(N, H), 0.0, 1.0), 48.0)).mul(U.keyGain).mul(1.2));
        // Translucent edges: a little of the sky through the paper.
        col.addAssign(skyBase(V.negate(), U).mul(pow2(float(1.0).sub(abs(dot(N, V))))).mul(0.25));
        // The far ones take a breath of the air's colour (the flock over the gate reads further off).
        col.assign(mix(col, skyBase(V.negate(), U), smoothstep(280.0, 650.0, length(toEye)).mul(0.22)));
        // The inner glow: the hour's warmth, or the link's colour while painting.
        const warm = light.hearth.mul(U.gliderGlow).mul(1.4);
        const own = vCol.xyz.mul(vCol.w).mul(2.2);
        col.addAssign(mix(warm, own, min(vCol.w, 1.0)).mul(max(U.gliderGlow, vCol.w)));
        return vec4(col, 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'rainbow-terraces-gliders';
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
                const o = i * GLIDER_STRIDE;
                if (!p) {
                    data[o + 3] = 0;
                    continue;
                }
                data[o] = p.pos[0]; data[o + 1] = p.pos[1]; data[o + 2] = p.pos[2]; data[o + 3] = p.scale;
                data[o + 4] = p.vel[0]; data[o + 5] = p.vel[1]; data[o + 6] = p.vel[2]; data[o + 7] = p.bank;
                data[o + 8] = p.colour[0]; data[o + 9] = p.colour[1]; data[o + 10] = p.colour[2]; data[o + 11] = p.glow;
                data[o + 12] = p.wings ? p.wings[0] : 0.12;
                data[o + 13] = p.wings ? p.wings[1] : 0;
                data[o + 14] = p.presence ?? 1;
                data[o + 15] = 0;
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
