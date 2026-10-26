/**
 * Painted Ages — the living things: the poplars along the river, and their shadows.
 *
 * Windbreak rows of columnar poplars on the valley floor beside the river, as a farmed valley
 * plants them: straight rows along the banks (some doubled), rows down the edges of the fields
 * running out from the water, and a few wild clumps by it. A row is one planting, of an age and
 * turning together in autumn, so one row may still be green beside a gold one. Instanced
 * spindles; the canopy is shaded in clumps (noise on its own surface), sways a little in the
 * wind (a constant rate), and is lit like the land and read through the same air. (Low scrub
 * is drawn by the land's own shader.)
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
    dot,
    float,
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
import { shadowAt } from './painted-ages-shadow.js';

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

/** A poplar's spindle: a lathe of its profile (radius 1 at the widest, height 1), with a trunk. */
function poplarGeometry() {
    const pts = [];
    const rings = 12;
    for (let k = 0; k <= rings; k++) {
        const t = k / rings;
        // Narrow at the foot of the crown, widest a third of the way up, tapering to a point.
        const r = t < 0.12 ? 0.25 + t * 4 : Math.sin(Math.min(1, (t - 0.05) / 0.95) * Math.PI) ** 0.8 * (1 - t * 0.35);
        pts.push(new THREE.Vector2(Math.max(0.02, r), 0.12 + t * 0.88));
    }
    const crown = new THREE.LatheGeometry(pts, 9);
    const trunk = new THREE.CylinderGeometry(0.06, 0.09, 0.2, 6);
    trunk.translate(0, 0.08, 0);
    crown.deleteAttribute('uv');
    trunk.deleteAttribute('uv');
    const merged = new THREE.BufferGeometry();
    const a = crown.toNonIndexed();
    const b = trunk.toNonIndexed();
    const pos = new Float32Array(a.attributes.position.count * 3 + b.attributes.position.count * 3);
    pos.set(a.attributes.position.array, 0);
    pos.set(b.attributes.position.array, a.attributes.position.count * 3);
    const nrm = new Float32Array(pos.length);
    nrm.set(a.attributes.normal.array, 0);
    nrm.set(b.attributes.normal.array, a.attributes.normal.count * 3);
    const bark = new Float32Array(pos.length / 3);
    bark.fill(1, a.attributes.position.count);
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    merged.setAttribute('aBark', new THREE.BufferAttribute(bark, 1));
    crown.dispose();
    trunk.dispose();
    a.dispose();
    b.dispose();
    return merged;
}

export function createPoplars(u, t, tier, fields) {
    const count = POPLAR_COUNT[tier.props] ?? POPLAR_COUNT[2];
    const sites = poplarSites(fields, count);
    const geometry = poplarGeometry();
    const data = new Float32Array(Math.max(1, sites.length) * 4);
    sites.forEach((s, i) => data.set([s.golden, s.seed, s.height, 0], i * 4));
    geometry.setAttribute('aTree', new THREE.InstancedBufferAttribute(data, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, Math.max(1, sites.length));
    mesh.name = 'PaintedAgesPoplars';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    sites.forEach((s, i) => {
        q.setFromAxisAngle(up, s.seed * 6.28);
        sc.set(s.radius, s.height, s.radius);
        pos.set(s.x, s.y - 0.4, s.z);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(i, m);
    });
    mesh.count = sites.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    const shade = tier.poplarShade ? createPoplarShade(sites, geometry, mesh.instanceMatrix, tier.poplarShade) : null;
    // Reachable from the scene graph for probes (`scene.getObjectByName('PaintedAgesPoplars')`).
    mesh.userData.shade = shade;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesPoplars';
    material.fog = false;
    const tree = attribute('aTree', 'vec4');
    const bark = attribute('aBark', 'float');
    // A breath of wind in the crowns (constant rate; amplitude by height up the tree).
    material.positionNode = Fn(() => {
        const sway = sin(u.time.mul(0.9).add(tree.y.mul(40.0))).mul(0.018).mul(positionGeometry.y.mul(positionGeometry.y));
        return positionLocal.add(vec3(sway, 0.0, sway.mul(0.4)));
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const golden = mix(vec3(0.16, 0.2, 0.05), vec3(0.6, 0.38, 0.06), tree.x).mul(tree.y.mul(0.3).add(0.85));
        // Clumps of leaves: the crown's own surface is not one flat colour.
        const clump = texture(t.noise, vec2(P.x.add(P.y.mul(0.7)), P.z.sub(P.y.mul(0.5))).mul(0.35)).a;
        const albedo = mix(golden.mul(clump.mul(0.6).add(0.6)), vec3(0.09, 0.07, 0.05), bark);
        const n = normalize(normalWorld);
        const L = u.sunDir;
        const wrap = clamp(dot(n, L).add(0.35).div(1.35), 0.0, 1.0);
        // The land's shadow, and another row's when the sun runs across the plantings (a sun ray
        // crosses its own crown within the crown's width, about 6 m at the widest).
        const shadow = shadowAt(t.shadow, P.xz).mul(poplarShadeAt(shade, P, 7.5));
        const clouds = cloudShadow(u, t.noise, P);
        const view = normalize(P.sub(u.eye));
        // Light through the leaves when the sun stands behind the crown.
        const through = clamp(dot(view, L), 0.0, 1.0).pow(4.0).mul(0.6).mul(float(1.0).sub(bark));
        const direct = u.sun.mul(wrap.add(through)).mul(shadow).mul(clouds).mul(u.sunUp);
        const sky = u.fill.mul(n.y.mul(0.35).add(0.65));
        const lit = albedo.mul(direct.add(sky).add(u.bounce.mul(0.5)));
        // The same mist banks the valley floor stands in.
        return vec4(aerial(u, P, lit, mistPatches(u, t.noise, P.xz)), 1.0);
    })();
    mesh.material = material;
    return {
        mesh,
        meshes: [mesh],
        sites,
        shade,
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
