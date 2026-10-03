/**
 * Neon Dusk — three mountain ranges opening into a pass where the sun sets.
 *
 * Each range is a band of ridged-multifractal terrain on a polar strip around the rest camera
 * (built once on the CPU, ~17k vertices for all three), merged into ONE mesh and one draw. The
 * ranges recede in atmospheric perspective: the near flanks are near-black violet framing the
 * pass, the middle range carries the theme's signature — glowing topographic contour lines —
 * and the far range is a pale haze-washed wall. The sun sits low behind them, so every ridge
 * that turns edge-on to the view burns with a rim of sunset light, hottest near the sun.
 * Luminous mist pools along their feet above the glass floor.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    fract,
    fwidth,
    length,
    max,
    min,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    pow,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import {
    RIG,
    ndApplyHaze,
    ndLineAA,
    ndSunAlign,
    rgb,
} from './neon-dusk-tsl.js';

const DEG = Math.PI / 180;

/**
 * Ranges, back to front. r0/r1 = the band's distance from the rest camera; peak/base = crest
 * heights (base lifts a continuous wall; cut drops the noise floor so valleys reach the ground);
 * pass = how deep the pass at azimuth 0 cuts (0..1) and passWidth its half-width (rad);
 * frame = the extra height of the two peaks framing the pass; span = azimuth half-width (°).
 * Each farther range rises higher in angle than the one in front, so all three read in layers.
 */
export const RANGES = Object.freeze([
    {
        r0: 1800,
        r1: 2900,
        peak: 680,
        base: 160,
        cut: 0,
        pass: 0.88,
        passWidth: 0.2,
        frame: 0.25,
        freq: 1 / 560,
        span: 128,
        seg: 260,
        rows: 20,
    },
    {
        r0: 900,
        r1: 1450,
        peak: 260,
        base: 0,
        cut: 0.1,
        pass: 0.86,
        passWidth: 0.16,
        frame: 0.45,
        freq: 1 / 280,
        span: 124,
        seg: 380,
        rows: 32,
    },
    {
        r0: 380,
        r1: 680,
        peak: 90,
        base: 0,
        cut: 0.16,
        pass: 0.95,
        passWidth: 0.24,
        frame: 0.9,
        freq: 1 / 150,
        span: 112,
        seg: 620,
        rows: 48,
    },
]);

/**
 * The ranges are art-directed, not random: one fixed terrain, identical for every player and
 * every visit (the old theme's mountains were deterministic too). This seed is the terrain the
 * composition was tuned on.
 */
export const TERRAIN_SEED = 0x57a21197;

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= (t + Math.imul(t ^ (t >>> 7), 61 | t));
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── CPU noise (seeded Perlin) ────────────────────────────────────────────────

function makePerlin(rand) {
    const perm = new Uint8Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];
    const grad = (h, x, y) => {
        switch (h & 7) {
        case 0: return x + y;
        case 1: return -x + y;
        case 2: return x - y;
        case 3: return -x - y;
        case 4: return x;
        case 5: return -x;
        case 6: return y;
        default: return -y;
        }
    };
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    return (x, y) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const xf = x - xi;
        const yf = y - yi;
        const X = xi & 255;
        const Y = yi & 255;
        const u = fade(xf);
        const v = fade(yf);
        const aa = perm[perm[X] + Y];
        const ab = perm[perm[X] + Y + 1];
        const ba = perm[perm[X + 1] + Y];
        const bb = perm[perm[X + 1] + Y + 1];
        const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
        const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
        return (x1 + v * (x2 - x1)) * 0.7;
    };
}

/**
 * Ridged multifractal (Musgrave) over a lightly warped domain: knife-edge crests, branching
 * gullies, eroded valleys. Peaks are sharpened by a power. ~[0, 1].
 */
function ridged(noise, x, y) {
    let sum = 0;
    let amp = 0.55;
    let weight = 1;
    let fx = x + 0.4 * noise(x * 0.5 + 5.2, y * 0.5 + 1.3);
    let fy = y + 0.4 * noise(x * 0.5 + 9.1, y * 0.5 + 4.7);
    for (let o = 0; o < 6; o += 1) {
        let s = 1 - Math.abs(noise(fx, fy));
        s *= s;
        s *= weight;
        weight = Math.min(1, Math.max(0, s * 1.8));
        sum += s * amp;
        const nx = fx * 1.7 - fy * 1.1;
        fy = fx * 1.1 + fy * 1.7 + 3.1;
        fx = nx + 7.7;
        amp *= 0.5;
    }
    return Math.min(1, sum / 0.98) ** 1.3;
}

function buildRange(range, index, noise) {
    const { seg, rows } = range;
    const span = range.span * DEG;
    const count = (seg + 1) * (rows + 1);
    const position = new Float32Array(count * 3);
    const info = new Float32Array(count * 2);
    let v = 0;
    for (let s = 0; s <= seg; s += 1) {
        const az = -span + (2 * span * s) / seg;
        // The crest wanders across the band; peak heights vary along it.
        const spine = 0.42 + 0.2 * noise(az * 2.3 + index * 11.3, 0.5);
        const azShape = 0.62 + 0.38 * (0.5 + 0.5 * noise(az * 1.7 + index * 5.1, 4.2));
        const passCut = 1 - range.pass * Math.exp(-((az / range.passWidth) ** 2));
        const frameD = (Math.abs(az) - range.passWidth * 1.7) / (range.passWidth * 0.7);
        const frameG = Math.exp(-frameD * frameD);
        // Toward the edges of the span the range sinks away (the edges are off screen anyway).
        const edge = 1 - THREE.MathUtils.smoothstep(Math.abs(az), span * 0.86, span);
        for (let j = 0; j <= rows; j += 1) {
            const t = j / rows;
            const r = range.r0 + (range.r1 - range.r0) * t;
            const x = RIG.x + Math.sin(az) * r;
            const z = RIG.z - Math.cos(az) * r;
            const across = (t - spine) / 0.34;
            const env = (0.6 + 0.4 * Math.exp(-across * across))
                * THREE.MathUtils.smoothstep(t, 0, 0.08)
                * (1 - THREE.MathUtils.smoothstep(t, 0.86, 1));
            const n = ridged(noise, x * range.freq, z * range.freq);
            // Valleys reach the floor: separate peaks with gullies between them (no smooth
            // ramp anywhere — contour lines wrap real forms instead of striping a slope). The
            // massifs framing the pass are always there, textured by the same noise.
            const relief = Math.max(0, (n - range.cut) / (1 - range.cut))
                + range.frame * frameG * (0.3 + 0.7 * n);
            const h = (range.base + (range.peak - range.base) * relief) * env * azShape * passCut * edge;
            position[v * 3] = x;
            position[v * 3 + 1] = Math.max(0, h) - 0.5;
            position[v * 3 + 2] = z;
            info[v * 2] = index;
            info[v * 2 + 1] = t;
            v += 1;
        }
    }
    const indices = [];
    const col = rows + 1;
    for (let s = 0; s < seg; s += 1) {
        for (let j = 0; j < rows; j += 1) {
            const a = s * col + j;
            const b = a + col;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function mergeGeometries(list) {
    let vertexCount = 0;
    let indexCount = 0;
    for (const g of list) {
        vertexCount += g.attributes.position.count;
        indexCount += g.index.count;
    }
    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const info = new Float32Array(vertexCount * 2);
    const index = new Uint32Array(indexCount);
    let vo = 0;
    let io = 0;
    for (const g of list) {
        position.set(g.attributes.position.array, vo * 3);
        normal.set(g.attributes.normal.array, vo * 3);
        info.set(g.attributes.aInfo.array, vo * 2);
        const src = g.index.array;
        for (let i = 0; i < src.length; i += 1) index[io + i] = src[i] + vo;
        vo += g.attributes.position.count;
        io += src.length;
        g.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(RIG.x, 0, RIG.z), 2700);
    return geometry;
}

/**
 * @param {object} u  shared world uniforms
 * @param {object} [opts]
 * @param {number} [opts.detail=1]   resolution scale for lower tiers
 * @param {boolean} [opts.contours=true]
 * @param {number} [opts.seed=TERRAIN_SEED]
 * @returns {THREE.Mesh}
 */
export function createMountains(u, { detail = 1, contours = true, seed = TERRAIN_SEED } = {}) {
    const noise = makePerlin(mulberry32(seed));
    const geometry = mergeGeometries(RANGES.map((range, i) => buildRange({
        ...range,
        seg: Math.max(48, Math.round(range.seg * detail)),
        rows: Math.max(8, Math.round(range.rows * Math.sqrt(detail))),
    }, i, noise)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDuskMountains';
    material.fog = false;

    const info = attribute('aInfo', 'vec2');
    material.colorNode = Fn(() => {
        const p = positionWorld;
        const id = info.x;
        const wFar = float(1.0).sub(step(0.5, id));
        const wNear = step(1.5, id);
        const wMid = float(1.0).sub(wFar).sub(wNear);
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(vec2(rel.x, rel.z)).toVar();
        const V = normalize(rel).toVar();
        const n = normalize(normalWorld).toVar();
        const L = u.sunDir;

        // Scan-line coordinates up front (fwidth needs uniform control flow): distance from
        // the rest camera, so each line is a cross-section tracing the hills' real profile.
        const restDist = length(vec2(p.x.sub(RIG.x), p.z.sub(RIG.z)));
        const spacing = mix(float(34.0), float(15.0), wNear);
        const cr = restDist.div(spacing);
        const fwC = fwidth(cr);

        // ── Body: near-black violet, lifted by sky light on the up-facing slopes ──
        const body = mix(mix(rgb(0x2a1650), rgb(0x150a2b), wMid), rgb(0x090416), wNear);
        const col = body.mul(float(0.6).add(n.y.mul(0.4))).toVar();
        col.addAssign(rgb(0x4a2a8c).mul(clamp(n.y, 0.0, 1.0).mul(0.12)));

        // ── Sunset rim: slopes turning edge-on to the view burn hot where they face the sun ──
        const sa = ndSunAlign(rel.z.div(max(dist, 1e-3))).toVar();
        const edgeOn = float(1.0).sub(abs(dot(n, V)));
        const toward = pow(max(dot(V, L), 0.0), 3.0);
        const facingSun = clamp(dot(n, vec3(L.x, 0.0, L.z)).mul(0.6).add(0.4), 0.0, 1.0);
        const rimCol = mix(rgb(0xd0257a, 1.2), rgb(0xff9a4a, 2.6), toward);
        const rim = pow(edgeOn, 5.0).mul(facingSun).mul(sa.mul(1.4).add(0.14));
        col.addAssign(rimCol.mul(rim).mul(float(1.0).add(u.sunPulse.mul(0.6))));

        // ── Neon scan lines: cross-sections at fixed distances trace every hill's profile,
        // magenta at the feet turning cyan toward the crests (the laser-scanned terrain look) ──
        if (contours) {
            const d = fract(cr.add(0.5)).sub(0.5);
            // Width capped at ~2 px: on faces turned square to the camera the distance barely
            // changes across the face, and an uncapped line would flood it.
            const line = ndLineAA(d, min(float(0.05), fwC.mul(1.1)), fwC);
            // Line clears: a wave of light rolls through the ranges toward the camera.
            const wd = restDist.sub(u.contourWave.x).div(70.0);
            const wave = exp(wd.mul(wd).negate()).mul(u.contourWave.y);
            const low = mix(rgb(0xff2fa8, 1.2), rgb(0x9b4bff, 1.2), u.comboShift);
            const highC = mix(rgb(0x2ce8ff, 1.25), rgb(0xff6ad8, 1.3), u.comboShift);
            const lineCol = mix(low, highC, smoothstep(4.0, 70.0, p.y));
            const lineW = wMid.mul(0.6).add(wNear.mul(0.9)).mul(smoothstep(1.0, 6.0, p.y))
                .mul(exp(dist.mul(-0.0005)));
            col.addAssign(lineCol.mul(line.mul(lineW).mul(float(0.8).add(wave.mul(3.0)))));
            col.addAssign(lineCol.mul(wave.mul(wMid.add(wNear)).mul(0.06)));
        }

        // ── Mist pooling at the feet, luminous toward the sun ──
        const mistCol = mix(rgb(0x5a2a8a, 0.9), rgb(0xff6a7e, 1.25), sa);
        const mist = exp(max(p.y, 0.0).div(mix(mix(float(30.0), float(14.0), wMid), float(8.0), wNear)).negate())
            .mul(mix(mix(float(0.6), float(0.5), wMid), float(0.45), wNear));
        col.assign(mix(col, mistCol, clamp(mist, 0.0, 1.0)));

        // ── Atmospheric perspective: the far wall dissolves into the horizon haze ──
        const hazeK = mix(mix(float(1 / 3000), float(1 / 3600), wMid), float(1 / 5000), wNear);
        return ndApplyHaze(col, rel, hazeK);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NeonDuskMountains';
    mesh.frustumCulled = false;
    mesh.renderOrder = -5;
    return mesh;
}
