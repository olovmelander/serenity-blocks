/**
 * Himalayan Peak — the pass: what stands within a stone's throw of the viewer.
 *
 *  - The snow: a shoulder of wind-packed drift, level under the boots and rolling over a brow a
 *    dozen metres ahead. It lies in the headwall's shadow until the sun clears the col, so it is
 *    drawn for shade: the crust mirrors the sky at a grazing angle (the glow over the wall lies
 *    along every drift), single crystals glint as the view moves, and a locking piece sends a
 *    ring of lifted powder across it from under the board.
 *  - The shrine: a whitewashed chorten with a gilded spire on its mound to the left, and a cairn
 *    of flat stones with a pole to the right. The flag lines are strung from the two.
 *
 * None of this is under the world's squeezed root: upright screens narrow the amphitheatre,
 * not the things one could walk up to.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    floor,
    fract,
    fwidth,
    max,
    mix,
    normalLocal,
    normalize,
    positionLocal,
    reflect,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EYE, mulberry32 } from './himalayan-peak-core.js';
import { drainSteps, stepClock } from '../shared/build-steps.js';
import {
    BOOTS, CAIRN, CHORTEN, PASS_REACH, anchors, passHeight,
} from './himalayan-peak-layout.js';
import {
    hpHash21, hpPart, hpPow4, hpRingLight, hpSky, hpSolidMaterial, hpSq,
} from './himalayan-peak-tsl.js';

const SNOW = [0.82, 0.87, 0.95];
/** How long one slice of the pass's snow runs before it yields to the page (ms). */
const PASS_SLICE_MS = 8;

/**
 * The shadow an upright shaft throws on the snow at `P`: 1 inside it. The shaft stands on
 * `foot`, is `height` tall and tapers from `r0` at its foot to `r1` at its top. Closed
 * form: where the ray from `P` to the sun passes the shaft's axis, and how high it is there.
 */
const shaftShadow = (u, P, foot, height, r0, r1) => {
    const flat = u.sunDir.xz;
    const len2 = max(dot(flat, flat), 1e-4);
    const rel = vec2(foot[0], foot[2]).sub(P.xz);
    const t = dot(rel, flat).div(len2);
    const miss = abs(rel.x.mul(flat.y).sub(rel.y.mul(flat.x))).div(len2.sqrt());
    const y = P.y.add(u.sunDir.y.mul(t)).sub(foot[1]);
    const r = mix(float(r0), float(r1), clamp(y.div(height), 0.0, 1.0));
    // The edge softens with the distance the shadow has run.
    const soft = t.mul(0.012).add(0.05);
    return smoothstep(r.add(soft), r.sub(soft), miss)
        .mul(step(0.0, t))
        .mul(smoothstep(height + 0.2, height - 0.3, y))
        .mul(step(-0.4, y));
};

/**
 * @param {object} u       shared uniforms
 * @param {object} field   the derived field (the pass marries the baked ground)
 * @param {object} options
 * @param {boolean} [options.glints=true]
 */
export function createPassSnow(u, field, options = {}) {
    return drainSteps(createPassSnowSteps(u, field, options));
}

/**
 * `createPassSnow` as steps: the fan's rows (five height reads a post) yield once `clock` is due
 * (one ~12-17 ms piece of a first visit's build, 2026-10-31); returns the part.
 */
export function* createPassSnowSteps(u, field, { glints = true } = {}, clock = stepClock(PASS_SLICE_MS)) {
    const at = anchors(field);
    // A fan about the eye: fine underfoot, coarse at the rim.
    const columns = 150;
    const rows = 84;
    const span = 115 * (Math.PI / 180);
    const positions = new Float32Array(columns * rows * 3);
    const normals = new Float32Array(columns * rows * 3);
    for (let j = 0; j < rows; j++) {
        const r = 0.7 * (PASS_REACH / 0.7) ** (j / (rows - 1));
        for (let i = 0; i < columns; i++) {
            const a = -span + (i / (columns - 1)) * 2 * span;
            const x = EYE.x + Math.sin(a) * r;
            const z = EYE.z - Math.cos(a) * r;
            const e = Math.max(0.15, r * 0.02);
            const h = passHeight(field, x, z);
            const gx = (passHeight(field, x + e, z) - passHeight(field, x - e, z)) / (2 * e);
            const gz = (passHeight(field, x, z + e) - passHeight(field, x, z - e)) / (2 * e);
            const inv = 1 / Math.hypot(gx, 1, gz);
            const o = (j * columns + i) * 3;
            positions.set([x, h, z], o);
            normals.set([-gx * inv, inv, -gz * inv], o);
        }
        if (clock.due()) {
            yield 'pass';
            clock.restart();
        }
    }
    const indices = [];
    for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < columns - 1; i++) {
            const a = j * columns + i;
            const c = a + columns;
            indices.push(a, a + 1, c, a + 1, c + 1, c);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(indices);

    const material = hpSolidMaterial('HimalayanPeakPassSnow');
    material.colorNode = Fn(() => {
        const P = positionLocal;
        const near = P.xz.sub(vec2(EYE.x, EYE.z));
        // Sastrugi: drifts drawn out along the wind, and the grain of the crust. The wind turned
        // as it laid them, so their run wanders and bends; it scoured some patches smooth and
        // left others rippled; and under it all the drift rolls in low dunes.
        const sway = u.noise(near.mul(1 / 75).add(0.17));
        const bend = sway.x.sub(0.5).mul(1.15).add(0.31);
        const q = vec2(
            near.x.mul(cos(bend)).sub(near.y.mul(sin(bend))),
            near.x.mul(sin(bend)).add(near.y.mul(cos(bend))),
        ).add(vec2(sway.w.sub(0.5), sway.x.sub(0.5)).mul(2.5));
        const drift = u.noise(q.mul(vec2(1 / 15.5, 1 / 5.3)));
        const crust = u.noise(near.mul(1 / 0.9).add(0.31));
        const rough = smoothstep(0.32, 0.68, u.noise(near.mul(1 / 21).add(0.61)).w).mul(0.8).add(0.2);
        const dune = u.noise(near.mul(1 / 17).add(0.83));
        const N = normalize(normalLocal.add(vec3(
            drift.y.mul(0.21).mul(rough).add(crust.y.mul(0.035)).add(dune.y.mul(0.16)),
            0.0,
            drift.z.mul(0.46).mul(rough).add(crust.z.mul(0.045)).add(dune.z.mul(0.16)),
        ).negate())).toVar();
        const V = normalize(cameraPosition.sub(P));
        // The chorten, the cairn and its pole throw long shadows once the sun is over the wall.
        const shadow = max(
            shaftShadow(u, P, at.chorten, CHORTEN.height, 1.25, 0.06),
            max(shaftShadow(u, P, at.cairn, 1.0, 1.0, 0.35), shaftShadow(u, P, at.cairn, CAIRN.pole + 0.9, 0.06, 0.05)),
        );
        const sun = u.nearSun.mul(float(1.0).sub(shadow.mul(0.92)));
        const ndl = dot(N, u.sunDir);
        // A low sun rakes the drifts: little wrap, so every ripple has a lit side and a blue one.
        const direct = u.sunCol.mul(clamp(ndl.add(0.06).div(1.06), 0.0, 1.0).mul(sun).mul(1.15));
        // Stones stand out of the drift where the wind keeps it thin.
        const stone = smoothstep(0.69, 0.74, crust.w.mul(0.35).add(u.noise(near.mul(1 / 5.3)).w.mul(0.65)))
            .mul(smoothstep(0.985, 0.93, N.y).add(0.25));
        const albedo = mix(vec3(...SNOW), vec3(0.14, 0.15, 0.16), clamp(stone, 0.0, 0.82));
        const hollow = drift.x.mul(0.32).add(0.78);
        const ambient = u.shade.mul(N.y.mul(0.42).add(0.69)).mul(hollow)
            .add(u.horizon.mul(0.26)).add(u.zenith.mul(0.29));
        // The crust mirrors the sky at a grazing angle.
        const facing = clamp(dot(N, V), 0.0, 1.0);
        const fresnel = hpPow4(float(1.0).sub(facing)).mul(rough.mul(-0.16).add(0.41)).add(0.018);
        const R = reflect(V.negate(), N);
        const mirrored = hpSky(u, normalize(vec3(R.x, max(R.y, 0.02), R.z))).mul(fresnel).mul(float(1.0).sub(stone));
        const Hv = normalize(V.add(u.sunDir));
        const sheen = u.sunCol.mul(hpPow4(hpSq(clamp(dot(N, Hv), 0.0, 1.0))).mul(sun).mul(0.42));
        const col = albedo.mul(direct.add(ambient)).add(mirrored).add(sheen).toVar();
        // A lock's ring of lifted powder.
        const ring = hpRingLight(u, P);
        col.addAssign(ring.mul(drift.x.mul(0.9).add(0.55)).mul(crust.w.mul(0.8).add(0.6)));
        if (glints) {
            // Single crystals: each cell of the crust fires when the view and the light line up.
            const cell = floor(near.mul(24.0));
            const seed = hpHash21(cell);
            const turn = fract(seed.add(dot(V.xz, vec2(5.3, 3.7)).mul(3.0)).add(dot(V, u.sunDir).mul(2.0)));
            const glint = smoothstep(0.972, 1.0, turn).mul(smoothstep(0.55, 1.0, hpHash21(cell.add(7.3))));
            // (Not where a cell of the crust is smaller than a pixel: there it would only be noise.)
            const fade = smoothstep(46.0, 4.0, dot(near, near).sqrt())
                .mul(smoothstep(1.1, 0.45, fwidth(near.x).add(fwidth(near.y)).mul(24.0)));
            const fire = u.sunCol.mul(sun.mul(3.2)).add(u.shade.mul(2.0)).add(u.zenith.mul(2.0)).add(ring.mul(9.0));
            col.addAssign(fire.mul(glint.mul(fade)).mul(float(1.0).sub(stone)));
        }
        return col.mul(u.breath.mul(0.85).add(0.15));
    })();
    return hpPart('HimalayanPeakPassSnow', geometry, material, -6);
}

// ── The shrine ──────────────────────────────────────────────────────────────────

const WHITEWASH = [0.92, 0.88, 0.76];
const OCHRE = [0.55, 0.135, 0.052];
const GOLD = [0.98, 0.64, 0.21];
const STONE = [0.23, 0.21, 0.2];
const WOOD = [0.28, 0.15, 0.072];

/** RGB is pigment. Alpha is gilding for surfaces and -1 for the butter lamp's flame. */
function tinted(geometry, rgb, metal = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const n = g.getAttribute('position').count;
    const data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) data.set([rgb[0], rgb[1], rgb[2], metal], i * 4);
    g.setAttribute('color', new THREE.BufferAttribute(data, 4));
    g.deleteAttribute('uv');
    return g;
}

function chortenGeometry() {
    const parts = [];
    const box = (w, h, y, rgb, depth = w, z = 0, metal = 0) => {
        const g = new THREE.BoxGeometry(w, h, depth);
        g.translate(0, y + h / 2, z);
        parts.push(tinted(g, rgb, metal));
    };
    const lathe = (profile, rgb, metal, segments = 20) => {
        parts.push(tinted(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments), rgb, metal));
    };
    // Slate footing, whitewashed terraces, projecting ochre eave.
    box(2.74, 0.21, 0, STONE);
    box(2.57, 0.26, 0.19, WHITEWASH);
    box(2.62, 0.075, 0.43, OCHRE);
    box(2.2, 0.21, 0.50, WHITEWASH);
    box(1.87, 0.2, 0.70, WHITEWASH);
    box(1.95, 0.08, 0.88, OCHRE);
    lathe([[0, 0.95], [0.74, 0.95], [0.82, 1.02], [0.8, 1.1], [0.69, 1.12],
        [0.72, 1.21], [0.85, 1.44], [0.89, 1.65], [0.86, 1.8], [0.73, 1.99],
        [0.5, 2.09], [0.32, 2.12], [0, 2.12]], WHITEWASH, 0, 32);
    // A dark offering niche, edged in vermilion, with brass in its shade.
    const niche = (w, h, front, rgb, metal) => {
        const shape = new THREE.Shape();
        shape.moveTo(-w, 0);
        shape.lineTo(w, 0);
        shape.lineTo(w, h * 0.52);
        shape.quadraticCurveTo(w, h * 0.78, 0, h);
        shape.quadraticCurveTo(-w, h * 0.78, -w, h * 0.52);
        shape.closePath();
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: false, curveSegments: 6 });
        g.translate(0, 1.3, front);
        parts.push(tinted(g, rgb, metal));
    };
    niche(0.28, 0.58, 0.86, OCHRE, 0);
    niche(0.21, 0.48, 0.902, [0.072, 0.054, 0.047], 0);
    box(0.58, 0.055, 1.27, GOLD, 0.20, 0.89, 0.65);
    const bowl = new THREE.LatheGeometry([[0.04, 0], [0.05, 0.04], [0.036, 0.055],
        [0.105, 0.09], [0.105, 0.108]].map(([r, h]) => new THREE.Vector2(r, h)), 16);
    bowl.translate(0, 1.315, 0.95);
    parts.push(tinted(bowl, GOLD, 0.87));
    const wick = new THREE.LatheGeometry([[0, 0], [0.045, 0.021], [0.038, 0.07],
        [0.011, 0.124], [0, 0.16]].map(([r, h]) => new THREE.Vector2(r, h)), 10);
    wick.translate(0, 1.42, 0.955);
    parts.push(tinted(wick, [1, 0.42, 0.09], -1));
    box(0.58, 0.24, 2.1, WHITEWASH);
    box(0.67, 0.065, 2.32, OCHRE);
    // The thirteen rings.
    const rings = [];
    for (let i = 0; i < 13; i++) {
        const y = 2.38 + (i / 13) * 1.5;
        const r = 0.34 - (i / 13) * 0.23;
        rings.push([r * 0.81, y], [r, y + 0.025], [r * 0.83, y + 0.066]);
    }
    lathe([[0, 2.36], ...rings, [0, 3.94]], GOLD, 1, 14);
    // Parasol, moon, sun and flame.
    lathe([[0, 3.86], [0.06, 3.86], [0.06, 3.94], [0.32, 3.95], [0.32, 3.99],
        [0.25, 4.04], [0.08, 4.1], [0.045, 4.16], [0.045, 4.26], [0, 4.27]], GOLD, 1);
    const moon = new THREE.TorusGeometry(0.145, 0.035, 6, 18, Math.PI * 1.08);
    moon.rotateZ(Math.PI * 0.96);
    moon.translate(0, 4.28, 0);
    parts.push(tinted(moon, GOLD, 1));
    lathe([[0, 4.2], [0.076, 4.24], [0.08, 4.31], [0.045, 4.37], [0.036, 4.43],
        [0, 4.6]], GOLD, 1);
    return mergeGeometries(parts).rotateY(0.24);
}

function cairnGeometry(rand) {
    const parts = [];
    // Interlocking, water-rounded schist slabs. Each tier supports the one above it.
    for (let level = 0; level < 5; level++) {
        const count = 8 - level;
        const radius = 0.83 - 0.145 * level;
        for (let i = 0; i < count; i++) {
            const angle = ((i + 0.34 * level + rand() * 0.22) / count) * Math.PI * 2;
            const w = 0.38 + rand() * 0.19 - 0.03 * level;
            const g = new THREE.DodecahedronGeometry(1);
            g.rotateZ(rand() * 2);
            g.rotateY(rand() * 3);
            g.scale(w, 0.14 + 0.07 * rand(), w * (0.72 + rand() * 0.32));
            g.rotateY(-angle + rand());
            g.rotateZ((rand() - 0.5) * 0.3);
            g.translate(Math.cos(angle) * radius, 0.08 + level * 0.205 + rand() * 0.045, Math.sin(angle) * radius);
            const tone = 0.58 + rand() * 0.92;
            parts.push(tinted(g, STONE.map((c) => c * tone)));
        }
    }
    const cap = new THREE.DodecahedronGeometry(1);
    cap.rotateY(0.44);
    cap.scale(0.43, 0.17, 0.4);
    cap.translate(-0.05, 0.93, 0);
    parts.push(tinted(cap, STONE));
    const pole = new THREE.CylinderGeometry(0.043, 0.087, CAIRN.pole + 0.5, 10);
    pole.translate(0, 0.4 + (CAIRN.pole + 0.5) / 2, 0);
    parts.push(tinted(pole, WOOD));
    const bindings = [[1.10, OCHRE], [1.21, WHITEWASH], [3.76, OCHRE],
        [4.98, WHITEWASH], [5.06, OCHRE], [5.14, GOLD]];
    bindings.forEach(([y, colour]) => {
        const r = 0.097 - 0.006 * y;
        const binding = new THREE.CylinderGeometry(r, r + 0.003, 0.072, 10);
        binding.translate(0, y, 0);
        parts.push(tinted(binding, colour, colour === GOLD ? 0.8 : 0));
    });
    return mergeGeometries(parts);
}

/**
 * The chorten and the cairn as one mesh.
 * @param {object} u       shared uniforms (`spark` lights the spire when a gust leaves it)
 * @param {object} field
 */
export function createShrine(u, field) {
    const chorten = chortenGeometry();
    const cx = EYE.x + CHORTEN.x;
    const cz = EYE.z + CHORTEN.z;
    chorten.scale(1, CHORTEN.height / 4.6, 1);
    chorten.translate(cx, passHeight(field, cx, cz) - 0.12, cz);
    const cairn = cairnGeometry(mulberry32(8848));
    const kx = EYE.x + CAIRN.x;
    const kz = EYE.z + CAIRN.z;
    cairn.translate(kx, passHeight(field, kx, kz) - 0.06, kz);
    const geometry = mergeGeometries([chorten, cairn]);

    const material = hpSolidMaterial('HimalayanPeakShrine');
    material.side = THREE.DoubleSide;
    material.colorNode = Fn(() => {
        const P = positionLocal;
        const N = normalize(normalLocal).toVar();
        const paint = attribute('color', 'vec4');
        const V = normalize(cameraPosition.sub(P));
        const sun = u.nearSun;
        // Rime and blown snow lie on everything that faces up.
        const grain = u.noise(P.xz.mul(1.3).add(P.y.mul(0.7)));
        const metal = max(paint.a, 0);
        const snow = smoothstep(0.44, 0.91, N.y.add(grain.x.sub(0.5).mul(0.7)))
            .mul(float(1.0).sub(metal.mul(0.6)));
        // Weather runs down the whitewash.
        const streak = u.noise(vec2(P.x.add(P.z).mul(2.3), P.y.mul(0.35))).w;
        const albedo = mix(paint.rgb.mul(streak.mul(0.45).add(0.7)), vec3(...SNOW), snow);
        const ndl = dot(N, u.sunDir);
        const ground = smoothstep(0.0, 1.3, P.y.sub(BOOTS - 1.0)).mul(0.5).add(0.5);
        const towardLight = dot(N, u.sunDir).mul(0.5).add(0.5);
        const ambient = u.shade.mul(N.y.mul(0.4).add(0.72)).add(u.zenith.mul(0.35))
            .add(u.horizon.mul(towardLight.mul(0.53).add(0.15)))
            // The snow all round throws light back up.
            .add(u.shade.mul(max(N.y.negate(), 0.0)).mul(0.5))
            .mul(ground);
        const matte = albedo.mul(u.sunCol.mul(clamp(ndl, 0.0, 1.0).mul(sun)).add(ambient));
        // Gilding: the sky and the sun in it.
        const R = reflect(V.negate(), N);
        const sky = hpSky(u, normalize(vec3(R.x, max(R.y, 0.02), R.z)));
        const hot = hpPow4(hpPow4(clamp(dot(R, u.sunDir), 0.0, 1.0))).mul(sun).mul(6.0);
        const gilt = paint.rgb.mul(sky.mul(1.24).add(u.sunCol.mul(hot))
            .add(u.horizon.mul(towardLight.mul(0.72))).add(u.shade.mul(0.42)));
        const col = mix(matte, gilt, metal.mul(float(1.0).sub(snow))).toVar();
        // A gust leaving the spire lights it in the piece's colour.
        col.addAssign(u.spark.rgb.mul(u.spark.a).mul(metal.mul(1.8).add(0.12)).mul(smoothstep(BOOTS + 1.0, BOOTS + 5.0, P.y)));
        const flame = max(paint.a.negate(), 0).mul(sin(u.time.mul(4.1)).mul(0.065).add(1));
        col.addAssign(vec3(4.1, 1.55, 0.29).mul(flame));
        return col.mul(u.breath.mul(0.85).add(0.15));
    })();
    return hpPart('HimalayanPeakShrine', geometry, material, -8);
}
