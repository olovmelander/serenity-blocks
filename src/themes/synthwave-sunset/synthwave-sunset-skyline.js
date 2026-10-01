/**
 * Synthwave Sunset — the skyline: neon-wireframe mountains and the city.
 *
 * Both are authored in polar coordinates around the rest camera (azimuth φ in degrees, sun at
 * 0°, positive to the right) with ELEVATION envelopes, so what the player sees is controlled in
 * screen terms: a low wireframe ridge crosses the sun's lower half (the sun sets behind it),
 * taller peaks flank it, the downtown towers rise at φ ≈ 40–72° (right of the HUD in the game
 * view), and everything is one merged mesh per kind — two draws.
 *
 * City: slab and setback towers with spires, sparse office windows (lit floor by floor, warm
 * amber with a few cool and magenta ones), faint neon outlines on the box edges, roofline and
 * corner neon strips, and blinking red aircraft beacons on the spires. Windows fade to their
 * average before they are small enough to shimmer. Distance + height fog melts the bases into
 * the horizon glow while the rooftops stay crisp.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    float,
    floor,
    fract,
    fwidth,
    max,
    min,
    mix,
    normalWorld,
    positionWorld,
    pow,
    select,
    smoothstep,
    sqrt,
    step,
    vec2,
} from 'three/tsl';
import {
    RIG,
    rgb,
    swApplyHaze,
    swHash21,
    swSunAlign,
} from './synthwave-sunset-tsl.js';
import { FLOOR_FOG_DENSITY } from './synthwave-sunset-floor.js';

const DEG = Math.PI / 180;

/** Neon kind by roll (0 none, 1 roofline band, 2 corner strips, 3 double band). */
const NEON_KINDS = [[0.55, 0], [0.8, 1], [0.94, 2], [Infinity, 3]];

/** The city is closer than the mountains: thinner haze keeps its towers dark silhouettes. */
const CITY_FOG_DENSITY = 0.0013;

/** Piecewise-linear lookup over [x, y] pairs (x ascending). */
function table(points) {
    return (x) => {
        if (x <= points[0][0]) return points[0][1];
        for (let i = 1; i < points.length; i += 1) {
            const [x1, y1] = points[i];
            if (x <= x1) {
                const [x0, y0] = points[i - 1];
                return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
            }
        }
        return points[points.length - 1][1];
    };
}

/** Max mountain elevation (deg) by azimuth: a low ridge across the sun, peaks flanking it. */
const MOUNTAIN_ENVELOPE = table([
    [-130, 3.0], [-100, 5.4], [-74, 4.0], [-48, 6.5], [-30, 5.4], [-17, 7.4], [-10, 3.4], [-4, 1.6],
    [4, 1.8], [9, 4.2], [14, 6.6], [22, 4.6], [31, 5.6], [42, 4.0], [55, 5.3], [67, 7.3], [86, 5.0],
    [110, 6.2], [130, 3.0],
]);

/** Max building elevation (deg) by azimuth: a low strip under the sun, downtown at 40–72°. */
const CITY_ENVELOPE = table([
    [-125, 1.2], [-96, 2.0], [-76, 2.8], [-56, 3.8], [-36, 4.4], [-21, 3.4], [-12, 1.6], [-7, 0.8],
    [7, 0.8], [12, 1.8], [18, 3.8], [30, 5.2], [40, 8.2], [48, 12.0], [56, 13.6], [64, 11.6],
    [72, 8.0], [82, 4.6], [96, 3.0], [125, 1.5],
]);

const polar = (phiDeg, d) => ({
    x: Math.sin(phiDeg * DEG) * d,
    z: RIG.z - Math.cos(phiDeg * DEG) * d,
});

const eyeHeight = (elevDeg, d) => RIG.height + Math.tan(elevDeg * DEG) * d;

// ── Mountains ────────────────────────────────────────────────────────────────

function buildRange(out, spec, rand) {
    const {
        a0, a1, d0, d1, colDeg, envScale, bright,
    } = spec;
    const peaks = [];
    for (let a = a0 - 8; a < a1 + 8;) {
        const w = 4 + rand() * 8;
        peaks.push({ c: a + rand() * w * 0.6, w, h: 0.5 + rand() * 0.5 });
        a += w * 0.5;
    }
    const ridge = (phi) => {
        let m = 0.2;
        for (const p of peaks) {
            const t = 1 - Math.abs(phi - p.c) / p.w;
            if (t > 0) m = Math.max(m, p.h * t ** 1.2);
        }
        return m * MOUNTAIN_ENVELOPE(phi) * envScale;
    };
    // Rows climb the visible face: the base row sits in front on the floor, the ridge row is set
    // back, so from a ground-level camera the rows read as contour lines up the slope. Odd rows
    // shift half a column, which turns the quads into the classic triangular lattice.
    const ROWS = 6;
    const cols = Math.max(2, Math.ceil((a1 - a0) / colDeg));
    const colStep = (a1 - a0) / cols;
    const grid = [];
    for (let k = 0; k <= ROWS; k += 1) {
        const f = k / ROWS;
        const d = d0 + (d1 - d0) * f ** 1.4;
        const row = [];
        for (let i = 0; i <= cols; i += 1) {
            const shift = k % 2 === 1 && i < cols ? colStep * 0.5 : 0;
            const edge = i === 0 || i === cols;
            const phi = a0 + colStep * i + shift + (edge || k === 0 ? 0 : (rand() - 0.5) * colStep * 0.3);
            const elev = ridge(phi);
            const dRidge = d1;
            const yRidge = Math.max(0, eyeHeight(elev, dRidge));
            const jitter = k === 0 || k === ROWS ? 1 : 0.94 + rand() * 0.12;
            const y = yRidge * f ** 0.9 * jitter;
            const env = Math.max(0.5, eyeHeight(MOUNTAIN_ENVELOPE(phi) * envScale, dRidge));
            const { x, z } = polar(phi, d);
            row.push({
                x, y, z, h: Math.min(1, y / env),
            });
        }
        grid.push(row);
    }
    const pushTri = (a, b, c) => {
        out.position.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        out.bary.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
        out.mount.push(a.h, bright, b.h, bright, c.h, bright);
    };
    for (let k = 0; k < ROWS; k += 1) {
        for (let i = 0; i < cols; i += 1) {
            const a = grid[k][i];
            const b = grid[k][i + 1];
            const c = grid[k + 1][i];
            const d = grid[k + 1][i + 1];
            if (k % 2 === 0) {
                pushTri(a, b, c);
                pushTri(b, d, c);
            } else {
                pushTri(a, b, d);
                pushTri(a, d, c);
            }
        }
    }
}

export function createMountains(u, { rand }) {
    const out = { position: [], bary: [], mount: [] };
    buildRange(out, {
        a0: -130, a1: 130, d0: 880, d1: 1080, colDeg: 1.6, envScale: 1.0, bright: 0.75,
    }, rand);
    buildRange(out, {
        a0: -118, a1: -13, d0: 560, d1: 680, colDeg: 1.9, envScale: 0.52, bright: 1.0,
    }, rand);
    buildRange(out, {
        a0: 14, a1: 120, d0: 560, d1: 680, colDeg: 1.9, envScale: 0.5, bright: 1.0,
    }, rand);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
    geometry.setAttribute('aBary', new THREE.Float32BufferAttribute(out.bary, 3));
    geometry.setAttribute('aMount', new THREE.Float32BufferAttribute(out.mount, 2));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveMountains';
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.colorNode = Fn(() => {
        const b = attribute('aBary', 'vec3');
        const m = attribute('aMount', 'vec2');
        const hf = m.x;
        const edge = min(b.x, min(b.y, b.z));
        const fw = max(fwidth(edge), 1e-4);
        const wire = float(1.0).sub(smoothstep(fw.mul(0.4), fw.mul(1.5), edge));
        const rel = positionWorld.sub(cameraPosition).toVar();
        const sa = swSunAlign(rel.z.div(max(sqrt(rel.x.mul(rel.x).add(rel.z.mul(rel.z))), 1e-3)));
        // Dark faces; the peaks nearest the sun catch a warm rim.
        const face = rgb(0x0d051d).mul(float(0.6).add(hf.mul(0.4)))
            .add(rgb(0xff6a58).mul(pow(hf, 4.0).mul(sa).mul(0.25)));
        const wireCol = mix(rgb(0xff2f93), rgb(0xb24dff), hf).mul(mix(float(0.35), float(2.1), hf.mul(hf))).mul(m.y);
        const col = face.add(wireCol.mul(wire));
        return swApplyHaze(col, rel, positionWorld.y, float(FLOOR_FOG_DENSITY), float(0.02), float(0.25));
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SynthwaveMountains';
    mesh.renderOrder = -5;
    return mesh;
}

// ── City ─────────────────────────────────────────────────────────────────────

function addBox(out, cx, cz, hx, hz, y0, y1, meta) {
    const base = out.position.length / 3;
    const X0 = cx - hx;
    const X1 = cx + hx;
    const Z0 = cz - hz;
    const Z1 = cz + hz;
    const quads = [
        // +x, −x, +z, −z, top: (a, b, c, d) counter-clockwise from outside
        [[X1, y0, Z1], [X1, y0, Z0], [X1, y1, Z0], [X1, y1, Z1], [1, 0, 0]],
        [[X0, y0, Z0], [X0, y0, Z1], [X0, y1, Z1], [X0, y1, Z0], [-1, 0, 0]],
        [[X0, y0, Z1], [X1, y0, Z1], [X1, y1, Z1], [X0, y1, Z1], [0, 0, 1]],
        [[X1, y0, Z0], [X0, y0, Z0], [X0, y1, Z0], [X1, y1, Z0], [0, 0, -1]],
        [[X0, y1, Z1], [X1, y1, Z1], [X1, y1, Z0], [X0, y1, Z0], [0, 1, 0]],
    ];
    quads.forEach((q, f) => {
        for (let k = 0; k < 4; k += 1) {
            out.position.push(q[k][0], q[k][1], q[k][2]);
            out.normal.push(q[4][0], q[4][1], q[4][2]);
            out.box.push(cx, cz, hx, hz);
            out.meta.push(meta.seed, y1, meta.neon, meta.spire);
        }
        const i = base + f * 4;
        out.index.push(i, i + 1, i + 2, i, i + 2, i + 3);
    });
}

function buildCity(rand, density) {
    const out = {
        position: [], normal: [], box: [], meta: [], index: [],
    };
    const layers = [
        {
            d0: 360, d1: 530, envScale: 1.0, stepMin: 1.5, stepMax: 3.2,
        },
        {
            d0: 215, d1: 330, envScale: 0.72, stepMin: 2.3, stepMax: 4.8,
        },
    ];
    for (const layer of layers) {
        for (let phi = -122; phi < 122;) {
            const downtown = phi > 36 && phi < 74;
            const stride = (layer.stepMin + (layer.stepMax - layer.stepMin) * rand()) * (downtown ? 0.55 : 1);
            phi += stride / density;
            if (rand() < 0.1) continue;
            // Nothing near stands in front of the sun: its lower half belongs to the ridge.
            if (layer.d0 < 300 && Math.abs(phi) < 11) continue;
            const d = layer.d0 + (layer.d1 - layer.d0) * rand();
            const env = CITY_ENVELOPE(phi) * layer.envScale;
            const elev = env * (0.3 + 0.7 * rand() ** 0.6);
            const top = Math.max(3, eyeHeight(elev, d));
            const scale = d / 300;
            const w = (5 + rand() * 9) * scale;
            const dp = (5 + rand() * 9) * scale;
            const { x, z } = polar(phi, d);
            const r = rand();
            const neon = elev < 2.2 ? 0 : NEON_KINDS.find(([limit]) => r < limit)[1];
            const meta = { seed: rand(), neon, spire: 0 };
            const tall = elev > 6;
            if (tall && rand() < 0.55) {
                const h1 = top * (0.55 + rand() * 0.2);
                addBox(out, x, z, w / 2, dp / 2, 0, h1, meta);
                addBox(out, x, z, w * 0.36, dp * 0.36, h1, top, meta);
            } else {
                addBox(out, x, z, w / 2, dp / 2, 0, top, meta);
            }
            if (tall && rand() < 0.45) {
                const s = 0.35 * scale;
                addBox(out, x, z, s, s, top, top + (4 + rand() * 9) * scale, { seed: meta.seed, neon: 0, spire: 1 });
            }
        }
    }
    return out;
}

/**
 * @param {object} u  shared world uniforms
 * @param {object} opts
 * @param {() => number} opts.rand
 * @param {number} [opts.density=1]   building density multiplier (quality tier)
 * @param {number} [opts.windowGlow=1]
 */
export function createCity(u, { rand, density = 1, windowGlow = 1 }) {
    const out = buildCity(rand, density);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
    geometry.setAttribute('aBox', new THREE.Float32BufferAttribute(out.box, 4));
    geometry.setAttribute('aMeta', new THREE.Float32BufferAttribute(out.meta, 4));
    geometry.setIndex(out.index);
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveCity';
    material.fog = false;
    material.colorNode = Fn(() => {
        const p = positionWorld;
        const n = normalWorld;
        const box = attribute('aBox', 'vec4');
        const meta = attribute('aMeta', 'vec4');
        const seed = meta.x;
        const boxTop = meta.y;
        const neonKind = meta.z;
        const isSpire = meta.w;

        const side = float(1.0).sub(step(0.5, abs(n.y)));
        const xFacing = step(abs(n.z), abs(n.x));
        const u0 = mix(p.x, p.z, xFacing);
        const cu = mix(box.x, box.y, xFacing);
        const halfW = mix(box.z, box.w, xFacing);
        const ul = u0.sub(cu);
        const faceId = n.x.mul(2.0).add(n.z.mul(3.0));

        // ── Windows: floor-by-floor occupancy, per-window colour ──
        const cellU = ul.add(halfW).div(1.5);
        const cellV = p.y.div(2.3);
        const cell = floor(vec2(cellU, cellV));
        const fc = fract(vec2(cellU, cellV));
        const fwU = max(fwidth(cellU), 1e-4);
        const fwV = max(fwidth(cellV), 1e-4);
        const winU = smoothstep(float(0.28).sub(fwU), float(0.28).add(fwU), fc.x)
            .mul(float(1.0).sub(smoothstep(float(0.72).sub(fwU), float(0.72).add(fwU), fc.x)));
        const winV = smoothstep(float(0.32).sub(fwV), float(0.32).add(fwV), fc.y)
            .mul(float(1.0).sub(smoothstep(float(0.72).sub(fwV), float(0.72).add(fwV), fc.y)));
        const rowOcc = swHash21(vec2(cell.y, seed.mul(97.0).add(faceId)));
        const winH = swHash21(cell.add(vec2(seed.mul(13.7).add(faceId.mul(5.1)), seed.mul(3.3))));
        const lit = step(float(0.95).sub(rowOcc.mul(0.5)), winH);
        const pick = swHash21(cell.mul(1.7).add(seed.mul(41.0)));
        const winCol = select(
            pick.lessThan(0.8),
            rgb(0xffa64e),
            select(pick.lessThan(0.95), rgb(0x8fd8ff), rgb(0xff5fd0)),
        );
        const bright = float(0.4).add(swHash21(cell.add(vec2(7.7, seed))).mul(0.75));
        const near = winCol.mul(winU.mul(winV).mul(lit).mul(bright));
        const coverage = smoothstep(0.25, 0.7, max(fwU, fwV));
        const avg = rgb(0xffa060).mul(0.03);
        const inBody = step(1.2, p.y).mul(step(p.y, boxTop.sub(0.8))).mul(float(1.0).sub(isSpire));
        const occupied = step(0.12, seed);
        const windows = mix(near, avg, coverage).mul(side).mul(inBody).mul(occupied)
            .mul(float(windowGlow))
            .mul(float(1.0).add(u.cityPulse.mul(1.6)));

        // ── Structure: dark facades lifted slightly at the base, a hairline neon outline ──
        const facade = mix(rgb(0x14081f), rgb(0x05030b), smoothstep(0.0, 35.0, p.y));
        const roof = rgb(0x0b0616);
        const base = mix(roof, facade, side);
        const fwE = max(fwidth(ul), 1e-4);
        const corner = float(1.0).sub(smoothstep(0.0, fwE.mul(1.5), halfW.sub(abs(ul))));
        const fwY = max(fwidth(p.y), 1e-4);
        const roofLine = float(1.0).sub(smoothstep(0.0, fwY.mul(1.5), boxTop.sub(p.y)));
        const outline = max(corner, roofLine).mul(side).mul(0.22);

        // ── Neon: roofline band (1), corner strips (2), double band (3) ──
        const neonPick = swHash21(vec2(seed.mul(71.0), 3.0));
        const neonCol = select(
            neonPick.lessThan(0.45),
            rgb(0x2ae4ff),
            select(neonPick.lessThan(0.85), rgb(0xff2bd1), rgb(0x9b5cff)),
        );
        const bandA = smoothstep(boxTop.sub(1.7), boxTop.sub(1.7).add(fwY), p.y)
            .mul(float(1.0).sub(smoothstep(boxTop.sub(1.2), boxTop.sub(1.2).add(fwY), p.y)));
        const bandB = smoothstep(boxTop.sub(4.2), boxTop.sub(4.2).add(fwY), p.y)
            .mul(float(1.0).sub(smoothstep(boxTop.sub(3.6), boxTop.sub(3.6).add(fwY), p.y)));
        const strip = float(1.0).sub(smoothstep(0.4, float(0.4).add(fwE), halfW.sub(abs(ul))))
            .mul(smoothstep(0.0, 18.0, p.y));
        const neonMask = select(
            neonKind.lessThan(0.5),
            float(0.0),
            select(neonKind.lessThan(1.5), bandA, select(neonKind.lessThan(2.5), strip, max(bandA, bandB))),
        );
        const neon = neonCol.mul(neonMask.mul(side).mul(float(2.4).add(u.cityPulse.mul(2.0))));

        // ── Aircraft beacons on the spires ──
        const blink = step(0.86, fract(u.time.mul(0.45).add(seed.mul(7.0))));
        const beacon = rgb(0xff2418).mul(step(boxTop.sub(0.9), p.y).mul(isSpire).mul(blink).mul(14.0));

        const col = base.add(rgb(0xff4c9c).mul(outline)).add(windows).add(neon).add(beacon);
        const rel = p.sub(cameraPosition);
        return swApplyHaze(col, rel, p.y, float(CITY_FOG_DENSITY), float(0.05), float(0.6));
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SynthwaveCity';
    mesh.renderOrder = -4;
    return mesh;
}

/** Exposed for tests/tools: the authored envelopes (deg). */
export const SKYLINE_ENVELOPES = Object.freeze({ mountain: MOUNTAIN_ENVELOPE, city: CITY_ENVELOPE });
