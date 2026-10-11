/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the floor of the house: the encaustic-tiled paths, the canal's coping,
 * walls and bed, the landing under the eye, the bed kerbs and their soil, and the two urns that
 * flank the canal's head.
 *
 * Victorian palm houses were floored in encaustic tile: inlaid clay in terracotta, buff, cream
 * and slate, laid in geometric fields between banded borders. The paths here are drawn so, in
 * the shader, in the path's own coordinates (across from the coping, along the house): slate,
 * cream and slate bands at both edges, and a field five octagons wide, the octagons alternating
 * terracotta and buff, with a slate square holding a cream dot where four of them meet. Each
 * tile is laid a hair off true (its own tilt), worn and grimed its own amount, and the floor is
 * wet (it is a glasshouse at night): the grout holds water, and in the hollows the broad noise
 * finds there are puddles, flat and black and mirror-bright. So the floor shows the night
 * mostly in what it reflects: the glow of the vault at grazing angles, the moon through the
 * lattice where a puddle lies in a beam, and under every lantern a long warm streak.
 *
 * The rest is stone: limestone coping with a rounded nose overhanging the water, the canal's
 * ashlar walls (wet, dark, a band of algae at the waterline) down to its silted bed under the
 * water, the landing's flags, the bed kerbs; the beds' loam with moss and fallen leaves; the
 * two campana urns (lathes: plinth, foot, stem, knop, a gadrooned bowl and a flaring lip) with
 * soil in them for the flora to plant.
 *
 * Every surface is lit by mgSurface with its own pixel footprint, so the moon's lattice lies
 * crisp at the eye's feet and softens with distance. Three draw calls: pavement, stone, soil.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, attribute, cameraPosition, clamp, dot, float, floor, fract, int, length, max, min, mix, normalize,
    normalWorldGeometry, positionWorld, pow, reflect, select, smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { FLOOR, HOUSE } from './moonlit-greenhouse-core.js';
import { mgHash21, mgMoonlight, mgSurface } from './moonlit-greenhouse-tsl.js';
import {
    HouseMesh, box, footprint, glassGlow, lathe, sweep,
} from './moonlit-greenhouse-iron.js';

// ── Numbers ─────────────────────────────────────────────────────────────────────────────────

/**
 * The floor's plan beyond FLOOR (metres):
 *   copingInner   the coping's nose overhangs the canal wall to |x| = half − overhang
 *   nose          the nose's radius
 *   bed           the canal's bed under the water (y), a shallow dish deeper in the middle
 *   wallFoot      the canal walls run down to here (below the bed's edge)
 *   kerb          the bed kerbs' width (from |x| = FLOOR.bed.inner outward) and their round
 *   landing       the landing under the eye runs from the head coping to `landing`
 *   tile          the encaustic field: bands at each edge (slate, cream, slate), cells across
 */
export const PAVE = Object.freeze({
    overhang: 0.025,
    nose: 0.05,
    bed: -0.9,
    dish: 0.08,
    wallFoot: -0.98,
    kerb: 0.12,
    kerbRound: 0.03,
    landing: HOUSE.near,
    bands: Object.freeze([0.03, 0.052, 0.064]),
    cells: 5,
});

const PATH_INNER = FLOOR.canal.half + FLOOR.coping;
const PATH_OUTER = FLOOR.path.outer;
const HEAD = FLOOR.canal.head;
const HEAD_BACK = FLOOR.canal.head + FLOOR.coping;
const END = FLOOR.canal.end;
const END_BACK = FLOOR.canal.end - FLOOR.coping;
const SOIL_OUTER = 6.95;

/** The urns' soil stands this far below their lip (the flora plants into it). */
export const URN_SOIL_DROP = 0.06;

/** What a stone vertex is. */
const STONE = Object.freeze({
    coping: 0, wall: 1, bed: 2, urn: 3, kerb: 4,
});

// ── Geometry ────────────────────────────────────────────────────────────────────────────────

/** A flat rectangle (x0..x1, z0..z1) at height y facing up, split along z every `step` metres. */
function flat(mesh, x0, x1, z0, z1, y, values, step = 6, yAt = null) {
    const n = Math.max(1, Math.ceil(Math.abs(z1 - z0) / step));
    const across = yAt ? 6 : 1;
    const rows = [];
    for (let j = 0; j <= n; j += 1) {
        const z = z0 + ((z1 - z0) * j) / n;
        const row = [];
        for (let i = 0; i <= across; i += 1) {
            const x = x0 + ((x1 - x0) * i) / across;
            row.push(mesh.vertex([x, yAt ? yAt(x) : y, z], [0, 1, 0], values));
        }
        rows.push(row);
    }
    for (let j = 0; j < n; j += 1) mesh.strip(rows[j], rows[j + 1]);
}

/** A vertical rectangle in the plane x = x0 from z0..z1 and y0..y1, facing `facing` (±1 in x). */
function wallX(mesh, x0, z0, z1, y0, y1, facing, values) {
    const n = [facing, 0, 0];
    const ids = [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]].map((p) => mesh.vertex(p, n, values));
    mesh.quad(ids[0], ids[1], ids[2], ids[3]);
}

/** A vertical rectangle in the plane z = z0 from x0..x1 and y0..y1, facing `facing` (±1 in z). */
function wallZ(mesh, z0, x0, x1, y0, y1, facing, values) {
    const n = [0, 0, facing];
    const ids = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]].map((p) => mesh.vertex(p, n, values));
    mesh.quad(ids[0], ids[1], ids[2], ids[3]);
}

/**
 * The coping's section, walked with the stone on the left, in (a, b) = (metres away from the
 * water, height): up the path-side face, over the top, round the nose and back under it to the
 * canal wall.
 */
function copingProfile(segments = 8) {
    const w = FLOOR.coping;
    const top = FLOOR.copingHeight;
    const r = PAVE.nose;
    const pts = [[w, 0], [w, top - 0.012], [w - 0.012, top], [r - PAVE.overhang, top]];
    // The nose: round from the top, over the front, back under to the canal wall's face.
    const cx = r - PAVE.overhang;
    const end = Math.PI + Math.acos(cx / r);
    for (let i = 1; i <= segments; i += 1) {
        const a = Math.PI / 2 + (i / segments) * (end - Math.PI / 2);
        pts.push([cx + r * Math.cos(a), top - r + r * Math.sin(a)]);
    }
    return pts;
}

/** Sweep the coping along a straight run: from `start` to `end` with `away` pointing off the water. */
function addCoping(mesh, start, end, away, values) {
    const path = [start, end].map((o) => ({
        o, ea: away, eb: [0, 1, 0], values,
    }));
    const profile = copingProfile();
    // Flat faces, but a smooth nose.
    sweep(mesh, path, profile.slice(0, 4));
    sweep(mesh, path, profile.slice(3), { smooth: true });
}

/** The campana urn's turned profile [r, y] from its plinth up, with the soil inside. */
export function urnProfile(height = 0.95, radius = 0.42) {
    const k = height / 0.95;
    const q = radius / 0.42;
    const pts = [
        [0.17, 0.12, true], [0.176, 0.133], [0.172, 0.147], [0.15, 0.158, true],
        [0.118, 0.166], [0.094, 0.19], [0.084, 0.22], [0.085, 0.244, true],
        [0.108, 0.254], [0.118, 0.268], [0.11, 0.283], [0.098, 0.29, true],
        [0.14, 0.3], [0.215, 0.328], [0.285, 0.378], [0.328, 0.438], [0.344, 0.5], [0.338, 0.55], [0.318, 0.598, true],
        [0.302, 0.63], [0.3, 0.67], [0.31, 0.71], [0.338, 0.758], [0.378, 0.818], [0.408, 0.862], [0.42, 0.884, true],
        [0.426, 0.9], [0.426, 0.928, true], [0.404, 0.95], [0.376, 0.95, true],
        [0.37, 0.93], [0.362, 0.95 - URN_SOIL_DROP],
    ];
    return pts.map(([r, y, c]) => (c ? [r * q, y * k, true] : [r * q, y * k]));
}

/** The urn's gadroons: flutes round the lower bowl (rows 12..18 of the profile). */
function gadroons(phi, t, total) {
    const row = t * total;
    if (row < 12.2 || row > 17.8) return 0;
    const env = Math.sin(((row - 12.2) / 5.6) * Math.PI);
    const c = 0.5 + 0.5 * Math.cos(phi * 20);
    return -0.016 * env * (1 - Math.sqrt(c));
}

/** The urns: plinth, turned body, and their soil (a disc in the soil mesh). */
function addUrn(stone, soil, urn, segments) {
    const { x, z } = urn;
    const h = 0.22 * (urn.radius / 0.42);
    const values = (y) => ({ aStone: [STONE.urn, 0, y, 1] });
    box(stone, [x - h, 0, z - h], [x + h, 0.12 * (urn.height / 0.95), z + h], values(0.05), 'px nx py pz nz');
    const profile = urnProfile(urn.height, urn.radius);
    const total = profile.length - 1;
    lathe(stone, x, z, profile, segments, {
        modulate: (phi, t) => gadroons(phi, t, total),
        values: (phi, y, row) => {
            const inside = row >= total - 1;
            const crevice = row >= 12 && row <= 18 ? 0.8 : 1;
            return { aStone: [STONE.urn, phi, y, inside ? 0.45 : crevice] };
        },
    });
    // The soil, just under the lip.
    const top = urn.height - URN_SOIL_DROP;
    const r = profile[profile.length - 1][0];
    const ring = [];
    const centre = soil.vertex([x, top, z], [0, 1, 0], { aSoil: [1, 0, 0, 0] });
    for (let i = 0; i <= segments; i += 1) {
        const a = (i / segments) * Math.PI * 2;
        ring.push(soil.vertex([x + r * Math.cos(a), top, z + r * Math.sin(a)], [0, 1, 0], { aSoil: [1, 0, 0, 0] }));
    }
    for (let i = 0; i < segments; i += 1) soil.tri(centre, ring[i], ring[i + 1]);
}

/** How finely a tier draws the floor. */
export function floorDetail(tier) {
    const f = tier?.frond ?? 12;
    return { urn: f >= 12 ? 40 : 24, dish: f >= 12 ? 6 : 3 };
}

/**
 * The floor's geometry for a plan and a tier: { pavement, stone, soil } as HouseMesh builders.
 */
export function buildFloorMeshes(plan, tier) {
    const detail = floorDetail(tier);
    const pavement = new HouseMesh({ aPave: 4 });
    const stone = new HouseMesh({ aStone: 4 });
    const soil = new HouseMesh({ aSoil: 4 });
    const tiles = { aPave: [0, 0, 0, 0] };
    const flags = { aPave: [1, 0, 0, 0] };
    // The tiled paths along both sides of the canal, to the far end.
    [-1, 1].forEach((side) => {
        const [x0, x1] = side < 0 ? [-PATH_OUTER, -PATH_INNER] : [PATH_INNER, PATH_OUTER];
        flat(pavement, x0, x1, HEAD_BACK, HOUSE.far, 0, tiles);
    });
    // The landing under the eye, and the floor beyond the canal's end.
    flat(pavement, -PATH_OUTER, PATH_OUTER, PAVE.landing, HEAD_BACK, 0, flags);
    flat(pavement, -PATH_INNER, PATH_INNER, END_BACK, HOUSE.far, 0, flags);

    const coping = { aStone: [STONE.coping, 0, 0, 1] };
    // The coping along both sides and across the head and the end.
    [-1, 1].forEach((side) => {
        const x = side * FLOOR.canal.half;
        addCoping(stone, [x, 0, HEAD_BACK], [x, 0, END_BACK], [side, 0, 0], coping);
    });
    addCoping(stone, [-FLOOR.canal.half, 0, HEAD], [FLOOR.canal.half, 0, HEAD], [0, 0, 1], coping);
    addCoping(stone, [-FLOOR.canal.half, 0, END], [FLOOR.canal.half, 0, END], [0, 0, -1], coping);
    // The canal's walls, down below its bed.
    const wall = { aStone: [STONE.wall, 0, 0, 1] };
    [-1, 1].forEach((side) => {
        wallX(stone, side * FLOOR.canal.half, HEAD, END, PAVE.wallFoot, 0, -side, wall);
    });
    wallZ(stone, HEAD, -FLOOR.canal.half, FLOOR.canal.half, PAVE.wallFoot, 0, -1, wall);
    wallZ(stone, END, -FLOOR.canal.half, FLOOR.canal.half, PAVE.wallFoot, 0, 1, wall);
    // The bed: a shallow dish of silt.
    const { half } = FLOOR.canal;
    flat(
        stone,
        -half,
        half,
        HEAD,
        END,
        PAVE.bed,
        { aStone: [STONE.bed, 0, 0, 1] },
        6,
        (x) => PAVE.bed - PAVE.dish * (1 - (x / half) ** 2),
    );
    // The bed kerbs and the beds' soil, the whole length of the house.
    const kerb = { aStone: [STONE.kerb, 0, 0, 1] };
    const kr = PAVE.kerbRound;
    const kerbTop = FLOOR.bed.kerb;
    const kerbProfile = [[0, 0], [0, kerbTop - kr]];
    for (let i = 1; i <= 4; i += 1) {
        const a = Math.PI - (i / 4) * (Math.PI / 2);
        kerbProfile.push([kr + kr * Math.cos(a), kerbTop - kr + kr * Math.sin(a)]);
    }
    kerbProfile.push([PAVE.kerb - kr, kerbTop]);
    for (let i = 1; i <= 4; i += 1) {
        const a = Math.PI / 2 - (i / 4) * (Math.PI / 2);
        kerbProfile.push([PAVE.kerb - kr + kr * Math.cos(a), kerbTop - kr + kr * Math.sin(a)]);
    }
    kerbProfile.push([PAVE.kerb, FLOOR.bed.soil - 0.02]);
    [-1, 1].forEach((side) => {
        const path = [PAVE.landing, HOUSE.far].map((z) => ({
            o: [side * FLOOR.bed.inner, 0, z], ea: [side, 0, 0], eb: [0, 1, 0], values: kerb,
        }));
        // Walked from the soil over the round top and down the path-side face (stone on the left).
        sweep(stone, path, kerbProfile.slice().reverse(), { smooth: true });
        const [x0, x1] = side < 0 ? [-SOIL_OUTER, -(FLOOR.bed.inner + PAVE.kerb)] : [FLOOR.bed.inner + PAVE.kerb, SOIL_OUTER];
        flat(soil, x0, x1, PAVE.landing, HOUSE.far, FLOOR.bed.soil, { aSoil: [0, 0, 0, 0] });
    });
    plan.urns.forEach((urn) => addUrn(stone, soil, urn, detail.urn));
    return { pavement, stone, soil };
}

// ── Shading ─────────────────────────────────────────────────────────────────────────────────

/**
 * What a wet surface mirrors at p (normal n): the vault's glow at grazing angles, the moon
 * through the lattice, and every lit lantern as a warm streak. `wet` 0..1 scales it, `sharp`
 * 0..1 runs from a tile's sheen to a puddle's mirror.
 */
function wetSheen(p, n, foot, wet, sharp, U) {
    const { night } = U;
    const v = normalize(p.sub(cameraPosition));
    const r = reflect(v, n).toVar();
    const cosV = clamp(dot(n, v).negate(), 0.0, 1.0);
    const f1 = float(1.0).sub(cosV);
    const f2 = f1.mul(f1);
    const fres = f2.mul(f2).mul(f1).mul(0.97).add(0.03);
    const k = mix(float(36.0), float(900.0), sharp);
    const norm = k.mul(0.04).add(1.0);
    const toMoon = max(dot(r, U.moon), 1e-5);
    const vis = mgMoonlight(p, U.moon, foot);
    const moon = night.moonlight.mul(U.moonLight).mul(vis).mul(pow(toMoon, k)).mul(norm)
        .mul(0.35);
    const lamps = vec3(0.0).toVar();
    Loop({
        start: int(0), end: int(U.lanternCount), type: 'int', condition: '<', name: 'lampSheen',
    }, ({ lampSheen }) => {
        const row = U.lanternRows.element(lampSheen);
        const toL = row.xyz.sub(p);
        const d2 = dot(toL, toL);
        const l = toL.div(max(d2, 1e-4).sqrt());
        const lobe = pow(max(dot(r, l), 1e-5), k.mul(0.7));
        lamps.addAssign(vec3(row.w.mul(lobe).mul(norm).div(d2.mul(0.06).add(1.0))));
    });
    const lanterns = lamps.mul(night.lantern).mul(U.lanternGain).mul(0.9);
    const glass = glassGlow(r, U).mul(mix(float(0.55), float(1.0), sharp));
    return glass.add(moon).add(lanterns).mul(fres).mul(wet);
}

/** The encaustic paths and the landing's flags: albedo, the tile's tilt, wetness, puddles. */
function pavementPattern(p, foot, noise) {
    const isFlags = attribute('aPave', 'vec4').x.greaterThan(0.5);
    // ── Tiles.
    const width = float(PATH_OUTER - PATH_INNER);
    const a = clamp(abs(p.x).sub(PATH_INNER), 0.0, width);
    const edge = min(a, width.sub(a));
    const [b0, b1, b2] = PAVE.bands;
    const slate = vec3(0.028, 0.031, 0.038);
    const cream = vec3(0.4, 0.35, 0.26);
    const terracotta = vec3(0.2, 0.072, 0.04);
    const buff = vec3(0.29, 0.19, 0.105);
    const bandCol = select(edge.lessThan(b0), slate, select(edge.lessThan(b1), cream, slate));
    const cell = (PATH_OUTER - PATH_INNER - 2 * b2) / PAVE.cells;
    const g = vec2(a.sub(b2).div(cell), p.z.div(cell));
    const id = floor(g);
    const f = fract(g).sub(0.5);
    const af = abs(f);
    const diamond = af.x.add(af.y);
    const octagon = diamond.lessThan(0.68);
    const checker = fract(id.x.add(id.y).mul(0.5)).greaterThan(0.25);
    const corner = length(af.sub(0.5));
    const fieldCol = select(octagon, select(checker, terracotta, buff), select(corner.lessThan(0.1), cream, slate));
    const inBand = edge.lessThan(b2);
    // Grout: every tile's edge (metres), wider where worn.
    const dOct = abs(diamond.sub(0.68)).mul(0.7071).mul(cell);
    const dCell = float(0.5).sub(max(af.x, af.y)).mul(cell);
    const dBand = min(min(abs(edge.sub(b0)), abs(edge.sub(b1))), abs(edge.sub(b2)));
    const dTile = select(inBand, dBand, min(dOct, dCell));
    const groutW = float(0.0028);
    const grout = float(1.0).sub(smoothstep(groutW.sub(foot.mul(0.5)), groutW.add(foot.mul(0.5)), dTile));
    // Each tile its own: a little fade, a little grime, a little tilt.
    const tileId = select(inBand, vec2(floor(edge.div(0.02)), floor(p.z.div(0.15))), id).add(vec2(select(p.x.lessThan(0.0), 37.0, 0.0), 0.0));
    const h1 = mgHash21(tileId);
    const h2 = mgHash21(tileId.add(vec2(17.3, 5.1)));
    // ── Flags (the landing, the far floor): coursed slabs, half a slab on each course.
    const rowF = floor(p.z.div(0.52));
    const lenF = mgHash21(vec2(rowF, 3.0)).mul(0.3).add(0.62);
    const ux = p.x.div(lenF).add(rowF.mul(0.47));
    const flagId = vec2(floor(ux), rowF);
    const fu = fract(ux);
    const fz = fract(p.z.div(0.52));
    const dFlag = min(min(fu, float(1.0).sub(fu)).mul(lenF), min(fz, float(1.0).sub(fz)).mul(0.52));
    const jointF = float(1.0).sub(smoothstep(float(0.006).sub(foot.mul(0.5)), float(0.006).add(foot.mul(0.5)), dFlag));
    const hf = mgHash21(flagId.add(vec2(9.0, 41.0)));
    const flagCol = mix(vec3(0.13, 0.125, 0.112), vec3(0.19, 0.18, 0.16), hf);
    // ── Shared: grime, wear, the wet.
    const broad = texture(noise, p.xz.mul(0.21));
    const fine = texture(noise, p.xz.mul(1.9));
    const grime = smoothstep(0.35, 0.75, broad.z.mul(0.6).add(fine.w.mul(0.4)));
    const tileCol = select(inBand, bandCol, fieldCol).mul(h1.mul(0.3).add(0.78));
    const baseCol = select(isFlags, flagCol.mul(fine.w.mul(0.35).add(0.8)), tileCol);
    const joint = select(isFlags, jointF, grout);
    const albedo = mix(baseCol.mul(float(1.0).sub(grime.mul(0.35))), vec3(0.035, 0.034, 0.03), joint);
    const tiltId = select(isFlags, vec2(hf, h2.mul(0.7)), vec2(h1, h2));
    const tilt = tiltId.sub(0.5).mul(select(isFlags, float(0.03), float(0.045)));
    // Puddles in the floor's hollows; water standing in the joints.
    const puddle = smoothstep(0.6, 0.68, broad.x.mul(0.8).add(fine.x.mul(0.2)));
    const wet = mix(float(0.45).add(grime.mul(0.15)), float(1.0), max(puddle, joint.mul(0.8)));
    return {
        albedo, tilt, puddle, wet, joint,
    };
}

/**
 * The floor part. ctx = { tier, U, noise, plan }.
 */
export function createFloor({
    tier, U, noise, plan,
}) {
    const built = buildFloorMeshes(plan, tier);
    const group = new THREE.Group();
    group.name = 'moonlit-greenhouse-floor';
    const geometries = [];
    const materials = [];
    const add = (builder, name, colorNode) => {
        const geometry = builder.geometry();
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = name;
        material.colorNode = colorNode;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.frustumCulled = false;
        mesh.renderOrder = 10;
        group.add(mesh);
        geometries.push(geometry);
        materials.push(material);
    };

    // ── The paths and the landing.
    add(built.pavement, 'moonlit-greenhouse-floor-pavement', Fn(() => {
        const p = positionWorld;
        const foot = max(footprint(p), 0.0006);
        const t = pavementPattern(p, foot, noise);
        const flatN = vec3(0.0, 1.0, 0.0);
        const tiled = normalize(vec3(t.tilt.x, 1.0, t.tilt.y));
        const n = normalize(mix(tiled, flatN, max(t.puddle, t.joint))).toVar();
        const albedo = t.albedo.mul(float(1.0).sub(t.wet.mul(0.35)));
        const lit = mgSurface(p, n, albedo, U, { soft: foot });
        const sheen = wetSheen(p, n, foot, t.wet, max(t.puddle, t.joint.mul(0.5)), U);
        return vec4(lit.add(sheen), 1.0);
    })());

    // ── The stone: coping, canal walls and bed, kerbs, urns.
    const S = attribute('aStone', 'vec4');
    add(built.stone, 'moonlit-greenhouse-floor-stone', Fn(() => {
        const p = positionWorld;
        const foot = max(footprint(p), 0.0006);
        const kind = S.x;
        const n = normalWorldGeometry.toVar();
        const isWall = kind.greaterThan(0.5).and(kind.lessThan(1.5));
        const isBed = kind.greaterThan(1.5).and(kind.lessThan(2.5));
        const isUrn = kind.greaterThan(2.5).and(kind.lessThan(3.5));
        const axial = select(abs(n.x).greaterThan(0.7), p.zy, select(abs(n.z).greaterThan(0.7), p.xy, p.xz));
        const uvs = select(isUrn, vec2(S.y.mul(0.42), S.z), axial);
        const broad = texture(noise, uvs.mul(0.6));
        const fine = texture(noise, uvs.mul(3.1));
        // Limestone, weathered: mottled, lichen-spotted, darker toward the water.
        const lime = mix(vec3(0.13, 0.126, 0.112), vec3(0.2, 0.192, 0.17), broad.x).mul(fine.w.mul(0.3).add(0.8));
        const lichen = smoothstep(0.62, 0.7, fine.z.mul(0.7).add(broad.z.mul(0.3)));
        const dry = mix(lime, vec3(0.1, 0.11, 0.085), lichen.mul(0.6));
        // The canal walls: coursed ashlar, wet, with a band of algae at the waterline.
        const courseH = 0.29;
        const cy = p.y.div(courseH);
        const along = select(abs(n.x).greaterThan(0.5), p.z, p.x).div(0.62).add(floor(cy).mul(0.5));
        const dj = min(abs(fract(cy).sub(0.5)).mul(-1.0).add(0.5).mul(courseH), abs(fract(along).sub(0.5)).mul(-1.0).add(0.5).mul(0.62));
        const ashlarJoint = float(1.0).sub(smoothstep(0.004, float(0.008).add(foot), dj));
        const waterline = float(FLOOR.canal.water);
        const algae = smoothstep(waterline.sub(0.18), waterline.sub(0.02), p.y).mul(float(1.0).sub(smoothstep(waterline.add(0.02), waterline.add(0.14), p.y)));
        const wallCol = mix(vec3(0.045, 0.046, 0.042).mul(fine.w.mul(0.4).add(0.7)), vec3(0.02, 0.04, 0.025), algae.mul(0.8))
            .mul(float(1.0).sub(ashlarJoint.mul(0.5)))
            .mul(select(p.y.lessThan(waterline), float(0.5), float(1.0)));
        // The bed: dark silt.
        const bedCol = vec3(0.012, 0.014, 0.012).mul(broad.x.mul(0.6).add(0.7));
        // The urns: cleaner stone, mossy at the foot, the crevices dark.
        const urnCol = mix(vec3(0.17, 0.165, 0.148), vec3(0.03, 0.05, 0.025), smoothstep(0.32, 0.05, p.y).mul(0.7))
            .mul(fine.w.mul(0.2).add(0.85));
        const albedo = select(isWall, wallCol, select(isBed, bedCol, select(isUrn, urnCol, dry)));
        // The coping's nose and the canal side stay wet; the urns are dry.
        const nearWater = float(1.0).sub(smoothstep(0.0, 0.35, abs(abs(p.x).sub(FLOOR.canal.half))));
        const wet = select(isUrn, float(0.08), select(isWall, float(0.9), select(isBed, float(0.0), nearWater.mul(0.6).add(0.25))));
        const ao = S.w;
        const lit = mgSurface(p, n, albedo.mul(float(1.0).sub(wet.mul(0.3))), U, { soft: foot, ao });
        const sheen = wetSheen(p, n, foot, wet.mul(ao), float(0.0), U);
        return vec4(lit.add(sheen), 1.0);
    })());

    // ── The beds' loam, and the urns' soil.
    add(built.soil, 'moonlit-greenhouse-floor-soil', Fn(() => {
        const p = positionWorld;
        const foot = max(footprint(p), 0.0006);
        const broad = texture(noise, p.xz.mul(0.33));
        const mid = texture(noise, p.xz.mul(1.4).add(vec2(0.31, 0.17)));
        const fine = texture(noise, p.xz.mul(5.3));
        // A fake gradient from the noise channels: lumps and furrows in the loam.
        const bump = vec2(mid.x.sub(0.5), mid.z.sub(0.5)).mul(0.9).add(vec2(fine.w.sub(0.5), fine.x.sub(0.5)).mul(0.5));
        const n = normalize(vec3(bump.x, 1.0, bump.y));
        const loam = mix(vec3(0.026, 0.02, 0.015), vec3(0.04, 0.03, 0.021), broad.x);
        const moss = smoothstep(0.55, 0.68, broad.z.mul(0.7).add(mid.w.mul(0.3)));
        const leaves = smoothstep(0.72, 0.8, fine.z.mul(0.6).add(mid.x.mul(0.4)));
        const litter = mix(vec3(0.075, 0.05, 0.026), vec3(0.11, 0.08, 0.035), fine.x);
        const albedo = mix(mix(loam, vec3(0.022, 0.048, 0.02), moss.mul(0.85)), litter, leaves.mul(0.8));
        const lit = mgSurface(p, n, albedo, U, { soft: foot, ao: float(0.85) });
        // Dew on the moss catches the vault's glow.
        const v = normalize(p.sub(cameraPosition));
        const dew = glassGlow(reflect(v, n), U).mul(moss.mul(0.05)).mul(smoothstep(0.55, 0.9, fine.y));
        return vec4(lit.add(dew), 1.0);
    })());

    return {
        mesh: group,
        triangles: built.pavement.triangleCount + built.stone.triangleCount + built.soil.triangleCount,
        dispose() {
            group.removeFromParent();
            geometries.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
            geometries.length = 0;
            materials.length = 0;
        },
    };
}

/** The resting floor's height under a point (the floor geometry's own heights). */
export function floorHeightAt(x, z) {
    const ax = Math.abs(x);
    if (ax < FLOOR.canal.half && z < HEAD && z > END) return PAVE.bed - PAVE.dish * (1 - (ax / FLOOR.canal.half) ** 2);
    if (ax < FLOOR.canal.half + FLOOR.coping && z < HEAD_BACK && z > END_BACK) return FLOOR.copingHeight;
    if (ax < FLOOR.bed.inner) return 0;
    if (ax < FLOOR.bed.inner + PAVE.kerb) return FLOOR.bed.kerb;
    return FLOOR.bed.soil;
}
