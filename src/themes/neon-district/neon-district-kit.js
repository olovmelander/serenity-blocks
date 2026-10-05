/**
 * Neon District — the street's hardware.
 *
 * What turns a wall of boxes into a street: awnings over the shopfronts, vending machines glowing
 * on the pavement, fire escapes stacked up the facades, pipe runs, skybridges and signal gantries
 * across the road, and on the roofs water tanks, antenna masts, condenser stacks and billboard
 * scaffolds. Each piece is a handful of boxes and cylinders merged once at build time, with a
 * per-vertex shade (how buried the vertex is — a cheap stand-in for baked occlusion) and a
 * per-vertex lamp mask (what glows); each KIND is one instanced draw sharing one material.
 *
 * Unlit like everything else: the glow map lights them from the street, the smog from above, the
 * gameplay pulses wash over them, and their lamps answer the district's power.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cos,
    exp,
    float,
    floor,
    fract,
    max,
    mix,
    normalGeometry,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    step,
    varying,
    vec3,
} from 'three/tsl';
import {
    STREET,
    ndAtmosphere,
    ndClearLight,
    ndGlow,
    ndHash11,
    ndLockLight,
    ndWrapZ,
} from './neon-district-tsl.js';

/** Collects transformed primitives and merges them into one geometry. */
class PieceBuilder {
    constructor() {
        this.positions = [];
        this.normals = [];
        this.shade = [];
        this.lamp = [];
        this.indices = [];
        this.offset = 0;
    }

    /**
     * @param {THREE.BufferGeometry} geometry  consumed (disposed)
     * @param {object} [o]
     * @param {number[]} [o.at]     translation
     * @param {number[]} [o.rot]    Euler XYZ
     * @param {number} [o.lamp=0]   lamp mask for every vertex
     * @param {number} [o.shade=1]  shade for every vertex (1 = open air, lower = buried)
     * @param {(y:number)=>number} [o.shadeBy]  shade from the vertex's final height
     */
    add(geometry, o = {}) {
        const m = new THREE.Matrix4();
        if (o.rot) m.makeRotationFromEuler(new THREE.Euler(o.rot[0], o.rot[1], o.rot[2]));
        if (o.at) m.setPosition(o.at[0], o.at[1], o.at[2]);
        const g = geometry.index ? geometry : geometry.toNonIndexed();
        g.applyMatrix4(m);
        const p = g.attributes.position.array;
        const n = g.attributes.normal.array;
        for (let i = 0; i < p.length; i += 3) {
            this.positions.push(p[i], p[i + 1], p[i + 2]);
            this.normals.push(n[i], n[i + 1], n[i + 2]);
            this.shade.push(o.shadeBy ? o.shadeBy(p[i + 1]) : (o.shade ?? 1));
            this.lamp.push(o.lamp ?? 0);
        }
        if (g.index) {
            const idx = g.index.array;
            for (let i = 0; i < idx.length; i++) this.indices.push(idx[i] + this.offset);
        } else {
            for (let i = 0; i < p.length / 3; i++) this.indices.push(i + this.offset);
        }
        this.offset += p.length / 3;
        geometry.dispose();
        if (g !== geometry) g.dispose();
        return this;
    }

    box(w, h, d, at, o = {}) {
        return this.add(new THREE.BoxGeometry(w, h, d), { ...o, at });
    }

    cyl(rTop, rBottom, h, at, o = {}) {
        return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, o.segments ?? 10, 1, o.open === true), { ...o, at });
    }

    build() {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setIndex(this.indices);
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
        const mask = new Float32Array(this.shade.length * 2);
        for (let i = 0; i < this.shade.length; i++) {
            mask[i * 2] = this.shade[i];
            mask[i * 2 + 1] = this.lamp[i];
        }
        geometry.setAttribute('aMask', new THREE.Float32BufferAttribute(mask, 2));
        return geometry;
    }
}

/** Shade that darkens toward a piece's foot (where it meets a wall or a roof). */
const grounded = (height, floorShade = 0.45) => (y) => floorShade + (1 - floorShade) * Math.max(0, Math.min(1, y / height));

/**
 * Piece geometry by kind. Each is built at its natural size with its mounting point at the
 * origin: +x is "out from the wall" for wall pieces (mirrored per instance), z along the street.
 */
export const KIT_PIECES = Object.freeze({
    /** A canopy over a shopfront: 1 m of street per unit of z scale. */
    awning() {
        const b = new PieceBuilder();
        b.box(1.5, 0.07, 1, [0.72, 0.16, 0], { rot: [0, 0, -0.16], shade: 0.9 });
        b.box(0.05, 0.3, 1, [1.44, -0.08, 0], { shade: 0.8 });
        b.box(0.04, 0.04, 1, [0.04, 0.32, 0], { shade: 0.5 });
        // A strip light under the lip.
        b.box(0.06, 0.03, 0.9, [1.3, -0.02, 0], { lamp: 1 });
        return b.build();
    },
    /** A vending machine with a lit face (the face looks out from the wall). */
    vending() {
        const b = new PieceBuilder();
        b.box(0.78, 1.86, 1.02, [0.42, 0.95, 0], { shadeBy: grounded(1.9, 0.5) });
        b.box(0.03, 1.2, 0.86, [0.82, 1.12, 0], { lamp: 0.42 });
        b.box(0.03, 0.2, 0.5, [0.82, 0.28, -0.12], { lamp: 0.2 });
        b.box(0.8, 0.06, 1.06, [0.42, 1.9, 0], { shade: 0.9 });
        return b.build();
    },
    /** A fire escape landing: one storey (3.4 m) of platform, rail and ladder. */
    escape() {
        const b = new PieceBuilder();
        b.box(1.05, 0.06, 3.0, [0.56, 0, 0], { shade: 0.55 });
        // Rails: the outer run and its returns.
        [0.5, 1.0].forEach((y) => {
            b.box(0.035, 0.035, 3.0, [1.07, y, 0], { shade: 0.9 });
            b.box(1.05, 0.035, 0.035, [0.56, y, 1.49], { shade: 0.8 });
            b.box(1.05, 0.035, 0.035, [0.56, y, -1.49], { shade: 0.8 });
        });
        for (let i = 0; i <= 6; i++) b.box(0.03, 1.0, 0.03, [1.07, 0.5, -1.5 + i * 0.5], { shade: 0.85 });
        // The ladder down to the landing below.
        b.box(0.04, 3.4, 0.04, [0.75, -1.7, 0.9], { shade: 0.75, rot: [0.18, 0, 0] });
        b.box(0.04, 3.4, 0.04, [0.75, -1.7, 0.5], { shade: 0.75, rot: [0.18, 0, 0] });
        for (let i = 0; i < 9; i++) {
            const y = -0.3 - i * 0.36;
            b.box(0.03, 0.03, 0.4, [0.75, y, 0.7 - (y + 1.7) * 0.18], { shade: 0.75 });
        }
        // Brackets into the wall.
        b.box(1.05, 0.05, 0.05, [0.56, -0.3, 1.3], { rot: [0, 0, 0.5], shade: 0.5 });
        b.box(1.05, 0.05, 0.05, [0.56, -0.3, -1.3], { rot: [0, 0, 0.5], shade: 0.5 });
        return b.build();
    },
    /** A pipe run up a wall: one storey of three pipes and their clamps. */
    pipes() {
        const b = new PieceBuilder();
        [[0.12, 0.09, -0.24], [0.1, 0.06, 0], [0.14, 0.11, 0.26]].forEach(([x, r, z]) => {
            b.cyl(r, r, 3.4, [x, 1.7, z], { segments: 7, shade: 0.8 });
        });
        [0.5, 2.2].forEach((y) => b.box(0.3, 0.07, 0.86, [0.14, y, 0.01], { shade: 0.55 }));
        b.cyl(0.13, 0.13, 0.16, [0.14, 3.0, 0.26], { segments: 7, shade: 0.9 });
        return b.build();
    },
    /** A skybridge: one metre of tube per unit of x scale, a lit window band down each side. */
    bridge() {
        const b = new PieceBuilder();
        b.box(1, 2.9, 3.2, [0, 0, 0], { shadeBy: (y) => 0.6 + 0.4 * Math.max(0, Math.min(1, (y + 1.45) / 2.9)) });
        b.box(1, 0.9, 0.04, [0, 0.2, 1.62], { lamp: 1 });
        b.box(1, 0.9, 0.04, [0, 0.2, -1.62], { lamp: 1 });
        b.box(1, 0.16, 3.5, [0, -1.5, 0], { shade: 0.5 });
        b.box(1, 0.12, 3.4, [0, 1.5, 0], { shade: 0.95 });
        return b.build();
    },
    /** A signal gantry over the road: 2 × halfRoad wide, heads over each lane. */
    gantry() {
        const b = new PieceBuilder();
        const half = STREET.halfRoad + 0.45;
        [-half, half].forEach((x) => {
            b.box(0.22, 6.6, 0.22, [x, 3.3, 0], { shadeBy: grounded(6.6, 0.5) });
            b.box(0.5, 0.4, 0.5, [x, 0.2, 0], { shade: 0.5 });
        });
        b.box(half * 2, 0.24, 0.2, [0, 6.5, 0], { shade: 0.8 });
        b.box(half * 2, 0.06, 0.06, [0, 6.05, 0], { shade: 0.7 });
        for (let i = 0; i < 6; i++) b.box(0.05, 0.45, 0.05, [-half + 1 + i * ((half * 2 - 2) / 5), 6.27, 0], { shade: 0.7 });
        // Signal heads: a housing, and a lens facing up the street (toward the camera).
        [-3.2, 3.2].forEach((x) => {
            b.box(0.42, 1.1, 0.3, [x, 5.7, 0.1], { shade: 0.7 });
            b.cyl(0.13, 0.13, 0.03, [x, 6.02, 0.27], { lamp: 1, rot: [Math.PI / 2, 0, 0], segments: 12 });
            b.cyl(0.13, 0.13, 0.03, [x, 5.4, 0.27], { lamp: 0.12, rot: [Math.PI / 2, 0, 0], segments: 12 });
        });
        // A lane sign panel in the middle.
        b.box(2.6, 0.9, 0.06, [0, 5.75, 0.08], { shade: 0.85 });
        b.box(2.3, 0.045, 0.02, [0, 5.95, 0.13], { lamp: 0.22 });
        b.box(1.5, 0.045, 0.02, [-0.4, 5.62, 0.13], { lamp: 0.22 });
        return b.build();
    },
    /** A rooftop water tank on legs. */
    tank() {
        const b = new PieceBuilder();
        b.cyl(1.25, 1.25, 2.2, [0, 2.4, 0], { segments: 14, shadeBy: (y) => 0.6 + 0.4 * Math.max(0, Math.min(1, (y - 1.3) / 2.2)) });
        b.cyl(0.08, 1.32, 0.7, [0, 3.85, 0], { segments: 14, shade: 1 });
        [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]].forEach(([x, z]) => {
            b.box(0.1, 1.4, 0.1, [x, 0.7, z], { shadeBy: grounded(1.4, 0.4) });
        });
        b.box(1.9, 0.07, 0.07, [0, 0.75, 0.85], { shade: 0.6 });
        b.box(1.9, 0.07, 0.07, [0, 0.75, -0.85], { shade: 0.6 });
        b.cyl(1.28, 1.28, 0.08, [0, 2.0, 0], { segments: 14, shade: 0.8 });
        b.cyl(1.28, 1.28, 0.08, [0, 3.0, 0], { segments: 14, shade: 0.9 });
        return b.build();
    },
    /** A lattice antenna mast with dishes. */
    mast() {
        const b = new PieceBuilder();
        const h = 9;
        [[-0.3, -0.3], [0.3, -0.3], [0, 0.34]].forEach(([x, z]) => {
            b.box(0.06, h, 0.06, [x * 0.6, h / 2, z * 0.6], { rot: [z * 0.03, 0, -x * 0.03], shadeBy: grounded(h, 0.5) });
        });
        for (let i = 1; i < 8; i++) {
            const y = i * (h / 8);
            b.box(0.5, 0.035, 0.035, [0, y, -0.18], { shade: 0.8 });
            b.box(0.035, 0.035, 0.5, [0.12, y, 0], { shade: 0.8, rot: [0, 0.5, 0] });
        }
        b.box(0.04, 2.6, 0.04, [0, h + 1.3, 0], { shade: 1 });
        b.cyl(0.6, 0.6, 0.08, [0.45, 6.3, 0.1], { segments: 12, rot: [0, 0, Math.PI / 2], shade: 0.9 });
        b.cyl(0.42, 0.42, 0.08, [-0.4, 4.6, 0.2], { segments: 12, rot: [0.3, 0, Math.PI / 2], shade: 0.9 });
        b.box(0.9, 0.05, 0.05, [0, 7.6, 0], { shade: 0.9 });
        b.box(0.05, 0.05, 0.9, [0, 8.2, 0], { shade: 0.9 });
        return b.build();
    },
    /** A stack of rooftop condensers. */
    aircon() {
        const b = new PieceBuilder();
        b.box(1.5, 1.0, 1.0, [0, 0.5, 0], { shadeBy: grounded(1.0, 0.45) });
        b.box(1.1, 0.9, 0.9, [1.5, 0.45, 0.2], { shadeBy: grounded(0.9, 0.45) });
        b.box(1.3, 0.8, 1.0, [0.2, 1.4, 0], { shade: 0.9 });
        b.cyl(0.36, 0.36, 0.05, [0, 1.02, 0], { segments: 12, shade: 0.5 });
        b.cyl(0.3, 0.3, 0.05, [1.5, 0.92, 0.2], { segments: 12, shade: 0.5 });
        b.cyl(0.34, 0.34, 0.05, [0.2, 1.82, 0], { segments: 12, shade: 0.55 });
        b.cyl(0.07, 0.07, 1.8, [-0.9, 0.9, 0.3], { segments: 6, shade: 0.7 });
        return b.build();
    },
    /** The scaffold behind a rooftop billboard. */
    frame() {
        const b = new PieceBuilder();
        const w = 6;
        const h = 4.4;
        [-w / 2, 0, w / 2].forEach((z) => {
            b.box(0.1, h, 0.1, [0, h / 2, z], { shadeBy: grounded(h, 0.5) });
            b.box(1.6, 0.08, 0.08, [-0.75, h * 0.45, z], { rot: [0, 0, 0.95], shade: 0.7 });
        });
        [0.9, h * 0.55, h - 0.1].forEach((y) => b.box(0.08, 0.08, w, [0, y, 0], { shade: 0.85 }));
        b.box(0.05, h * 0.5, w * 0.92, [0.08, h * 0.72, 0], { shade: 0.6 });
        // Floodlights along the top, aimed at the board.
        [-2, 0, 2].forEach((z) => b.box(0.3, 0.1, 0.4, [0.5, h + 0.12, z], { lamp: 1 }));
        return b.build();
    },
});

export const KIT_KINDS = Object.freeze(Object.keys(KIT_PIECES));

/**
 * One material for every piece: a painted-metal body lit by the district, and lamps.
 * Instance attributes: aPos (x, y, layout z, yaw), aScale (sx, sy, sz, seed),
 * aTint (lamp colour r, g, b, mirror: −1 flips the piece's +x).
 */
export function createKitMaterial(u) {
    const pos = attribute('aPos', 'vec4');
    const scale = attribute('aScale', 'vec4');
    const tint = attribute('aTint', 'vec4');
    const mask = attribute('aMask', 'vec2');

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDistrictKit';
    material.fog = false;
    material.side = THREE.DoubleSide;

    const local = positionGeometry.mul(scale.xyz).mul(vec3(tint.w, 1.0, 1.0));
    const c = cos(pos.w);
    const s = sin(pos.w);
    const turned = vec3(local.x.mul(c).add(local.z.mul(s)), local.y, local.z.mul(c).sub(local.x.mul(s)));
    material.positionNode = vec3(pos.x.add(turned.x), pos.y.add(turned.y), ndWrapZ(pos.z.add(u.scroll)).add(turned.z));
    const nLocal = normalGeometry.mul(vec3(tint.w, 1.0, 1.0));
    const vNormal = varying(vec3(nLocal.x.mul(c).add(nLocal.z.mul(s)), nLocal.y, nLocal.z.mul(c).sub(nLocal.x.mul(s))), 'ndKitN');

    material.colorNode = Fn(() => {
        const pW = positionWorld;
        const seed = floor(scale.w.add(0.5));
        const glow = ndGlow(u, pW).mul(exp(max(pW.y.sub(3.0), 0.0).mul(-0.085)));
        const clear = ndClearLight(u, pW.z);
        const pulse = ndLockLight(u, pW).add(clear.rgb);
        const skyLight = u.hazeHigh.mul(1.6).add(u.hazeLow.mul(0.35))
            .mul(smoothstep(4.0, 90.0, pW.y).mul(0.75).add(0.25))
            .mul(max(vNormal.y, 0.0).mul(0.7).add(0.3));
        // Light from the street reaches faces that look down or across more than faces that look up.
        const street = float(1.0).sub(max(vNormal.y, 0.0).mul(0.6));
        const paint = mix(vec3(0.03, 0.033, 0.042), vec3(0.05, 0.036, 0.03), ndHash11(seed.mul(0.37).add(1.0)));
        const body = paint.mul(mask.x)
            .mul(vec3(0.028, 0.038, 0.066).add(glow.mul(1.1).mul(street)).add(skyLight.mul(4.0)).add(pulse.mul(3.2)));
        const flick = step(0.06, ndHash11(floor(u.time.mul(11.0)).add(seed))).mul(0.25).add(0.75);
        // Lit faces are never flat slabs: shelves in a vending machine, mullions in a bridge.
        const cellsY = step(0.16, fract(pW.y.mul(4.2)));
        // Mullions run along whichever way the lit face does.
        const alongZ = step(0.12, fract(pW.z.sub(u.scroll).mul(3.125)));
        const alongX = step(0.1, fract(pW.x.mul(0.8)));
        const cellsH = mix(alongX, alongZ, step(0.5, abs(vNormal.x)));
        const grid = cellsY.mul(cellsH).mul(0.62).add(0.38);
        const lamp = mix(tint.rgb, vec3(1.0, 0.74, 0.3), u.heat.mul(0.6))
            .mul(mask.y).mul(grid).mul(u.neon)
            .mul(mix(float(1.0), flick, step(3600.0, seed)))
            .mul(clear.w.mul(0.5).add(1.0))
            .mul(2.6);
        return ndAtmosphere(u, body.add(lamp).add(pulse.mul(mask.y).mul(1.5)), pW);
    })();
    return material;
}

/**
 * Build one instanced mesh per kind that the plan uses.
 * @param {object} u
 * @param {object[]} items  plan.kit: { kind, x, y, z, yaw, sx, sy, sz, mirror, rgb, seed }
 * @returns {{ parts: Array<{ name: string, mesh: THREE.Mesh, geometry: THREE.BufferGeometry, material: THREE.Material }>,
 *   material: THREE.Material }}
 */
export function createKit(u, items) {
    const material = createKitMaterial(u);
    const parts = [];
    KIT_KINDS.forEach((kind) => {
        const list = items.filter((item) => item.kind === kind);
        if (!list.length) return;
        const geometry = KIT_PIECES[kind]();
        const aPos = new Float32Array(list.length * 4);
        const aScale = new Float32Array(list.length * 4);
        const aTint = new Float32Array(list.length * 4);
        list.forEach((it, i) => {
            aPos.set([it.x, it.y, it.z, it.yaw || 0], i * 4);
            aScale.set([it.sx ?? 1, it.sy ?? 1, it.sz ?? 1, it.seed ?? 0], i * 4);
            const rgb = it.rgb || [0.7, 0.9, 1.0];
            aTint.set([rgb[0], rgb[1], rgb[2], it.mirror ? -1 : 1], i * 4);
        });
        geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 4));
        geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 4));
        geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint, 4));
        geometry.instanceCount = list.length;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `NeonDistrictKit:${kind}`;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        // The material is shared: only the first part disposes it.
        parts.push({
            name: `kit-${kind}`, mesh, geometry, material: parts.length ? null : material, count: list.length,
        });
    });
    return { parts, material };
}
