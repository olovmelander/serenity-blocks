/**
 * Painted Ages — the living things: the poplars along the river, and their shadows.
 *
 * Windbreak rows of columnar poplars on the valley floor beside the river, as a farmed valley
 * plants them: straight rows along the banks (some doubled), rows down the edges of the fields
 * running out from the water, and a few wild clumps by it. A row is one planting, of an age and
 * turning together in autumn, so one row may still be green beside a gold one. (Low scrub is
 * drawn by the land's own shader.)
 *
 * The tree is one poplar grown in Blender (scripts/blender/painted_ages_poplar.py writes
 * painted-ages-poplar-model.js: a pale bole, a slim inner column, eighteen ascending plumes of
 * leaves, a forked top, in three levels of detail), instanced. No two stand alike: the vertex
 * stage makes each slim or broad, draws its plumes in or out, cuts a ragged top and leans it, all
 * from the tree's seed. Gusts travel through the rows with the cloud deck's drift: a tree bows
 * downwind and trembles, and its leaves flash their pale undersides plume by plume. The crown is
 * lit as a mass: a dark green core in the clefts, gold on the plumes' skin, the top and the tips
 * turning first, the sun glowing through it when it stands behind, the cool sky in its shade,
 * the same shadows and the same air as the land.
 *
 * The trees throw their shadows across the valley, long at the golden hours, short at noon.
 * A small map, laid out on a level plane and projected along the sun, holds the height of the
 * highest tree on each sun ray; the land and the trees themselves are in a tree's shadow where
 * that is above them. It is re-drawn only when the sun has moved (as the land's own shadow).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    attribute,
    clamp,
    cos,
    dot,
    float,
    floor,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    texture,
    uniform,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    DEG, EYE, FIELDS, RIG, clamp as clampNum, mulberry32, smooth,
} from './painted-ages-core.js';
import { groundHeight, inField } from './painted-ages-field.js';
import {
    RIVER, RIVER_ALONG, riverDistance, riverFloor,
} from './painted-ages-plan.js';
import { aerial, cloudShadow, mistPatches } from './painted-ages-light.js';
import { PAINTED_AGES_POPLAR } from './painted-ages-poplar-model.js';
import { shadowAt } from './painted-ages-shadow.js';
import { paHash21 } from './painted-ages-tsl.js';

// ── Where they stand ──────────────────────────────────────────────────────────────

/**
 * Where a world point lands in a rig's frame at rest (normalised device coordinates, y up;
 * `ahead` is false behind the lens). The pose is `pose()`'s without its breath: rotation
 * (pitch, −yaw, 0) in YXZ order, so world → camera is Rx(−pitch) · Ry(yaw).
 */
export function frameNdc(x, y, z, rig, aspect, out = { x: 0, y: 0, ahead: false }) {
    const dx = x - EYE.x;
    const dy = y - EYE.y;
    const dz = z - EYE.z;
    const yaw = rig.yaw * DEG;
    const pitch = rig.pitch * DEG;
    const x1 = Math.cos(yaw) * dx + Math.sin(yaw) * dz;
    const z1 = -Math.sin(yaw) * dx + Math.cos(yaw) * dz;
    const y2 = Math.cos(pitch) * dy + Math.sin(pitch) * z1;
    const z2 = -Math.sin(pitch) * dy + Math.cos(pitch) * z1;
    const t = Math.tan((rig.fov * DEG) / 2);
    out.ahead = z2 < -1;
    out.x = x1 / -z2 / (t * aspect);
    out.y = y2 / -z2 / t;
    return out;
}

const _ndc = { x: 0, y: 0, ahead: false };

/** A tree is planted only where a 16:9 screen sees it at rest (the middle of its height). */
export function seenAtRest(x, y, z, height) {
    frameNdc(x, y + height * 0.5, z, RIG.landscape, 16 / 9, _ndc);
    return _ndc.ahead && Math.abs(_ndc.x) < 0.97 && Math.abs(_ndc.y) < 0.97;
}

/** The river's course at a distance along it (from the source): its point and unit direction. */
function riverAt(along) {
    let i = 0;
    while (i < RIVER.length - 2 && RIVER_ALONG[i + 1] < along) i++;
    const [ax, az] = RIVER[i];
    const [bx, bz] = RIVER[i + 1];
    const len = RIVER_ALONG[i + 1] - RIVER_ALONG[i];
    const t = clampNum((along - RIVER_ALONG[i]) / len, 0, 1);
    return {
        x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / len, dz: (bz - az) / len,
    };
}

/** How the valley's trees are planted (metres). */
export const POPLAR_PLAN = Object.freeze({
    /** The stretch of the river the rows stand beside (its course inside the near field). */
    zFar: -2080,
    zNear: -130,
    /** No tree stands closer than this to another, or to the river's course. */
    spacing: 5.2,
    riverClear: 9,
    /** Height over the river's floor, and the steepest ground (rise per metre) a tree stands on. */
    floorMin: -1.5,
    floorMax: 6.5,
    slope: 0.12,
    /** Trees planned in all (the largest tier takes this many). */
    total: 240,
    /**
     * The river's stretch is cut into this many reaches and the plantings take them in a seeded
     * turn, so every tier has trees all along the valley (none crowds one bend).
     */
    reaches: 14,
});

/** Trees per props tier (every one of them where a 16:9 screen sees it). */
export const POPLAR_COUNT = Object.freeze({ 0: 90, 1: 150, 2: 220 });

const rotate = (dx, dz, a) => [dx * Math.cos(a) - dz * Math.sin(a), dx * Math.sin(a) + dz * Math.cos(a)];

/** The value of the first band `[upTo, value]` a 0..1 draw falls under. */
const band = (bands, v) => (bands.find(([upTo]) => v < upTo) ?? bands[bands.length - 1])[1];

/** What a planting is: three in five a windbreak on a bank, three in ten a field's edge. */
const PLANTING_KINDS = Object.freeze([[0.6, 'bank'], [0.9, 'field'], [1, 'clump']]);

/** How far a planting has turned (from, span of its gold): most gold, some half, a few green. */
const AUTUMN = Object.freeze([[0.6, [0.78, 0.22]], [0.85, [0.4, 0.3]], [1, [0.04, 0.24]]]);

/**
 * The valley's trees, row by row: windbreaks of columnar poplars planted along the banks
 * (some doubled), rows down the edges of the fields running out from the river, and a few wild
 * clumps by the water. A row is one planting: its trees are of an age (heights within a few
 * metres of each other) and turn together in autumn (one row still green beside a gold one).
 * Rows come in a seeded order, so a smaller tier keeps whole rows rather than thinning every
 * one. Every tree stands on level ground just above the river's floor, where the screen sees it.
 * Returns the plantings, `{ kind: 'bank' | 'field' | 'clump', trees }`; a tree's `line` is 1 in
 * the second line of a doubled windbreak.
 */
export function poplarRows(fields, seed = 0x9091) {
    const random = mulberry32(seed);
    const P = POPLAR_PLAN;
    const { near } = FIELDS;
    const ground = (x, z) => groundHeight(fields, x, z, true);
    const rows = [];
    const placed = [];
    const river = { d: 0, along: 0, z: 0 };
    const alongOf = (z) => {
        let best = 0;
        for (let i = 0; i < RIVER.length; i++) if (RIVER[i][1] <= z) best = RIVER_ALONG[i];
        return best;
    };
    const from = alongOf(P.zFar);
    const to = alongOf(P.zNear);
    let total = 0;
    let tries = 0;
    // The reaches in a seeded order, taken in turn (again and again until the trees are planted).
    const turn = Array.from({ length: P.reaches }, (_, i) => i);
    for (let i = turn.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [turn[i], turn[j]] = [turn[j], turn[i]];
    }
    /** The tree a row wants at (x, z), or null where it cannot stand. */
    const plant = (x, z, height) => {
        if (!inField(near, x, z) || z > P.zNear || z < P.zFar - 40) return null;
        if (riverDistance(x, z, river).d < P.riverClear) return null;
        const y = ground(x, z);
        const above = y - riverFloor(z);
        if (above < P.floorMin || above > P.floorMax) return null;
        // Level ground only (a tree on a slope stands on a terrace it does not have).
        const slope = Math.max(Math.abs(ground(x + 3, z) - ground(x - 3, z)), Math.abs(ground(x, z + 3) - ground(x, z - 3))) / 6;
        if (slope > P.slope) return null;
        if (!seenAtRest(x, y, z, height)) return null;
        for (const s of placed) if (Math.hypot(s.x - x, s.z - z) < P.spacing) return null;
        return { x, y, z };
    };
    while (total < P.total && tries < 1600) {
        const reach = turn[tries % P.reaches];
        tries++;
        const r = riverAt(from + ((reach + random()) / P.reaches) * (to - from));
        const side = random() < 0.5 ? -1 : 1;
        // Across the river, toward the chosen bank.
        const nx = -r.dz * side;
        const nz = r.dx * side;
        const kind = band(PLANTING_KINDS, random());
        // One planting: its age, its autumn and its spacing.
        const age = 14.5 + random() * 8;
        const [goldFrom, goldSpan] = band(AUTUMN, random());
        const gold = goldFrom + random() * goldSpan;
        const spacing = 5.4 + random() * 1.1;
        const lines = [];
        if (kind === 'bank') {
            // Parallel to the river's course here (straight, as a windbreak is planted), a
            // little skew to it; a fifth of them doubled, the second line staggered.
            const out = 16 + random() * 52;
            const [dx, dz] = rotate(r.dx, r.dz, (random() - 0.5) * 0.2);
            const n = 5 + Math.floor(random() * 11);
            const x0 = r.x + nx * out - dx * spacing * (n - 1) * 0.5;
            const z0 = r.z + nz * out - dz * spacing * (n - 1) * 0.5;
            lines.push({
                x0, z0, dx, dz, n,
            });
            if (random() < 0.2) {
                lines.push({
                    x0: x0 + nx * 4.8 + dx * spacing * 0.5, z0: z0 + nz * 4.8 + dz * spacing * 0.5, dx, dz, n: n - 1,
                });
            }
        } else if (kind === 'field') {
            // Out from the bank along a field's edge.
            const out = 14 + random() * 22;
            const [dx, dz] = rotate(nx, nz, (random() - 0.5) * 0.18);
            lines.push({
                x0: r.x + nx * out, z0: r.z + nz * out, dx, dz, n: 4 + Math.floor(random() * 8),
            });
        }
        const trees = [];
        const add = (x, z, h, line = 0) => {
            const site = plant(x, z, h);
            if (!site) return;
            const tree = {
                ...site,
                height: h,
                radius: h * (0.105 + random() * 0.03),
                golden: clampNum(gold + (random() - 0.5) * 0.22, 0, 1),
                seed: random(),
                line,
            };
            trees.push(tree);
            placed.push(tree);
        };
        if (kind === 'clump') {
            // Two to four wild trees close by the water, of mixed ages.
            const out = 10 + random() * 16;
            const cx = r.x + nx * out;
            const cz = r.z + nz * out;
            const n = 2 + Math.floor(random() * 3);
            for (let k = 0; k < n; k++) {
                const a = random() * Math.PI * 2;
                const d = 3 + random() * 9;
                add(cx + Math.cos(a) * d, cz + Math.sin(a) * d, age * (0.7 + random() * 0.4));
            }
        } else {
            lines.forEach((line, index) => {
                for (let k = 0; k < line.n; k++) {
                    // Now and then a tree is missing from the row.
                    if (random() < 0.07) continue;
                    const along = k * spacing + (random() - 0.5) * 0.4;
                    const off = (random() - 0.5) * 0.5;
                    const x = line.x0 + line.dx * along - line.dz * off;
                    const z = line.z0 + line.dz * along + line.dx * off;
                    add(x, z, age * (0.93 + random() * 0.12), index);
                }
            });
        }
        if (trees.length < (kind === 'clump' ? 2 : 4)) {
            // Too few of its trees can stand: the planting is not made.
            for (const tree of trees) placed.splice(placed.indexOf(tree), 1);
            continue;
        }
        rows.push({ kind, trees });
        total += trees.length;
    }
    return rows;
}

/** Where the poplars stand (`count` at most): whole plantings in their seeded order. */
export function poplarSites(fields, count = POPLAR_PLAN.total, seed = 0x9091) {
    const sites = [];
    for (const row of poplarRows(fields, seed)) {
        for (const tree of row.trees) {
            if (sites.length >= count) return sites;
            sites.push(tree);
        }
    }
    return sites;
}

// ── Their shadows ─────────────────────────────────────────────────────────────────

/** The heights (metres) the shade map holds as 0 and 1, and the plane it is laid out on. */
export const SHADE = Object.freeze({
    lo: -10,
    hi: 70,
    plane: 6,
    /** The sun is taken no lower than this (degrees) for the map; the shadows fade out below. */
    elMin: 4,
    fadeFrom: 1.5,
    fadeTo: 4.5,
    /** How much of the sun a tree's crown keeps off what lies in its shadow. */
    density: 0.84,
    /** The map's longest edge (texels). */
    maxEdge: 2048,
});

/**
 * The box (plane coordinates: a point's xz moved along the sun ray to the plane's height) that
 * every tree's shadow lies in under a sun direction `dir` (toward the sun), and the shift per
 * metre of height (`sx`, `sz`) that takes a point to the plane.
 */
export function shadeFootprint(sites, dir, out = {}) {
    const el = Math.max(Math.asin(clampNum(dir[1], -1, 1)), SHADE.elMin * DEG);
    const flat = Math.hypot(dir[0], dir[2]) || 1;
    const k = 1 / Math.tan(el);
    const sx = (dir[0] / flat) * k;
    const sz = (dir[2] / flat) * k;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const s of sites) {
        const margin = s.radius + 1;
        const foot = s.y - 0.4;
        for (const y of [foot, foot + s.height]) {
            const X = s.x - sx * (y - SHADE.plane);
            const Z = s.z - sz * (y - SHADE.plane);
            x0 = Math.min(x0, X - margin);
            z0 = Math.min(z0, Z - margin);
            x1 = Math.max(x1, X + margin);
            z1 = Math.max(z1, Z + margin);
        }
    }
    if (!sites.length) {
        x0 = 0;
        z0 = 0;
        x1 = 1;
        z1 = 1;
    }
    Object.assign(out, {
        x0, z0, x1, z1, sx, sz, el: el / DEG,
    });
    return out;
}

/** The map's size for a tier: the largest footprint under any low sun, at the tier's texel. */
export function shadeLayout(sites, texelWanted) {
    let w = 1;
    let h = 1;
    const box = {};
    const el = SHADE.elMin * DEG;
    for (let a = 0; a < 360; a += 5) {
        const dir = [Math.sin(a * DEG) * Math.cos(el), Math.sin(el), -Math.cos(a * DEG) * Math.cos(el)];
        shadeFootprint(sites, dir, box);
        w = Math.max(w, box.x1 - box.x0);
        h = Math.max(h, box.z1 - box.z0);
    }
    const edge = SHADE.maxEdge - 4;
    const texel = Math.max(texelWanted, w / edge, h / edge);
    return {
        texel, width: Math.ceil(w / texel) + 2, height: Math.ceil(h / texel) + 2,
    };
}

/** An orthographic lens whose projection is set by hand (three must not recompute it). */
class ShadeCamera extends THREE.OrthographicCamera {
    updateProjectionMatrix() {}
}

/**
 * The trees' shadow map and its pass. `render()` re-draws it when the sun has moved more than
 * `threshold` radians since it was drawn (and only counts it drawn once the draw really
 * happened: three skips a draw whose pipeline is still being built).
 */
export function createPoplarShade(sites, geometry, instanceMatrix, setting) {
    const layout = shadeLayout(sites, setting.texel);
    const { texel, width, height } = layout;
    const target = new THREE.RenderTarget(width, height, {
        type: THREE.UnsignedByteType,
        format: THREE.RedFormat,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
    });
    target.texture.name = 'painted-ages-poplar-shade';
    target.texture.wrapS = THREE.ClampToEdgeWrapping;
    target.texture.wrapT = THREE.ClampToEdgeWrapping;
    target.texture.magFilter = THREE.LinearFilter;
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.generateMipmaps = false;
    target.texture.colorSpace = THREE.NoColorSpace;

    // The caster: every tree, drawn as its height into the map; the highest on a ray stays.
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesPoplarShade';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.MaxEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.blendEquationAlpha = THREE.MaxEquation;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.fragmentNode = Fn(() => {
        const v = clamp(positionWorld.y.sub(SHADE.lo).div(SHADE.hi - SHADE.lo), 0.0, 1.0);
        return vec4(v, v, v, 1.0);
    })();
    const count = Math.max(1, sites.length);
    const caster = new THREE.InstancedMesh(geometry, material, count);
    caster.name = 'PaintedAgesPoplarShade';
    caster.instanceMatrix = instanceMatrix;
    caster.count = sites.length;
    caster.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(caster);
    const camera = new ShadeCamera();
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld(true);

    // What the readers need: the plane shift and the fade (`proj`), the box (`frame`), the
    // texel steps and the bias (`step`).
    const proj = uniform(new THREE.Vector4(0, 0, SHADE.plane, 0));
    const frame = uniform(new THREE.Vector4(0, 0, 1 / (width * texel), 1 / (height * texel)));
    const step = uniform(new THREE.Vector4(1 / width, 1 / height, 1, 0));
    const box = {};
    const clear = new THREE.Color();
    let painted = null;
    let enabled = true;

    return {
        texture: target.texture,
        proj,
        frame,
        step,
        taps: setting.taps,
        layout,
        target,
        caster,
        /** Draw the map when the sun has moved; returns 1 when it was drawn. */
        render(renderer, sunDir, { threshold = 0.0018 } = {}) {
            const able = renderer && ['setRenderTarget', 'setClearColor', 'clear', 'render']
                .every((name) => typeof renderer[name] === 'function');
            if (!able) return 0;
            if (!enabled) {
                proj.value.w = 0;
                return 0;
            }
            if (painted && painted.angleTo(sunDir) <= threshold) return 0;
            const elDeg = Math.asin(clampNum(sunDir.y, -1, 1)) / DEG;
            const fade = smooth(SHADE.fadeFrom, SHADE.fadeTo, elDeg);
            if (fade <= 0 || !sites.length) {
                proj.value.w = 0;
                painted = (painted || new THREE.Vector3()).copy(sunDir);
                return 0;
            }
            shadeFootprint(sites, [sunDir.x, sunDir.y, sunDir.z], box);
            const W = width * texel;
            const H = height * texel;
            // The box keeps its size; its corner snaps to whole texels, so the shadows do not
            // crawl as it follows the sun.
            const x0 = Math.floor(((box.x0 + box.x1) * 0.5 - W * 0.5) / texel) * texel;
            const z0 = Math.floor(((box.z0 + box.z1) * 0.5 - H * 0.5) / texel) * texel;
            const hw = W * 0.5;
            const hh = H * 0.5;
            const cx = x0 + hw;
            const cz = z0 + hh;
            const { sx, sz } = box;
            const y0 = SHADE.plane;
            // World → the plane (X = x − sx (y − y0), Z = z − sz (y − y0)) → clip: x right, the
            // box's first row (z0) at the top of the target, where a read at v = 0 finds it.
            // (Row-major; the depth is constant, nothing is depth-tested.)
            const rows = [
                1 / hw, -sx / hw, 0, (sx * y0 - cx) / hw,
                0, sz / hh, -1 / hh, (cz - sz * y0) / hh,
                0, 0, 0, 0.5,
                0, 0, 0, 1,
            ];
            camera.projectionMatrix.set(...rows);
            const previous = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
            const { autoClear } = renderer;
            renderer.getClearColor?.(clear);
            const clearAlpha = renderer.getClearAlpha?.() ?? 1;
            const stats = renderer.info?.render;
            const before = stats?.drawCalls;
            renderer.setRenderTarget(target);
            renderer.setClearColor(0x000000, 0);
            renderer.autoClear = false;
            renderer.clear();
            renderer.render(scene, camera);
            renderer.autoClear = autoClear;
            renderer.setClearColor(clear, clearAlpha);
            renderer.setRenderTarget(previous);
            const drew = typeof before !== 'number' || stats.drawCalls !== before;
            // Until the trees are really in it the map says nothing (the land stays lit).
            if (!drew) {
                proj.value.w = 0;
                return 0;
            }
            proj.value.set(sx, sz, y0, fade);
            frame.value.set(x0, z0, 1 / W, 1 / H);
            // A ray's height changes by texel · tan(el) from one texel to the next along the sun:
            // the bias keeps a crown from shadowing its own lit side.
            const tanEl = Math.tan(Math.max(elDeg, SHADE.elMin) * DEG);
            step.value.set(1 / width, 1 / height, 0.6 + 1.8 * texel * tanEl, tanEl);
            painted = (painted || new THREE.Vector3()).copy(sunDir);
            return 1;
        },
        /** Show or hide the trees' shadows with the trees (a capture of other parts alone). */
        setEnabled(value) {
            const next = value !== false;
            if (next === enabled) return;
            enabled = next;
            if (!enabled) proj.value.w = 0;
            painted = null;
        },
        /** Forget what was drawn (a seek, a rebuilt device): it is due again. */
        invalidate() { painted = null; },
        dispose() {
            target.dispose();
            material.dispose();
            caster.dispose?.();
        },
    };
}

/**
 * How much sun reaches a world point past the trees (1 out of every tree's shadow): the point
 * moved along its sun ray to the map's plane, then the highest tree on that ray compared with
 * the point's own height, over a few taps a texel apart (a soft edge). `shade` is the object
 * `createPoplarShade` returns; null gives 1. `clearRun` (metres) lifts the point by the rise of
 * a sun ray over that run: a crown passes it to leave out its own far side (its form is the
 * wrap light's), so that only another tree shades it.
 */
export function poplarShadeAt(shade, P, clearRun = 0) {
    if (!shade) return float(1.0);
    const lit = float(1.0).toVar();
    const q = P.xz.sub(shade.proj.xy.mul(P.y.sub(shade.proj.z)));
    const st = q.sub(shade.frame.xy).mul(shade.frame.zw).toVar();
    const acrossMap = st.x.greaterThan(0.0).and(st.x.lessThan(1.0));
    const alongMap = st.y.greaterThan(0.0).and(st.y.lessThan(1.0));
    If(acrossMap.and(alongMap).and(shade.proj.w.greaterThan(0.001)), () => {
        const range = SHADE.hi - SHADE.lo;
        // The point's own height (with the bias), in the map's units; a soft metre either side.
        const lift = clearRun > 0 ? shade.step.z.add(shade.step.w.mul(clearRun)) : shade.step.z;
        const own = P.y.add(lift).sub(SHADE.lo).div(range).toVar();
        const soft = 0.9 / range;
        const clearAt = (du, dv) => {
            const at = st.add(vec2(shade.step.x.mul(du), shade.step.y.mul(dv)));
            return smoothstep(-soft, soft, own.sub(texture(shade.texture, at).level(0).x));
        };
        const taps = shade.taps >= 4 ? [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] : [[0, 0]];
        const reads = taps.map(([du, dv]) => clearAt(du, dv));
        const open = reads.reduce((sum, tap) => sum.add(tap)).div(taps.length);
        lit.assign(float(1.0).sub(float(1.0).sub(open).mul(SHADE.density).mul(shade.proj.w)));
    });
    return lit;
}

// ── The trees ─────────────────────────────────────────────────────────────────────

/** Which of the grown tree's levels of detail a props tier draws (the most where the most stand). */
export const POPLAR_LEVEL = Object.freeze({ 0: 'lean', 1: 'mid', 2: 'fine' });

/** A tree's foot stands this far in the ground (metres), so it never floats on a rise. */
const FOOT_SINK = 0.4;

/**
 * How a tree differs from the one grown tree, and how it moves (the vertex stage's numbers).
 * Widths are shares of the tree's radius, heights and bends shares of its height.
 */
export const POPLAR_FORM = Object.freeze({
    /** A young slim tree … a broad old one. */
    girth: Object.freeze([0.9, 1.2]),
    /** How much the width shifts between the foot of the crown and its top (broad low or carried high). */
    carry: 0.7,
    /** A plume drawn in … standing out, and how far it sits lower or higher. */
    plume: Object.freeze([0.8, 1.12]),
    plumeLift: 0.028,
    /** The top above this share of the height is what a ragged tree has lost most of. */
    cutFrom: 0.82,
    cutKeeps: 0.3,
    /** The most a tree leans by itself, at its top. */
    lean: 0.05,
    /** The wind's bend at the top: at rest, and more in a gust; the tremble on top of it. */
    bendRest: 0.006,
    bendGust: 0.055,
    tremble: 0.006,
    /** A plume's skin breathes in and out by this share of its reach. */
    flutter: 0.04,
});

/** The way the wind blows over the ground: the unit of the cloud deck's drift (`u.wind`). */
const WIND_ALONG = Object.freeze([0.948, -0.319]);

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

/** The model's levels decoded once a page: every world (a rebuild, a quality change) shares them. */
const decoded = new Map();

/**
 * One level of the grown poplar as plain arrays: the unit tree (its foot at y = 0, its top at
 * y = 1, its widest point one unit from the axis). `crown` holds four numbers a vertex: out (0 in
 * a cleft … 1 on a plume's skin), open (how much sky it sees), clump (its plume, an integer),
 * bark (1 on the bole).
 */
export function poplarModel(name = 'fine') {
    if (decoded.has(name)) return decoded.get(name);
    const level = PAINTED_AGES_POPLAR.levels.find((l) => l.name === name) ?? PAINTED_AGES_POPLAR.levels[0];
    const stored = decode(level.positions, Int16Array);
    const positions = new Float32Array(stored.length);
    for (let i = 0; i < stored.length; i++) positions[i] = stored[i] * PAINTED_AGES_POPLAR.quant;
    const storedNormals = decode(level.normals, Int16Array);
    const normals = new Float32Array(storedNormals.length);
    for (let i = 0; i < normals.length; i++) normals[i] = storedNormals[i] / 32767;
    const bytes = decode(level.crown, Uint8Array);
    const crown = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 4) {
        crown[i] = bytes[i] / 255;
        crown[i + 1] = bytes[i + 1] / 255;
        crown[i + 2] = bytes[i + 2];
        crown[i + 3] = bytes[i + 3] / 255;
    }
    const model = Object.freeze({
        name: level.name,
        positions,
        normals,
        crown,
        index: decode(level.index, Uint16Array),
        vertexCount: level.vertexCount,
        triangleCount: level.triangleCount,
    });
    decoded.set(name, model);
    return model;
}

/** A level of the grown poplar as a geometry of its own (the arrays are shared, never written). */
export function poplarGeometry(name = 'fine') {
    const model = poplarModel(name);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(model.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(model.normals, 3));
    geometry.setAttribute('aCrown', new THREE.BufferAttribute(model.crown, 4));
    geometry.setIndex(new THREE.BufferAttribute(model.index, 1));
    geometry.userData.level = model.name;
    return geometry;
}

export function createPoplars(u, t, tier, fields) {
    const count = POPLAR_COUNT[tier.props] ?? POPLAR_COUNT[2];
    const sites = poplarSites(fields, count);
    const geometry = poplarGeometry(POPLAR_LEVEL[tier.props] ?? POPLAR_LEVEL[2]);
    const slots = Math.max(1, sites.length);
    // Per tree: (how golden, seed, height, radius) and where its foot stands.
    const data = new Float32Array(slots * 4);
    const feet = new Float32Array(slots * 4);
    sites.forEach((s, i) => {
        data.set([s.golden, s.seed, s.height, s.radius], i * 4);
        feet.set([s.x, s.y - FOOT_SINK, s.z, 0], i * 4);
    });
    geometry.setAttribute('aTree', new THREE.InstancedBufferAttribute(data, 4));
    geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(feet, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, slots);
    mesh.name = 'PaintedAgesPoplars';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    sites.forEach((s, i) => {
        q.setFromAxisAngle(up, s.seed * 6.28);
        sc.set(s.radius, s.height, s.radius);
        pos.set(s.x, s.y - FOOT_SINK, s.z);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(i, m);
    });
    mesh.count = sites.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    // The caster draws the grown tree as it stands in its instance matrix: what the vertex stage
    // below does to one tree (a plume drawn in, a lean, the wind) is a texel of the map at most.
    const shade = tier.poplarShade ? createPoplarShade(sites, geometry, mesh.instanceMatrix, tier.poplarShade) : null;
    // Reachable from the scene graph for probes (`scene.getObjectByName('PaintedAgesPoplars')`).
    mesh.userData.shade = shade;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesPoplars';
    material.fog = false;
    const F = POPLAR_FORM;
    const tree = attribute('aTree', 'vec4');
    const root = attribute('aRoot', 'vec4');
    const crown = attribute('aCrown', 'vec4');
    // The tree's own numbers: an exact integer from its seed, hashed (the vertex stage reads an
    // instance's value exactly; nothing here is hashed in the fragment stage).
    const key = floor(tree.y.mul(251.0));
    const h1 = paHash21(vec2(key, 3.0));
    const h2 = paHash21(vec2(key, 11.0));
    const h3 = paHash21(vec2(key, 23.0));
    // A plume's own number in this tree: how far it stands out, how far it has turned.
    const plume = paHash21(vec2(crown.z, key.add(17.0)));
    // The wind: gusts as fronts that travel with the cloud deck's drift (so a quick hand's breeze
    // runs through the rows too), bent across the wind and never evenly spaced. 0 calm … 1 a gust.
    const windAt = root.xz.add(u.wind);
    const along = windAt.x.mul(WIND_ALONG[0]).add(windAt.y.mul(WIND_ALONG[1]));
    const across = windAt.y.mul(WIND_ALONG[0]).sub(windAt.x.mul(WIND_ALONG[1]));
    const fronts = sin(along.div(34.0).add(sin(across.div(57.0).add(along.div(113.0))).mul(1.3))).mul(0.72)
        .add(sin(along.div(13.0).add(across.div(31.0))).mul(0.34));
    const gust = smoothstep(-0.25, 0.9, fronts);
    // A plume's leaves turning in the wind, each plume in its own time.
    const flutter = sin(u.time.mul(2.1).add(crown.z.mul(2.4)).add(key.mul(1.3)));
    const vPlume = varying(plume, 'vPoplarPlume');
    const vGust = varying(gust, 'vPoplarGust');
    const vFlutter = varying(flutter, 'vPoplarFlutter');

    material.positionNode = Fn(() => {
        // How high up the tree (0 its foot … 1 its top).
        const y = positionGeometry.y.toVar();
        const leaf = float(1.0).sub(crown.w);
        const height = tree.z;
        // Motion finer than a pixel is no motion, only a flicker along the outline: the skin's
        // breath and the tremble are for a lens that draws a metre several pixels wide.
        const pixelsAMetre = float(1.0).div(max(length(root.xyz.sub(u.eye)).mul(u.pixelAngle), 1e-5));
        const close = smoothstep(1.5, 4.0, pixelsAMetre);
        // From the foot, in metres: the instance matrix has already stood the tree up.
        const rel = positionLocal.sub(root.xyz);
        // Its form: slim or broad, its width low down or carried high, each plume drawn in or
        // standing out; the bole keeps its own width.
        const girth = mix(float(F.girth[0]), float(F.girth[1]), h1);
        const carried = float(1.0).add(h2.sub(0.5).mul(F.carry).mul(float(0.45).sub(y)));
        const wide = mix(float(1.0), girth.mul(carried).mul(mix(float(F.plume[0]), float(F.plume[1]), plume)), leaf);
        // A plume's skin breathes with the wind (its tips most).
        const breath = flutter.mul(F.flutter).mul(crown.x).mul(gust.mul(0.7).add(0.3))
            .mul(leaf.mul(close));
        const swell = wide.add(breath).sub(1.0);
        // A plume sits a little lower or higher; a ragged tree has lost most of its top.
        const lift = paHash21(vec2(crown.z.add(31.0), key)).sub(0.5).mul(F.plumeLift)
            .mul(leaf.mul(smoothstep(0.16, 0.3, y)));
        const cut = h3.sqrt().mul(0.2).add(F.cutFrom);
        const lost = max(y.sub(cut), 0.0).mul(1.0 - F.cutKeeps);
        const rise = lift.sub(lost).mul(height);
        // It leans a little its own way, and bends downwind: more in a gust, trembling as it does.
        const bow = y.mul(y).mul(height);
        const leanAngle = h2.mul(6.2832);
        const lean = h1.mul(h3).mul(F.lean);
        const tremble = sin(u.time.mul(2.3).add(key.mul(0.7)).add(along.mul(0.11)))
            .mul(gust.mul(0.8).add(0.2)).mul(close.mul(F.tremble));
        const bend = gust.mul(F.bendGust).add(F.bendRest).add(tremble);
        const swayX = bow.mul(cos(leanAngle).mul(lean).sub(bend.mul(WIND_ALONG[0])));
        const swayZ = bow.mul(sin(leanAngle).mul(lean).sub(bend.mul(WIND_ALONG[1])));
        return positionLocal.add(vec3(rel.x.mul(swell).add(swayX), rise, rel.z.mul(swell).add(swayZ)));
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        // (Interpolated shares are clamped: on a tree a few pixels wide MSAA reads them outside 0..1.)
        const bark = clamp(crown.w, 0.0, 1.0);
        const leaf = float(1.0).sub(bark);
        const out = clamp(crown.x, 0.0, 1.0);
        const open = clamp(crown.y, 0.0, 1.0);
        const high = clamp(positionGeometry.y, 0.0, 1.0);
        const tone = clamp(vPlume, 0.0, 1.0);
        const windy = clamp(vGust, 0.0, 1.0);
        // How far these leaves have turned: the planting's own gold, the top and the plumes' tips
        // first, a plume at a time; the inner crown keeps its green longest.
        const turned = clamp(tree.x.mul(1.9).sub(0.45).add(high.sub(0.5).mul(0.5)).add(out.sub(0.6).mul(0.5))
            .add(tone.sub(0.5).mul(0.6)), 0.0, 1.0).toVar();
        // Depth: dark and deep in the clefts, pale on the plumes' lit skin.
        const depth = out.mul(open.mul(0.65).add(0.35));
        const green = mix(vec3(0.04, 0.075, 0.02), vec3(0.13, 0.2, 0.045), depth);
        // (Gold deepens toward amber low in the crown and pales toward lemon at its top.)
        const gold = mix(vec3(0.34, 0.17, 0.02), vec3(0.86, 0.6, 0.085), depth)
            .mul(mix(vec3(0.96, 0.84, 0.7), vec3(1.03, 1.06, 1.5), high));
        // In a gust the leaves show their pale undersides, plume by plume.
        const pale = mix(vec3(0.34, 0.42, 0.26), vec3(0.95, 0.8, 0.36), turned);
        const flash = windy.mul(clamp(vFlutter, -1.0, 1.0).mul(0.5).add(0.5)).mul(out).mul(0.5);
        const leaves = mix(mix(green, gold, turned).mul(tone.mul(0.3).add(0.85)), pale, flash);
        const albedo = mix(leaves, vec3(0.34, 0.33, 0.28), bark).toVar();
        const n = normalize(normalWorld);
        const L = u.sunDir;
        const wrap = clamp(dot(n, L).add(0.3).div(1.3), 0.0, 1.0);
        // A cleft stands in its plumes' shade.
        const self = mix(float(0.5), float(1.0), open);
        // The land's shadow, and another row's when the sun runs across the plantings (a sun ray
        // crosses its own crown within the crown's width, about 6 m at the widest).
        const shadow = shadowAt(t.shadow, P.xz).mul(poplarShadeAt(shade, P, 7.5));
        const clouds = cloudShadow(u, t.noise, P);
        const view = normalize(P.sub(u.eye));
        // The sun behind the crown: its light comes THROUGH the leaves, in their own colour and
        // deeper, most where the crown is thin (toward its outline, on a plume's skin).
        const behind = clamp(dot(view, L), 0.0, 1.0);
        const edge = float(1.0).sub(clamp(dot(n, view).abs(), 0.0, 1.0));
        const thin = edge.mul(out).mul(0.85).add(0.15);
        const glow = mix(vec3(0.42, 0.62, 0.08), vec3(1.0, 0.66, 0.12), turned);
        const through = behind.mul(behind).mul(behind).mul(thin.mul(leaf).mul(0.9));
        const direct = u.sun.mul(albedo.mul(wrap).mul(self).add(glow.mul(through)))
            .mul(shadow.mul(clouds).mul(u.sunUp));
        // The cool sky in the shade (less of it in a cleft and low in the row), the ground's
        // warmth from below.
        const sky = u.fill.mul(n.y.mul(0.35).add(0.65)).mul(open.mul(0.6).add(0.4)).mul(high.mul(0.3).add(0.7));
        const ground = u.bounce.mul(float(0.65).sub(n.y.mul(0.35)));
        const lit = direct.add(albedo.mul(sky.add(ground)));
        // The same mist banks the valley floor stands in.
        return vec4(aerial(u, P, lit, mistPatches(u, t.noise, P.xz)), 1.0);
    })();
    mesh.material = material;
    return {
        mesh,
        meshes: [mesh],
        sites,
        shade,
        level: geometry.userData.level,
        update() {},
        /** GPU work before the frame: the trees' shadow map, when the sun has moved. */
        prerender(renderer, sunDir) {
            if (!shade) return 0;
            shade.setEnabled(mesh.visible);
            return shade.render(renderer, sunDir);
        },
        dispose() {
            shade?.dispose();
            geometry.dispose();
            material.dispose();
            mesh.dispose?.();
        },
    };
}

export { smoothstep };
