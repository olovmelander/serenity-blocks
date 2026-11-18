/**
 * Pyrestorm — the snags: what is left of the wood the ridge once carried.
 *
 * Ash fall killed the trees on the eye's own slope and fire took the rest; their trunks still
 * stand between the eye and the lava, burnt to charcoal, crowns gone, limbs broken short. They are
 * the picture's near plane: black shapes in its lower corners, cut out against the rivers' glow,
 * with the fire's light rimming whatever of them turns to it and the moon's on their other side.
 * Their broken ends still smoulder.
 *
 * The six designs are built by script in Blender (scripts/blender/pyrestorm_snags.py →
 * pyrestorm-snag-models.js). Every snag is placed once, on the CPU, rooted on the land's own
 * height, and all of them are one mesh and one draw. They stand where the solo layout leaves the
 * frame free: to the left of the card and to the right of the HUD (PLACES holds each one's bearing
 * from the view's axis, its distance from the eye, its design, its size and its turn).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    float,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEG, EYE, landHeight } from './pyrestorm-core.js';
import { lightningAt, pyBlackbody } from './pyrestorm-tsl.js';
import { PYRESTORM_SNAG_MODELS } from './pyrestorm-snag-models.js';

/**
 * Where the snags stand: (bearing in degrees right of north, metres from the eye, design, size,
 * turn in degrees about its own axis). They stand as a burnt wood does: in knots of two or three
 * with gaps between, no two of a size; the near ones are the frame's corners, the rest thin out
 * down the slope behind them.
 */
export const SNAG_PLACES = Object.freeze([
    // Left of the card: three by the eye, a knot of three further down, a lone one, a far stand.
    Object.freeze([-40, 58, 'spire', 1.25, 20]),
    Object.freeze([-37.5, 71, 'stump', 1.35, 200]),
    Object.freeze([-35.2, 63, 'fork', 0.9, 160]),
    Object.freeze([-29, 104, 'lean', 1.2, 40]),
    Object.freeze([-27.2, 119, 'candelabra', 0.85, 190]),
    Object.freeze([-25.6, 97, 'hook', 1.05, 300]),
    Object.freeze([-32.5, 172, 'hook', 1.35, 0]),
    Object.freeze([-20, 214, 'spire', 1.1, 80]),
    Object.freeze([-18.4, 233, 'fork', 1.3, 10]),
    Object.freeze([-22.1, 251, 'stump', 1.2, 120]),
    Object.freeze([-17.2, 191, 'lean', 0.8, 250]),
    // Right of the HUD: three by the eye, a knot of three, two far.
    Object.freeze([26.5, 60, 'candelabra', 1.2, 230]),
    Object.freeze([29.6, 73, 'spire', 0.95, 110]),
    Object.freeze([24.2, 69, 'stump', 1.25, 330]),
    Object.freeze([18.6, 128, 'fork', 1.15, 350]),
    Object.freeze([20.7, 143, 'lean', 0.9, 60]),
    Object.freeze([17.2, 161, 'hook', 1.2, 150]),
    Object.freeze([23.1, 236, 'spire', 1.25, 30]),
    Object.freeze([25.6, 262, 'candelabra', 1.0, 280]),
]);

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

/** The models decoded once a page: every world (a rebuild, a quality change) shares them. */
let decoded = null;
function models() {
    if (decoded) return decoded;
    decoded = {};
    for (const model of PYRESTORM_SNAG_MODELS.models) {
        decoded[model.design] = {
            height: model.height,
            positions: decode(model.positions, Int16Array),
            normals: decode(model.normals, Int8Array),
            tip: decode(model.tip, Uint8Array),
            index: decode(model.index, Uint16Array),
        };
    }
    return decoded;
}

/** Where a place's snag is rooted (m): on the land, sunk a little so its foot is in the ground. */
export function snagRoot(place, out = [0, 0, 0]) {
    const bearing = place[0] * DEG;
    out[0] = EYE.x + Math.sin(bearing) * place[1];
    out[2] = EYE.z - Math.cos(bearing) * place[1];
    out[1] = landHeight(out[0], out[2]) - 0.15;
    return out;
}

/** Every placed snag as one geometry in world space: position, normal, (tip, own seed, height share). */
export function snagGeometry(places = SNAG_PLACES) {
    const all = models();
    const { quant } = PYRESTORM_SNAG_MODELS;
    let vertexCount = 0;
    let indexCount = 0;
    for (const place of places) {
        const model = all[place[2]];
        if (!model) continue;
        vertexCount += model.tip.length;
        indexCount += model.index.length;
    }
    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const look = new Float32Array(vertexCount * 3);
    const index = new Uint32Array(indexCount);
    let v0 = 0;
    let i0 = 0;
    const root = [0, 0, 0];
    places.forEach((place, n) => {
        const model = all[place[2]];
        if (!model) return;
        snagRoot(place, root);
        const size = place[3];
        const turn = place[4] * DEG;
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const seed = ((n * 0.6180339887) % 1);
        const count = model.tip.length;
        for (let i = 0; i < count; i++) {
            const x = model.positions[i * 3] * quant * size;
            const y = model.positions[i * 3 + 1] * quant * size;
            const z = model.positions[i * 3 + 2] * quant * size;
            const o = (v0 + i) * 3;
            position[o] = root[0] + x * c + z * s;
            position[o + 1] = root[1] + y;
            position[o + 2] = root[2] - x * s + z * c;
            const nx = model.normals[i * 3] / 127;
            const ny = model.normals[i * 3 + 1] / 127;
            const nz = model.normals[i * 3 + 2] / 127;
            normal[o] = nx * c + nz * s;
            normal[o + 1] = ny;
            normal[o + 2] = -nx * s + nz * c;
            look[o] = model.tip[i] / 255;
            look[o + 1] = seed;
            look[o + 2] = Math.max(0, Math.min(1, (model.positions[i * 3 + 1] * quant) / model.height));
        }
        for (let i = 0; i < model.index.length; i++) index[i0 + i] = v0 + model.index[i];
        v0 += count;
        i0 += model.index.length;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aSnag', new THREE.BufferAttribute(look, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    return geometry;
}

export function createSnags(u, t) {
    const geometry = snagGeometry();
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PyrestormSnags';
    material.fog = false;
    const nrm = attribute('normal', 'vec3');
    const snag = attribute('aSnag', 'vec3');
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const N = normalize(nrm).toVar();
        const V = normalize(u.eye.sub(P)).toVar();
        const tip = snag.x;
        const seed = snag.y;
        // Charcoal: nearly black, a little paler where ash lies on what faces up.
        const grain = texture(t.noise, vec2(P.x.add(P.z), P.y).div(3.1)).b;
        const albedo = mix(vec3(0.012, 0.011, 0.012), vec3(0.04, 0.037, 0.036), smoothstep(0.3, 0.9, N.y).mul(0.6)).mul(grain.mul(0.6).add(0.7));
        // The night's key light on the side that turns to it; a little of the sky.
        // (Half of it: char takes little light, and a pale trunk is no silhouette.)
        const key = u.moon.mul(clamp(dot(N, u.rake), 0.0, 1.0)).mul(0.5);
        const sky = u.ambient.mul(N.y.mul(0.4).add(0.6)).mul(1.6);
        // The lava lies beyond and below: its light rims whatever turns away from the eye and
        // down toward it (the far edges of a trunk, the undersides of its limbs).
        const edge = float(1.0).sub(clamp(dot(N, V), 0.0, 1.0));
        const toFire = clamp(dot(N, normalize(vec3(0.0, -0.35, -1.0))).mul(0.6).add(0.4), 0.0, 1.0);
        const rim = u.fireColour.mul(edge.mul(edge).mul(edge)).mul(toFire).mul(u.activity.mul(0.7).add(0.3))
            .mul(u.fountain.mul(0.12).add(0.5));
        const bolts = lightningAt(u, P, N);
        const storm = u.stormLight.mul(clamp(N.y.mul(0.6).add(0.4), 0.0, 1.0));
        const col = albedo.mul(key.add(sky).add(bolts).add(storm).add(rim.mul(9.0))).toVar();
        // The broken ends still smoulder: checks of ember in the char that breathe, each snag on
        // its own beat, a hard drop's tremor fanning them.
        const check = texture(t.noise, P.xy.add(P.z).div(0.55)).a;
        const breath = sin(u.time.mul(seed.mul(0.9).add(0.7)).add(seed.mul(40.0))).mul(0.5).add(0.5);
        const ember = smoothstep(0.52, 0.8, check).mul(tip).mul(breath.mul(0.75).add(0.25).add(u.tremor.mul(0.6)));
        col.addAssign(pyBlackbody(ember.mul(0.3).add(0.36)).mul(ember).mul(0.5).mul(u.activity.mul(0.5).add(0.5)));
        return vec4(max(col, vec3(0.0)), 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PyrestormSnags';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return {
        mesh,
        meshes: [mesh],
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
