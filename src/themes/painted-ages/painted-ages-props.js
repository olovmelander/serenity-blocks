/**
 * Painted Ages — the built things: the timber boardwalk along the overlook spur and the pavilion
 * on its knoll (one merged mesh, one material).
 *
 * The boardwalk follows the spur's real crest (found on the baked land, not on the plan): a deck
 * where the crest is gentle, flights of steps where it climbs, posts down to the ground, two
 * rails, and a lamp every twenty-odd metres. The pavilion stands square on its levelled terrace,
 * turned to the eye: a stone base with steps, eight red lacquered columns, a beam ring with
 * brackets, a double hip roof with upturned corners in dark tile, a gold finial and four red
 * lanterns under the eaves.
 *
 * The material lights itself like the land (sun with the land's own shadow, sky, bounce, the air)
 * and lets its lamps and lanterns glow as the light fails (`u.lamps`).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    exp,
    length,
    uv,
    vec2,
    dot,
    float,
    fract,
    max,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    texture,
    vec3,
    vec4,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EYE, clamp as clampJs } from './painted-ages-core.js';
import { groundHeight } from './painted-ages-field.js';
import { PAVILION, SPUR } from './painted-ages-plan.js';
import { aerial, cloudShadow } from './painted-ages-light.js';
import { shadowAt } from './painted-ages-shadow.js';

/** Surface kinds (the `aKind` attribute). */
export const KIND = Object.freeze({
    wood: 0, lacquer: 1, tile: 2, gold: 3, stone: 4, lantern: 5, lamp: 6, darkWood: 7,
});
const KIND_COLOUR = [
    [0.36, 0.22, 0.13], // weathered timber
    [0.5, 0.06, 0.04], // red lacquer
    [0.11, 0.11, 0.12], // dark tile
    [0.78, 0.55, 0.18], // gold
    [0.46, 0.42, 0.38], // stone
    [0.75, 0.12, 0.06], // lantern paper
    [0.9, 0.7, 0.4], // lamp glass
    [0.18, 0.11, 0.07], // dark timber (undersides, brackets)
];

/** A box between two corners in local space, kind-tagged. */
function box(w, h, d, x, y, z, kind, rotY = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    return tag(g, kind);
}

function tag(geometry, kind) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const kinds = new Float32Array(n).fill(kind);
    g.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
    return g;
}

/** A segment between two world points as an oriented box (width × height section). */
function beam(a, b, w, h, kind) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    const g = new THREE.BoxGeometry(w, h, len);
    const m = new THREE.Matrix4();
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    m.compose(new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    return tag(g, kind);
}

// ── The pavilion ──────────────────────────────────────────────────────────────────

/**
 * A hip roof with upturned corners, as a grid over four faces: rings from the eave (t = 0) to the
 * top (t = 1) with a concave profile; corners lift as they reach the eave.
 */
function hipRoof({
    half, top, rise, lift, y0, rings = 10, perSide = 12, apexHalf = 0.25,
}) {
    const pos = [];
    const idx = [];
    const ringCount = rings + 1;
    const around = perSide * 4;
    for (let r = 0; r < ringCount; r++) {
        const t = r / rings;
        // Concave: steep near the top, flattening to the eave.
        const s = half + (apexHalf - half) * (1 - (1 - t) ** 1.6);
        const y = y0 + rise * t ** 1.35 * (1 - 0.15 * (1 - t)) + (top ? 0 : 0);
        for (let k = 0; k < around; k++) {
            const side = Math.floor(k / perSide);
            const f = (k % perSide) / perSide;
            const a = -1 + 2 * f;
            let x;
            let z;
            if (side === 0) { x = a; z = 1; } else if (side === 1) { x = 1; z = -a; } else if (side === 2) { x = -a; z = -1; } else { x = -1; z = a; }
            const corner = Math.max(Math.abs(x), Math.abs(z)) * Math.min(Math.abs(x), Math.abs(z));
            const up = lift * corner ** 2.2 * (1 - t) ** 2;
            pos.push(x * s, y + up, z * s);
        }
    }
    for (let r = 0; r < rings; r++) {
        for (let k = 0; k < around; k++) {
            const a = r * around + k;
            const b = r * around + ((k + 1) % around);
            const c = a + around;
            const d = b + around;
            idx.push(a, c, b, b, c, d);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return tag(g, KIND.tile);
}

function pavilionParts(glows = []) {
    const parts = [];
    // Stone base: two tiers and a flight of steps toward the eye (+z local).
    parts.push(box(9.6, 0.55, 9.6, 0, 0.275, 0, KIND.stone));
    parts.push(box(8.6, 0.35, 8.6, 0, 0.725, 0, KIND.stone));
    for (let s = 0; s < 4; s++) parts.push(box(3.2, 0.2, 0.42, 0, 0.1 + s * 0.2, 5.15 + (3 - s) * 0.4, KIND.stone));
    // Eight columns: four corners and four between.
    const colH = 3.5;
    const at = [[-3.4, -3.4], [3.4, -3.4], [3.4, 3.4], [-3.4, 3.4], [0, -3.4], [3.4, 0], [0, 3.4], [-3.4, 0]];
    for (const [x, z] of at) {
        const c = new THREE.CylinderGeometry(0.2, 0.23, colH, 10);
        c.translate(x, 0.9 + colH / 2, z);
        parts.push(tag(c, KIND.lacquer));
        parts.push(box(0.55, 0.18, 0.55, x, 0.99, z, KIND.stone));
    }
    // Railing between the columns (low red balustrade), open at the front steps.
    const rail = (x0, z0, x1, z1) => parts.push(beam({ x: x0, y: 1.55, z: z0 }, { x: x1, y: 1.55, z: z1 }, 0.1, 0.1, KIND.lacquer));
    rail(-3.4, -3.4, 3.4, -3.4);
    rail(3.4, -3.4, 3.4, 3.4);
    rail(-3.4, -3.4, -3.4, 3.4);
    rail(-3.4, 3.4, -1.2, 3.4);
    rail(1.2, 3.4, 3.4, 3.4);
    // Beam ring and brackets.
    const by = 0.9 + colH;
    parts.push(box(7.4, 0.32, 0.32, 0, by, 3.4, KIND.lacquer));
    parts.push(box(7.4, 0.32, 0.32, 0, by, -3.4, KIND.lacquer));
    parts.push(box(0.32, 0.32, 7.4, 3.4, by, 0, KIND.lacquer));
    parts.push(box(0.32, 0.32, 7.4, -3.4, by, 0, KIND.lacquer));
    parts.push(box(7.9, 0.22, 7.9, 0, by + 0.3, 0, KIND.darkWood));
    for (const [x, z] of at) parts.push(box(0.6, 0.3, 0.6, x * 1.05, by + 0.45, z * 1.05, KIND.darkWood));
    // Lower roof, a band of wall, upper roof.
    parts.push(hipRoof({
        half: 6.1, rise: 1.5, lift: 1.1, y0: by + 0.55, apexHalf: 4.0,
    }));
    parts.push(box(4.4, 1.0, 4.4, 0, by + 2.5, 0, KIND.lacquer));
    parts.push(hipRoof({
        half: 4.7, rise: 2.5, lift: 0.95, y0: by + 2.95, apexHalf: 0.2,
    }));
    // Finial.
    const ball = new THREE.SphereGeometry(0.32, 10, 8);
    ball.translate(0, by + 5.65, 0);
    parts.push(tag(ball, KIND.gold));
    const spike = new THREE.ConeGeometry(0.12, 1.0, 8);
    spike.translate(0, by + 6.3, 0);
    parts.push(tag(spike, KIND.gold));
    // Lanterns under the lower eave's corners.
    for (const [x, z] of [[-4.6, -4.6], [4.6, -4.6], [4.6, 4.6], [-4.6, 4.6]]) {
        const l = new THREE.SphereGeometry(0.42, 10, 8);
        l.scale(1, 1.25, 1);
        l.translate(x, by - 0.2, z);
        parts.push(tag(l, KIND.lantern));
        glows.push([x, by - 0.2, z, 3.2, 0]);
        parts.push(box(0.04, 0.6, 0.04, x, by + 0.3, z, KIND.darkWood));
    }
    return parts;
}

// ── The boardwalk ─────────────────────────────────────────────────────────────────

/**
 * The spur's crest as found on the land: the plan's crest line, each point moved sideways to the
 * highest ground within 26 m, then smoothed. From the eye's platform out to the pavilion's steps.
 */
export function findCrest(fields, step = 2.2) {
    const ground = (x, z) => groundHeight(fields, x, z, true);
    const pts = [];
    const posts = SPUR.slice(0, 6);
    for (let i = 0; i < posts.length - 1; i++) {
        const a = posts[i];
        const b = posts[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const n = Math.max(1, Math.round(len / step));
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        for (let k = 0; k < n; k++) {
            const t = k / n;
            const cx = a.x + (b.x - a.x) * t;
            const cz = a.z + (b.z - a.z) * t;
            let best = -Infinity;
            let bx = cx;
            let bz = cz;
            for (let o = -26; o <= 26; o += 1) {
                const x = cx + nx * o;
                const z = cz + nz * o;
                const h = ground(x, z) - Math.abs(o) * 0.02;
                if (h > best) {
                    best = h;
                    bx = x;
                    bz = z;
                }
            }
            pts.push({ x: bx, z: bz });
        }
    }
    // Smooth the line (the crest search is jumpy across gullies), then read the ground again.
    for (let pass = 0; pass < 6; pass++) {
        for (let i = 1; i < pts.length - 1; i++) {
            pts[i].x = (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4;
            pts[i].z = (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) / 4;
        }
    }
    // Start a few metres out from the eye (the platform is below the frame) and end at the steps.
    const start = pts.findIndex((p) => Math.hypot(p.x - EYE.x, p.z - EYE.z) > 30);
    const stop = pts.findIndex((p) => Math.hypot(p.x - PAVILION.x, p.z - PAVILION.z) < 10);
    const run = pts.slice(Math.max(0, start), stop > 0 ? stop : pts.length);
    for (const p of run) p.y = ground(p.x, p.z);
    return run;
}

function boardwalkParts(fields, crest, glows = []) {
    const parts = [];
    const ground = (x, z) => groundHeight(fields, x, z, true);
    const width = 1.7;
    const lift = 0.45;
    // The deck's height runs smoothly along the crest: no lower than the ground under its edges.
    const deck = crest.map((p, i) => {
        const prev = crest[Math.max(0, i - 1)];
        const next = crest[Math.min(crest.length - 1, i + 1)];
        const dx = next.x - prev.x;
        const dz = next.z - prev.z;
        const len = Math.hypot(dx, dz) || 1;
        const sx = -dz / len;
        const sz = dx / len;
        const edge = Math.max(ground(p.x + sx * width * 0.5, p.z + sz * width * 0.5), ground(p.x - sx * width * 0.5, p.z - sz * width * 0.5));
        return {
            x: p.x, z: p.z, y: Math.max(p.y, edge) + lift, sx, sz,
        };
    });
    let sinceLamp = 0;
    for (let i = 0; i < deck.length - 1; i++) {
        const a = deck[i];
        const b = deck[i + 1];
        const run = Math.hypot(b.x - a.x, b.z - a.z);
        const rise = b.y - a.y;
        const yaw = Math.atan2(b.x - a.x, b.z - a.z);
        if (Math.abs(rise) / run < 0.14) {
            // A deck section, sloping with the crest.
            parts.push(beam({ x: a.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: b.z }, width, 0.09, KIND.wood));
        } else {
            // A flight: treads of equal rise.
            const steps = Math.max(1, Math.ceil(Math.abs(rise) / 0.18));
            for (let s = 0; s < steps; s++) {
                const t0 = s / steps;
                const t1 = (s + 1) / steps;
                const y = a.y + rise * (rise > 0 ? t1 : t0);
                const x = a.x + (b.x - a.x) * (t0 + t1) * 0.5;
                const z = a.z + (b.z - a.z) * (t0 + t1) * 0.5;
                parts.push(box(width, 0.07, (run / steps) * 1.05, x, y, z, KIND.wood, yaw));
            }
            // Stringers under the flight.
            for (const side of [-1, 1]) {
                const o = side * width * 0.45;
                parts.push(beam({ x: a.x + a.sx * o, y: a.y - 0.15, z: a.z + a.sz * o }, { x: b.x + b.sx * o, y: b.y - 0.15, z: b.z + b.sz * o }, 0.08, 0.24, KIND.darkWood));
            }
        }
        // Posts and rails on both sides.
        for (const side of [-1, 1]) {
            const o = side * (width * 0.5 + 0.04);
            const pa = { x: a.x + a.sx * o, z: a.z + a.sz * o };
            const pb = { x: b.x + b.sx * o, z: b.z + b.sz * o };
            if (i % 2 === 0) {
                const gy = ground(pa.x, pa.z) - 0.3;
                parts.push(beam({ x: pa.x, y: gy, z: pa.z }, { x: pa.x, y: a.y + 1.05, z: pa.z }, 0.1, 0.1, KIND.darkWood));
            }
            parts.push(beam({ x: pa.x, y: a.y + 1.0, z: pa.z }, { x: pb.x, y: b.y + 1.0, z: pb.z }, 0.07, 0.07, KIND.wood));
            parts.push(beam({ x: pa.x, y: a.y + 0.55, z: pa.z }, { x: pb.x, y: b.y + 0.55, z: pb.z }, 0.05, 0.05, KIND.wood));
        }
        sinceLamp += run;
        if (sinceLamp > 22) {
            sinceLamp = 0;
            const o = (width * 0.5 + 0.1);
            const px = a.x + a.sx * o;
            const pz = a.z + a.sz * o;
            parts.push(beam({ x: px, y: a.y, z: pz }, { x: px, y: a.y + 1.9, z: pz }, 0.1, 0.1, KIND.darkWood));
            parts.push(box(0.26, 0.34, 0.26, px, a.y + 2.05, pz, KIND.lamp));
            glows.push([px, a.y + 2.05, pz, 1.6, 1]);
            parts.push(box(0.34, 0.06, 0.34, px, a.y + 2.25, pz, KIND.darkWood));
        }
    }
    return parts;
}

// ── The mesh and its material ─────────────────────────────────────────────────────

export function createProps(u, t, tier, fields) {
    const crest = findCrest(fields);
    const glows = [];
    const walk = boardwalkParts(fields, crest, glows);
    const pavGlows = [];
    const pav = pavilionParts(pavGlows);
    const ground = groundHeight(fields, PAVILION.x, PAVILION.z, true);
    // A grand pavilion (a third larger than life-size plans): it must read as the landmark.
    const place = new THREE.Matrix4().compose(
        new THREE.Vector3(PAVILION.x, ground - 0.3, PAVILION.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), PAVILION.yaw),
        new THREE.Vector3(1.3, 1.3, 1.3),
    );
    for (const g of pav) g.applyMatrix4(place);
    const v = new THREE.Vector3();
    for (const [x, y, z, size, kind] of pavGlows) {
        v.set(x, y, z).applyMatrix4(place);
        glows.push([v.x, v.y, v.z, size, kind]);
    }
    const geometry = mergeGeometries([...walk, ...pav], false);
    for (const g of [...walk, ...pav]) g.dispose();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesProps';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const kindAttr = attribute('aKind', 'float');
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const k = kindAttr;
        const is = (kind) => float(1.0).sub(smoothstep(0.3, 0.5, k.sub(kind).abs()));
        const albedo = vec3(KIND_COLOUR[0][0], KIND_COLOUR[0][1], KIND_COLOUR[0][2]).toVar();
        for (let i = 1; i < KIND_COLOUR.length; i++) {
            albedo.assign(mix(albedo, vec3(KIND_COLOUR[i][0], KIND_COLOUR[i][1], KIND_COLOUR[i][2]), is(i)));
        }
        // Timber grain and weathering: planks and posts are not one flat brown.
        const grain = texture(t.noise, P.xz.mul(0.35)).a;
        albedo.mulAssign(mix(float(1.0), grain.mul(0.5).add(0.75), is(KIND.wood).add(is(KIND.darkWood))));
        // Tile courses on the roof.
        const course = fract(P.y.mul(4.0));
        albedo.mulAssign(mix(float(1.0), smoothstep(0.0, 0.25, course).mul(0.35).add(0.75), is(KIND.tile)));
        const n = normalize(normalWorld);
        const L = u.sunDir;
        const ndl = clamp(dot(n, L), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        const clouds = cloudShadow(u, t.noise, P);
        const direct = u.sun.mul(ndl).mul(shadow).mul(clouds).mul(u.sunUp);
        const skyLight = u.fill.mul(n.y.mul(0.4).add(0.6));
        const bounce = u.bounce.mul(float(1.0).sub(n.y).mul(0.5).add(0.2));
        const lit = albedo.mul(direct.add(skyLight).add(bounce)).toVar();
        // Gold and lacquer catch the sun.
        const view = normalize(u.eye.sub(P));
        const hv = normalize(view.add(L));
        const spec = clamp(dot(n, hv), 0.0, 1.0);
        const s4 = spec.mul(spec).mul(spec).mul(spec);
        const shine = is(KIND.gold).mul(0.9).add(is(KIND.lacquer).mul(0.25)).add(is(KIND.tile).mul(0.12));
        lit.addAssign(u.sun.mul(s4.mul(s4)).mul(shine).mul(shadow).mul(u.sunUp));
        // Lamps and lanterns glow as the light fails.
        const glowKind = is(KIND.lantern).add(is(KIND.lamp));
        const glow = mix(vec3(1.6, 0.42, 0.12), vec3(2.2, 1.35, 0.6), is(KIND.lamp)).mul(u.lamps).mul(glowKind);
        lit.addAssign(glow.mul(4.0));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PaintedAgesProps';
    mesh.renderOrder = 1;
    const halo = createHalos(u, glows);
    return {
        mesh,
        meshes: [mesh, halo.mesh],
        crest,
        glows,
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
            halo.dispose();
        },
    };
}

/**
 * The halos round the lanterns and lamps: one camera-facing quad each (built in clip space from
 * the centre), additive, sized in metres, lit by `u.lamps`. Lanterns glow red-orange, lamps warm.
 */
function createHalos(u, glows) {
    const n = Math.max(1, glows.length);
    const centres = new Float32Array(n * 4 * 4);
    const corners = new Float32Array(n * 4 * 2);
    const positions = new Float32Array(n * 4 * 3);
    const index = [];
    glows.forEach(([x, y, z, size, kind], i) => {
        for (let c = 0; c < 4; c++) {
            const o = i * 4 + c;
            centres.set([x, y, z, kind ? -size : size], o * 4);
            corners.set([c === 1 || c === 2 ? 1 : -1, c >= 2 ? 1 : -1], o * 2);
            positions.set([x, y, z], o * 3);
        }
        const b = i * 4;
        index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aCentre', new THREE.BufferAttribute(centres, 4));
    geometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesHalos';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;
    const centre = attribute('aCentre', 'vec4');
    const corner = attribute('aCorner', 'vec2');
    material.vertexNode = Fn(() => {
        const view = cameraViewMatrix.mul(vec4(centre.xyz, 1.0));
        const lifted = view.add(vec4(corner.mul(centre.w.abs()), 0.0, 0.0));
        return cameraProjectionMatrix.mul(lifted);
    })();
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = Fn(() => {
        const r = length(corner);
        const fall = exp(r.mul(r).mul(-5.5)).sub(0.004).max(0.0);
        const lamp = centre.w.lessThan(0.0).select(1.0, 0.0);
        const tint = mix(vec3(1.4, 0.32, 0.08), vec3(1.5, 0.95, 0.42), lamp);
        return vec4(tint.mul(fall).mul(u.lamps).mul(0.9), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PaintedAgesHalos';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

export {
    clampJs, max, uv, vec2,
};
