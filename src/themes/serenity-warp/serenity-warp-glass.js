/**
 * Serenity Warp — the pieces: solid tetrominoes of coloured crystal, adrift on the current.
 *
 * Each of the seven shapes is ONE fused solid: its outline (the union of its four cells) is
 * extruded a cell deep with rounded edges and corners, so a piece reads as one block of colour,
 * as the game's pieces do, never as four cubes. A lock's piece keeps the turn it locked in: the
 * mesh is the shape in its spawn orientation, turned by a quarter turn per step about its face.
 *
 * Seven instanced draws (one per shape) share one material. A piece is shaded as polished,
 * solid colour:
 *   - its body is its own colour, lit by the gate (the scene's one light, wrapped round the
 *     sides) and by the sky's glow, with a soft light of its own as the game's pieces have;
 *   - a clear coat reflects the sky (Fresnel, so the rounded edges catch a bright rim) and a
 *     sharp glint of the gate runs over the faces that catch it, with now and then a sheen
 *     sweeping across the whole piece;
 *   - a little of the sky shows THROUGH it, bent by the piece itself (the light is traced in
 *     the piece's own frame to where it leaves the union of its cells, and stained by the
 *     length it travelled), enough to make it crystal rather than plastic;
 *   - a chain charges it (it glows from within), it is white hot when new, and falling into the
 *     throat it burns to light.
 * It is drawn solid (it writes depth): the sky behind it is not shaded, and the stars and dust
 * pass behind it.
 */

import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    Fn,
    If,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    max,
    min,
    mix,
    mod,
    normalGeometry,
    normalize,
    positionGeometry,
    pow,
    reflect,
    refract,
    select,
    sign,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    GATE, SHAPES, SHAPE_KEYS, cellsFromMatrix, packCells,
} from './serenity-warp-core.js';
import { swQuatRotate } from './serenity-warp-tsl.js';

/** Floats per piece in an instance buffer: place, turn, tint, shape, state (five vec4). */
export const GLASS_STRIDE = 20;
/** Index of refraction, and how strongly the crystal is stained per cell of path. */
export const GLASS_IOR = 1.5;
export const GLASS_ABSORB = 1.6;
/** How far the rounded edge reaches in from a face (cells), and the radius of a corner seen face on. */
export const PIECE_BEVEL = 0.1;
export const PIECE_CORNER = 0.14;

/** A soft light from above, a little toward us and to the right (world space). */
const TOP_LIGHT = /* @__PURE__ */ vec3(0.36, 0.84, 0.4).normalize();
/** The throat itself, down the axis (the camera stands at the origin). */
const GATE_POINT = /* @__PURE__ */ vec3(0.0, 0.0, -GATE.distance);

/** A cell code (see packCell) → its offset (x, y) in cells. */
const decodeCell = (code) => {
    const c = floor(code.add(0.5));
    const hi = floor(c.div(32.0));
    return vec2(hi.sub(8.0), c.sub(hi.mul(32.0)).sub(8.0)).mul(0.5);
};

/**
 * One box of the union against a ray (origin o, inverse direction inv): (near, far, the axis
 * of the face it leaves by: 0, 1 or 2). Pure, laid out once.
 */
const boxSlab = /* @__PURE__ */ Fn(([o, inv, centre]) => {
    const lo = centre.sub(0.5).sub(o).mul(inv);
    const hi = centre.add(0.5).sub(o).mul(inv);
    const tmin = min(lo, hi);
    const tmax = max(lo, hi);
    const near = max(tmin.x, max(tmin.y, tmin.z));
    const far = min(tmax.x, min(tmax.y, tmax.z));
    const axis = select(far.equal(tmax.x), float(0.0), select(far.equal(tmax.y), float(1.0), float(2.0)));
    return vec3(near, far, axis);
}).setLayout({
    name: 'sw_boxSlab',
    type: 'vec3',
    inputs: [{ name: 'o', type: 'vec3' }, { name: 'inv', type: 'vec3' }, { name: 'centre', type: 'vec3' }],
});

/** Schlick's Fresnel, written as products (a pow of a hair below zero is NaN). */
const fresnel = (cosI, f0) => {
    const m = clamp(float(1.0).sub(cosI), 0.0, 1.0);
    const m2 = m.mul(m);
    return float(f0).add(float(1 - f0).mul(m2.mul(m2).mul(m)));
};

// ── The shapes as fused solids ──────────────────────────────────────────────────

/**
 * The outline of a set of unit cells (centres on the half grid) as the corners of one polygon,
 * anticlockwise. Shared edges cancel; collinear runs are merged.
 * @param {number[]} cells  eight numbers: x, y of four cell centres
 * @returns {number[][]} [[x, y], …]
 */
export function pieceOutline(cells) {
    const key = (x, y) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
    const edges = new Map(); // "from" → [to] (directed, anticlockwise round each cell)
    const all = [];
    for (let i = 0; i < 8; i += 2) {
        const cx = cells[i];
        const cy = cells[i + 1];
        if (all.some(([x, y]) => x === cx && y === cy)) continue;
        all.push([cx, cy]);
    }
    const counts = new Map();
    const corners = (cx, cy) => [[cx - 0.5, cy - 0.5], [cx + 0.5, cy - 0.5], [cx + 0.5, cy + 0.5], [cx - 0.5, cy + 0.5]];
    for (const [cx, cy] of all) {
        const c = corners(cx, cy);
        for (let k = 0; k < 4; k++) {
            const a = c[k];
            const b = c[(k + 1) % 4];
            const undirected = [key(...a), key(...b)].sort().join('|');
            counts.set(undirected, (counts.get(undirected) || 0) + 1);
        }
    }
    for (const [cx, cy] of all) {
        const c = corners(cx, cy);
        for (let k = 0; k < 4; k++) {
            const a = c[k];
            const b = c[(k + 1) % 4];
            const undirected = [key(...a), key(...b)].sort().join('|');
            if (counts.get(undirected) === 1) edges.set(key(...a), { from: a, to: b });
        }
    }
    const first = edges.values().next().value;
    const loop = [first.from];
    let at = first.to;
    for (let guard = 0; guard < 64 && key(...at) !== key(...first.from); guard++) {
        loop.push(at);
        at = edges.get(key(...at)).to;
    }
    // Merge collinear runs: keep only the corners.
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

/** The outline drawn in by `inset` and rounded at every corner, as a THREE.Shape. */
function roundedShape(outline, inset, convexR, concaveR) {
    const n = outline.length;
    const pts = [];
    for (let i = 0; i < n; i++) {
        const p = outline[(i + n - 1) % n];
        const c = outline[i];
        const q = outline[(i + 1) % n];
        const d1 = [Math.sign(c[0] - p[0]), Math.sign(c[1] - p[1])];
        const d2 = [Math.sign(q[0] - c[0]), Math.sign(q[1] - c[1])];
        // Inward normals of an anticlockwise outline are the directions turned left.
        const n1 = [-d1[1], d1[0]];
        const n2 = [-d2[1], d2[0]];
        const convex = d1[0] * d2[1] - d1[1] * d2[0] > 0;
        pts.push({
            at: [c[0] + (n1[0] + n2[0]) * inset, c[1] + (n1[1] + n2[1]) * inset], d1, d2, r: convex ? convexR : concaveR,
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

/**
 * One shape as a fused solid with rounded edges: cells of unit size, a cell deep, centred where
 * cellsFromMatrix centres its cells, smooth normals everywhere.
 */
export function createShapeGeometry(cells, bevel = 3) {
    const outline = pieceOutline(cells);
    const shape = roundedShape(outline, PIECE_BEVEL, PIECE_CORNER, PIECE_CORNER * 0.45);
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
 * The quarter turns that take a shape's spawn cells to `cells`, and which shape they are.
 * Returns { shape: 0..6, turns: 0..3 }, or null when the cells are no tetromino.
 */
export function matchShape(cells) {
    if (!Array.isArray(cells) && !(cells instanceof Float32Array)) return null;
    const want = new Set();
    for (let i = 0; i < 8; i += 2) want.add(`${cells[i]},${cells[i + 1]}`);
    for (let s = 0; s < SHAPE_KEYS.length; s++) {
        const base = cellsFromMatrix(SHAPES[SHAPE_KEYS[s]]);
        for (let k = 0; k < 4; k++) {
            const got = new Set();
            for (let i = 0; i < 8; i += 2) {
                let x = base[i];
                let y = base[i + 1];
                // A quarter turn anticlockwise per step (as the mesh is turned about its face).
                for (let j = 0; j < k; j++) [x, y] = [-y, x];
                got.add(`${x + 0},${y + 0}`);
            }
            if (got.size === want.size && [...want].every((c) => got.has(c))) return { shape: s, turns: k };
        }
    }
    return null;
}

/**
 * @param {object} u  shared uniforms
 * @param {{ count: number, bevel: number, dispersion: boolean }} options
 */
export function createGlass(u, { count = 24, bevel = 3 } = {}) {
    const place = attribute('aPlace', 'vec4');
    const turn = attribute('aTurn', 'vec4');
    const tint = attribute('aTint', 'vec4');
    const shape = attribute('aShape', 'vec4');
    const state = attribute('aState', 'vec4');

    // ── Vertex: the fall's stretch, the piece's turn and place ──
    const local = positionGeometry;
    const conj = vec4(turn.xyz.negate(), turn.w);
    const scale = max(place.w, 1e-6);
    // Falling into the throat, the piece is drawn out toward it (its near half stays put).
    const toGate = normalize(u.gateDir.mul(100.0).sub(place.xyz));
    const toGateLocal = swQuatRotate(conj, toGate);
    const reach = dot(local, toGateLocal);
    const fall = state.y;
    const stretched = local.add(toGateLocal.mul(max(reach.add(0.6), 0.0).mul(fall.mul(fall).mul(9.0))));
    const world = place.xyz.add(swQuatRotate(turn, stretched).mul(place.w));

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    material.name = 'SerenityWarpPieces';
    material.fog = false;
    material.depthWrite = true;
    material.depthTest = true;
    material.positionNode = world;

    const vWorld = varying(world, 'swPieceWorld');
    const vNormal = varying(swQuatRotate(turn, normalGeometry), 'swPieceNormal');
    const vLocal = varying(local, 'swPieceLocal');
    const vNormalLocal = varying(normalGeometry, 'swPieceNormalLocal');
    const vEye = varying(swQuatRotate(conj, cameraPosition.sub(place.xyz)).div(scale), 'swPieceEye');
    const vTurn = varying(turn, 'swPieceTurn');
    const vTint = varying(tint, 'swPieceTint');
    const vShape = varying(shape, 'swPieceShape');
    const vState = varying(state, 'swPieceState');

    material.colorNode = Fn(() => {
        const V = normalize(vWorld.sub(cameraPosition)).toVar();
        const N = normalize(vNormal).toVar();
        const cosI = clamp(dot(V, N).negate(), 0.0, 1.0).toVar();
        const F = fresnel(cosI, 0.045).toVar();
        const { rgb } = vTint;
        const charge = vTint.w;
        const hot = vState.x;
        const fallen = vState.y;

        // ── The body: its own colour, lit by the gate (from where it really stands, so a piece
        //    beside it is lit on that side), by a soft light from above and the sky, with a light
        //    of its own as the game's pieces have ──
        const toThroat = normalize(GATE_POINT.sub(vWorld)).toVar();
        const toward = dot(N, toThroat);
        const key = clamp(toward.add(0.45).div(1.45), 0.0, 1.0);
        const keyLight = u.gateCol.mul(key.mul(key).mul(0.75)).mul(u.gateGain);
        const top = clamp(dot(N, TOP_LIGHT), 0.0, 1.0);
        const sky = mix(u.deep, u.glow, N.y.mul(0.5).add(0.5)).mul(0.14).add(0.12);
        const own = float(0.34).add(charge.mul(1.1));
        const body = rgb.mul(keyLight.add(sky).add(top.mul(0.62)).add(own)).toVar();
        // Gloss: the light from above as a highlight, and a lighter rim round the rounded edges.
        const half = normalize(TOP_LIGHT.sub(V));
        const spec = pow(clamp(dot(N, half), 0.0, 1.0), 56.0).mul(0.75);
        const m = float(1.0).sub(cosI);
        const rim = m.mul(m).mul(m).mul(0.3);
        // The throat behind it outlines the piece: the silhouette on the gate's side burns in the
        // gate's light (an edge light), and seen with the gate behind it the crystal glows through
        // in its own colour, as stained glass does against a window.
        const edgeLit = m.mul(m).mul(clamp(toward.mul(0.8).add(0.35), 0.0, 1.0));
        const backlit = clamp(dot(V, toThroat), 0.0, 1.0);
        const b2 = backlit.mul(backlit);
        const b8 = b2.mul(b2).mul(b2.mul(b2));
        const gateRim = mix(u.gateCol, rgb, 0.3).mul(edgeLit.mul(0.95)).mul(u.gateGain);
        // Not while it is still white hot: a run of hard drops piles newborn pieces in front of
        // the gate, and their glow on top of the heat washed the whole gate out.
        const cool = clamp(float(1.0).sub(vState.x), 0.0, 1.0);
        const glowThrough = rgb.mul(b8.mul(0.5).add(b2.mul(0.1))).mul(u.gateGain).mul(cool.mul(cool));

        // ── A little of the sky seen through it, bent and stained by the crystal ──
        const o = vLocal.toVar();
        const dIn = normalize(vLocal.sub(vEye));
        const t1 = refract(dIn, normalize(vNormalLocal), 1.0 / GLASS_IOR).toVar();
        const safe = t1.add(sign(t1).add(step(abs(t1), vec3(1e-6))).mul(1e-6));
        const inv = vec3(1.0).div(safe).toVar();
        const c0 = vec3(decodeCell(vShape.x), 0.0).toVar();
        const c1 = vec3(decodeCell(vShape.y), 0.0).toVar();
        const c2 = vec3(decodeCell(vShape.z), 0.0).toVar();
        const c3 = vec3(decodeCell(vShape.w), 0.0).toVar();
        const t = float(0.0).toVar();
        const axis = float(2.0).toVar();
        const centres = [c0, c1, c2, c3];
        for (let pass = 0; pass < 4; pass++) {
            for (let i = 0; i < 4; i++) {
                const s = boxSlab(o, inv, centres[i]).toVar();
                If(s.x.lessThanEqual(t.add(1e-3)).and(s.y.greaterThan(t)), () => {
                    t.assign(s.y);
                    axis.assign(s.z);
                });
            }
        }
        const path = clamp(t, 0.0, 6.0).toVar();
        const pick = vec3(step(axis, 0.5), step(0.5, axis).mul(step(axis, 1.5)), step(1.5, axis));
        const nOut = pick.mul(sign(t1)).toVar();
        const bent = refract(t1, nOut.negate(), GLASS_IOR);
        const out = select(dot(bent, bent).lessThan(0.25), reflect(t1, nOut.negate()), bent);
        const through = vec3(u.envAt(swQuatRotate(vTurn, normalize(out))));
        const stain = exp(vec3(1.0).sub(rgb).mul(path.mul(-GLASS_ABSORB)));
        const seen = through.mul(stain).mul(rgb);

        // ── The clear coat: the sky off the surface, the gate's glint, a sheen now and then ──
        const R = reflect(V, N).toVar();
        const reflected = vec3(u.envAt(R));
        const g = max(dot(R, u.gateDir), 0.0);
        const g2 = g.mul(g);
        const g8 = g2.mul(g2).mul(g2.mul(g2));
        const glint = g8.mul(g8).mul(g8.mul(g8)).mul(12.0).add(g8.mul(0.3))
            .mul(u.gateGain);
        const runAt = mod(u.time.mul(0.09).add(vState.z), 1.0).mul(8.0).sub(4.0);
        const across = dot(o, vec3(0.62, 0.48, 0.3)).sub(runAt);
        const sheen = exp(across.mul(across).mul(-2.5)).mul(0.35);

        const heat = mix(rgb, vec3(1.0), 0.45).mul(hot.mul(hot).mul(1.5));
        const col = body.mul(0.82).add(seen.mul(0.3))
            .mul(float(1.0).sub(F))
            .add(reflected.mul(F))
            .add(u.gateCol.mul(glint).mul(F.mul(2.0).add(0.15)))
            .add(mix(rgb, vec3(1.0), 0.35).mul(sheen.mul(F.add(0.35))))
            .add(vec3(spec))
            .add(mix(rgb, vec3(1.0), 0.55).mul(rim))
            .add(gateRim)
            .add(glowThrough)
            .add(heat)
            .toVar();
        // Falling into the throat it burns to light.
        col.assign(mix(col, rgb.mul(5.0).add(u.gateCol.mul(1.5)), fallen.mul(fallen)));
        return vec4(max(col.mul(u.breath.mul(0.75).add(0.25)), vec3(0.0)), 1.0);
    })();

    const group = new THREE.Group();
    group.name = 'SerenityWarpPieces';
    const shapes = SHAPE_KEYS.map((key) => {
        const geometry = new THREE.InstancedBufferGeometry();
        const solid = createShapeGeometry(cellsFromMatrix(SHAPES[key]), bevel);
        geometry.index = solid.index;
        geometry.setAttribute('position', solid.getAttribute('position'));
        geometry.setAttribute('normal', solid.getAttribute('normal'));
        const data = new Float32Array(count * GLASS_STRIDE);
        const buffer = new THREE.InstancedInterleavedBuffer(data, GLASS_STRIDE, 1);
        buffer.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aPlace', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
        geometry.setAttribute('aTurn', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
        geometry.setAttribute('aTint', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
        geometry.setAttribute('aShape', new THREE.InterleavedBufferAttribute(buffer, 4, 12));
        geometry.setAttribute('aState', new THREE.InterleavedBufferAttribute(buffer, 4, 16));
        // Never zero instances: a draw is kept (one dormant piece of no size), so the first
        // frame compiles every pipeline.
        geometry.instanceCount = 1;
        data[7] = 1;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `SerenityWarpPieces${key}`;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 10;
        group.add(mesh);
        return {
            key, mesh, geometry, data, buffer, codes: packCells(cellsFromMatrix(SHAPES[key])), used: 0,
        };
    });

    const part = { mesh: group, material, geometry: null };
    part.count = count;
    part.shapes = shapes;
    /** Start a frame's writes. */
    part.begin = () => {
        for (let i = 0; i < shapes.length; i++) shapes[i].used = 0;
    };
    /**
     * Write one piece of shape `p.shape` (0..6). `place` [x, y, z], `scale`, `turn` quaternion
     * [x, y, z, w] (its quarter turns included), `rgb` + `charge`, `hot` 0..1, `fall` 0..1, `seed`.
     */
    part.write = (p) => {
        const s = shapes[p.shape];
        if (!s || s.used >= count) return;
        const o = s.used * GLASS_STRIDE;
        s.used += 1;
        const { data } = s;
        data[o] = p.place[0];
        data[o + 1] = p.place[1];
        data[o + 2] = p.place[2];
        data[o + 3] = p.scale;
        data[o + 4] = p.turn[0];
        data[o + 5] = p.turn[1];
        data[o + 6] = p.turn[2];
        data[o + 7] = p.turn[3];
        data[o + 8] = p.rgb[0];
        data[o + 9] = p.rgb[1];
        data[o + 10] = p.rgb[2];
        data[o + 11] = p.charge;
        data[o + 12] = s.codes[0];
        data[o + 13] = s.codes[1];
        data[o + 14] = s.codes[2];
        data[o + 15] = s.codes[3];
        data[o + 16] = p.hot;
        data[o + 17] = p.fall;
        data[o + 18] = p.seed;
        data[o + 19] = 0;
    };
    /** Upload what was written this frame; a shape with no piece keeps one dormant instance. */
    part.commit = () => {
        for (let i = 0; i < shapes.length; i++) {
            const s = shapes[i];
            if (s.used === 0) {
                s.data.fill(0, 0, GLASS_STRIDE);
                s.data[7] = 1;
            }
            s.geometry.instanceCount = Math.max(1, s.used);
            s.buffer.needsUpdate = true;
        }
    };
    /** Every instance's data, shape by shape (tests, replays). */
    part.snapshot = () => shapes.map((s) => Array.from(s.data.subarray(0, s.used * GLASS_STRIDE)));
    part.dispose = () => {
        shapes.forEach((s) => s.geometry.dispose());
        material.dispose();
    };
    return part;
}
