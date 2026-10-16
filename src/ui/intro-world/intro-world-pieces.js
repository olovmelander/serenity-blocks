/**
 * First Light — the pieces: solid tetrominoes of coloured lacquer, rising.
 *
 * Each of the seven shapes is ONE fused solid (its outline extruded a cell deep with rounded
 * edges and corners), never four cubes: the game's pieces are solid colour. Seven instanced
 * draws share one material (one pipeline: the attribute layout is the same).
 *
 * A piece is shaded as polished solid colour, by its own light (nothing in the scene is a
 * three.js light):
 *   - its body: its colour (deepened, a touch desaturated) lit by a cream key from above, by the
 *     glow from below (deep violet to abyssal cyan across the frame), with a faint glow of its own;
 *   - a clear coat (Fresnel) mirroring the sky function, so the lacquer holds the light that
 *     surrounds it, the key's highlight, and a cool rim (cyan below, violet above);
 *   - air: the far pieces sink into the sky behind them, so depth reads at a glance;
 *   - a touch (a click, a press) flashes it; a piece that must leave the frame's quiet zones
 *     shrinks away with a glow.
 */

import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    normalGeometry,
    normalize,
    positionGeometry,
    pow,
    reflect,
    select,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    PIECE_CELLS, PIECE_COLORS, PIECE_KEYS, srgbToLinear,
} from './intro-world-core.js';
import {
    flFresnel, flLuma, flQuatRotate, flSkySoft,
} from './intro-world-tsl.js';

/** Floats per piece: place (xyz, scale), turn (quaternion), tint (rgb, glow), state (flash, presence, seed, air). */
export const PIECE_STRIDE = 16;
/** How far the rounded edge reaches in from a face (cells), and a corner's radius seen face on. */
export const PIECE_BEVEL = 0.12;
export const PIECE_CORNER = 0.16;

const KEY_DIR = /* @__PURE__ */ vec3(-0.42, 0.78, 0.46).normalize();

// ── The shapes as fused solids ──────────────────────────────────────────────────

/**
 * The outline of a set of unit cells (centres on the half grid) as the corners of one polygon,
 * anticlockwise. Shared edges cancel; collinear runs are merged.
 * @param {number[]} cells eight numbers: x, y of four cell centres
 * @returns {number[][]}
 */
export function pieceOutline(cells) {
    const key = (x, y) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
    const all = [];
    for (let i = 0; i < 8; i += 2) {
        const cx = cells[i];
        const cy = cells[i + 1];
        if (!all.some(([x, y]) => x === cx && y === cy)) all.push([cx, cy]);
    }
    const corners = (cx, cy) => [
        [cx - 0.5, cy - 0.5], [cx + 0.5, cy - 0.5], [cx + 0.5, cy + 0.5], [cx - 0.5, cy + 0.5],
    ];
    const counts = new Map();
    const undirected = (a, b) => [key(...a), key(...b)].sort().join('|');
    for (const [cx, cy] of all) {
        const c = corners(cx, cy);
        for (let k = 0; k < 4; k++) {
            const id = undirected(c[k], c[(k + 1) % 4]);
            counts.set(id, (counts.get(id) || 0) + 1);
        }
    }
    const edges = new Map();
    for (const [cx, cy] of all) {
        const c = corners(cx, cy);
        for (let k = 0; k < 4; k++) {
            const a = c[k];
            const b = c[(k + 1) % 4];
            if (counts.get(undirected(a, b)) === 1) edges.set(key(...a), { from: a, to: b });
        }
    }
    const first = edges.values().next().value;
    const loop = [first.from];
    let at = first.to;
    for (let guard = 0; guard < 64 && key(...at) !== key(...first.from); guard++) {
        loop.push(at);
        at = edges.get(key(...at)).to;
    }
    const out = [];
    for (let i = 0; i < loop.length; i++) {
        const p = loop[(i + loop.length - 1) % loop.length];
        const c = loop[i];
        const n = loop[(i + 1) % loop.length];
        const cross = (c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0]);
        if (Math.abs(cross) > 1e-9) out.push(c);
    }
    return out;
}

/** The outline drawn in by `inset` and rounded at every corner. */
function roundedShape(outline, inset, convexR, concaveR) {
    const n = outline.length;
    const pts = [];
    for (let i = 0; i < n; i++) {
        const p = outline[(i + n - 1) % n];
        const c = outline[i];
        const q = outline[(i + 1) % n];
        const d1 = [Math.sign(c[0] - p[0]), Math.sign(c[1] - p[1])];
        const d2 = [Math.sign(q[0] - c[0]), Math.sign(q[1] - c[1])];
        const n1 = [-d1[1], d1[0]];
        const n2 = [-d2[1], d2[0]];
        const convex = d1[0] * d2[1] - d1[1] * d2[0] > 0;
        pts.push({
            at: [c[0] + (n1[0] + n2[0]) * inset, c[1] + (n1[1] + n2[1]) * inset],
            d1,
            d2,
            r: convex ? convexR : concaveR,
        });
    }
    const shape = new THREE.Shape();
    for (let i = 0; i < n; i++) {
        const {
            at, d1, d2, r,
        } = pts[i];
        const a = [at[0] - d1[0] * r, at[1] - d1[1] * r];
        const b = [at[0] + d2[0] * r, at[1] + d2[1] * r];
        if (i === 0) shape.moveTo(a[0], a[1]);
        else shape.lineTo(a[0], a[1]);
        shape.quadraticCurveTo(at[0], at[1], b[0], b[1]);
    }
    shape.closePath();
    return shape;
}

/** One shape as a fused solid with rounded edges, smooth normals everywhere, centred. */
export function createShapeGeometry(cells, bevel = 3) {
    const shape = roundedShape(pieceOutline(cells), PIECE_BEVEL, PIECE_CORNER, PIECE_CORNER * 0.45);
    const solid = new THREE.ExtrudeGeometry(shape, {
        depth: 1 - PIECE_BEVEL * 2,
        bevelEnabled: true,
        bevelThickness: PIECE_BEVEL,
        bevelSize: PIECE_BEVEL,
        bevelOffset: 0,
        bevelSegments: Math.max(1, bevel),
        curveSegments: Math.max(2, bevel + 1),
    });
    solid.translate(0, 0, -(1 - PIECE_BEVEL * 2) / 2);
    solid.deleteAttribute('uv');
    solid.deleteAttribute('normal');
    const merged = mergeVertices(solid, 1e-5);
    solid.dispose();
    merged.computeVertexNormals();
    return merged;
}

/**
 * @param {object} u shared uniforms: haloDir, light, breath
 * @param {{ count?: number, bevel?: number }} [options] count = most instances of one shape
 */
export function createPieces(u, { count = 8, bevel = 3 } = {}) {
    const place = attribute('aPlace', 'vec4');
    const turn = attribute('aTurn', 'vec4');
    const tint = attribute('aTint', 'vec4');
    const state = attribute('aState', 'vec4');

    // Leaving a quiet zone (the title, the menu's navigation) it shrinks away to nothing.
    const shown = select(state.y.greaterThan(0.002), float(1.0), float(0.0));
    const presence = state.y.mul(state.y).mul(float(3.0).sub(state.y.mul(2.0)));
    const scale = place.w.mul(presence).mul(shown);
    const world = place.xyz.add(flQuatRotate(turn, positionGeometry).mul(scale));

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    material.name = 'FirstLightPieces';
    material.fog = false;
    material.depthWrite = true;
    material.depthTest = true;
    material.positionNode = world;

    const vWorld = varying(world, 'flPieceWorld');
    const vNormal = varying(flQuatRotate(turn, normalGeometry), 'flPieceNormal');
    const vTint = varying(tint, 'flPieceTint');
    const vState = varying(state, 'flPieceState');

    material.colorNode = Fn(() => {
        const toPoint = vWorld.sub(cameraPosition).toVar();
        const V = normalize(toPoint).toVar();
        const N = normalize(vNormal).toVar();
        const cosI = clamp(dot(V, N).negate(), 0.0, 1.0).toVar();
        const F = flFresnel(cosI, 0.05).toVar();
        // The lacquer, deepened and a touch desaturated, so it sits in the dark rather than on it.
        const rgb = mix(vec3(flLuma(vTint.rgb)), vTint.rgb, 0.8).mul(0.82);
        const flash = vState.x;

        // ── The body ──
        const key = max(dot(N, KEY_DIR), 0.0);
        const keyCol = vec3(1.0, 0.94, 0.86);
        const up = clamp(N.y.negate().mul(0.5).add(0.5), 0.0, 1.0);
        // The glow from below: deep violet on the left, abyssal cyan on the right.
        const hazeCol = mix(vec3(0.254, 0.147, 1.0), vec3(0.0, 0.55, 0.74), clamp(N.x.mul(0.5).add(0.5), 0.0, 1.0));
        // A light of its own, deeper toward the piece's middle (seen face on): the lacquer glows a
        // little from within, as the wordmark does.
        const own = float(0.04).add(vTint.w).add(cosI.mul(cosI).mul(0.03));
        // Lit faces against shaded ones: the key is squared so a piece has a light side and a dark one.
        const lit = keyCol.mul(key.mul(key).mul(0.78)).add(hazeCol.mul(up.mul(up).mul(0.28)));
        const diffuse = rgb.mul(lit.add(0.016).add(own));

        // ── The clear coat: the sky off the surface, the key's highlight ──
        const R = reflect(V, N);
        const reflected = flSkySoft(R, u.haloDir, u.light).mul(3.6);
        const H = normalize(KEY_DIR.sub(V));
        const nh = clamp(dot(N, H), 0.0, 1.0);
        const spec = pow(nh, 96.0).mul(1.6).add(pow(nh, 18.0).mul(0.12));
        const m = float(1.0).sub(cosI);
        // A cool Fresnel rim: cyan (#4AD8FF) on the edges facing the glow below, violet (#8A6BFF)
        // above, with a faint wash of the glow itself.
        const rimCol = mix(vec3(0.254, 0.147, 1.0), vec3(0.0685, 0.687, 1.0), up);
        const rim = rimCol.mul(m.mul(m).mul(m).mul(0.55)).add(hazeCol.mul(m.mul(m).mul(up).mul(0.15)));

        const col = diffuse.mul(float(1.0).sub(F)).add(reflected.mul(F)).add(keyCol.mul(spec)).add(rim)
            .toVar();
        // A touch (or a lock with its twin) flashes it.
        col.addAssign(mix(rgb, vec3(1.0), 0.4).mul(flash.mul(1.6)));

        // ── Air: far pieces sink into the sky behind them ──
        const dist = length(toPoint);
        const air = float(1.0).sub(exp(max(dist.sub(26.0), 0.0).mul(-0.026))).mul(vState.w);
        const behind = flSkySoft(V, u.haloDir, u.light).mul(1.1);
        col.assign(mix(col, behind, clamp(air, 0.0, 0.92)));
        return vec4(max(col.mul(u.breath.mul(0.12).add(0.92)), vec3(0.0)), 1.0);
    })();

    const group = new THREE.Group();
    group.name = 'FirstLightPieces';
    const shapes = PIECE_KEYS.map((key) => {
        const geometry = new THREE.InstancedBufferGeometry();
        const solid = createShapeGeometry(PIECE_CELLS[key], bevel);
        geometry.index = solid.index;
        geometry.setAttribute('position', solid.getAttribute('position'));
        geometry.setAttribute('normal', solid.getAttribute('normal'));
        const data = new Float32Array(count * PIECE_STRIDE);
        const buffer = new THREE.InstancedInterleavedBuffer(data, PIECE_STRIDE, 1);
        buffer.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aPlace', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
        geometry.setAttribute('aTurn', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
        geometry.setAttribute('aTint', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
        geometry.setAttribute('aState', new THREE.InterleavedBufferAttribute(buffer, 4, 12));
        // Never zero instances: a dormant piece of no size keeps the draw (and its pipeline).
        geometry.instanceCount = 1;
        data[7] = 1;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `FirstLightPiece${key}`;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 10;
        group.add(mesh);
        return {
            key, mesh, geometry, data, buffer, solid, used: 0, rgb: srgbToLinear(PIECE_COLORS[key]),
        };
    });

    return {
        mesh: group,
        material,
        shapes,
        /** Start a frame's writes. */
        begin() {
            for (let i = 0; i < shapes.length; i++) shapes[i].used = 0;
        },
        /**
         * One piece: shape 0..6, place [x, y, z], scale, q [x, y, z, w], glow, flash 0..1,
         * presence 0..1, seed, air 0..1 (how much the distance hazes it).
         */
        write(p) {
            const s = shapes[p.shape];
            if (!s || s.used >= count) return;
            const o = s.used * PIECE_STRIDE;
            s.used += 1;
            const d = s.data;
            d[o] = p.x;
            d[o + 1] = p.y;
            d[o + 2] = p.z;
            d[o + 3] = p.scale;
            d[o + 4] = p.q[0];
            d[o + 5] = p.q[1];
            d[o + 6] = p.q[2];
            d[o + 7] = p.q[3];
            d[o + 8] = s.rgb[0];
            d[o + 9] = s.rgb[1];
            d[o + 10] = s.rgb[2];
            d[o + 11] = p.glow ?? 0;
            d[o + 12] = p.flash ?? 0;
            d[o + 13] = p.presence ?? 1;
            d[o + 14] = p.seed ?? 0;
            d[o + 15] = p.air ?? 1;
        },
        /** Upload this frame's writes; a shape with no piece keeps one dormant instance. */
        commit() {
            for (let i = 0; i < shapes.length; i++) {
                const s = shapes[i];
                if (s.used === 0) {
                    s.data.fill(0, 0, PIECE_STRIDE);
                    s.data[7] = 1;
                }
                s.geometry.instanceCount = Math.max(1, s.used);
                s.buffer.needsUpdate = true;
            }
        },
        dispose() {
            group.removeFromParent();
            shapes.forEach((s) => {
                s.geometry.dispose();
                s.solid.dispose();
            });
            material.dispose();
        },
    };
}
