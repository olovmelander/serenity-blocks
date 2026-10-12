/**
 * Painted Ages terrain. Three-free, deterministic CPU geometry and drainage.
 *
 * A0 scratch lab: 512² / 4 km, 64 D8 stream-power passes, K=.14, diffusion=.002.
 * Runtime adds a bounded 352² / 40-pass D8 field in the worker; only its final
 * displacement transfers to the scene. Every ground-following part shares it.
 * Reference refinements: strike 35°, warped 820 m ranks, crest .77, 115–240 m relief;
 * unequal 105 m trunk valleys split into tapering branches, with 10–30 m fine rills.
 * Unequal saddles and planar spurs break the cadence of eroded asymmetric fronts.
 * The different-depth fronts frame a plum wash. The 9.7 km Chevron Face has broad
 * dissected flatirons. Worker preparation keeps the cold bake off the frame thread.
 */

import { PORTRAIT_RIG } from './painted-ages-core.js';

export const TERRAIN = Object.freeze({
    seed: 20261012,
    strike: 35,
    spacing: 820,
    crest: 0.77,
    camera: Object.freeze([0, 140, 200]),
    domain: Object.freeze([-6000, 6000, -11000, 200]),
    fronts: Object.freeze([
        Object.freeze({ x: -310, z: -400, width: 190 }),
        Object.freeze({ x: 360, z: -660, width: 220 }),
    ]),
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
};
const sq = (v) => v * v;
const fract = (v) => v - Math.floor(v);
const siteCache = new Map();
const erosionCache = new Map();
const hash = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);
const noise = (v) => {
    const i = Math.floor(v);
    const t = fract(v);
    return hash(i) + (hash(i + 1) - hash(i)) * t * t * (3 - 2 * t);
};

function erodedField(seed) {
    if (erosionCache.has(seed)) return erosionCache.get(seed);
    const size = 352;
    const minX = -2200;
    const minZ = -4300;
    const step = 4500 / (size - 1);
    const count = size * size;
    const original = new Float32Array(count);
    const ground = new Float32Array(count);
    const water = new Float32Array(count);
    const receiver = new Int32Array(count);
    const slope = new Float32Array(count);
    const order = new Uint32Array(count);
    const bins = new Uint16Array(count);
    const histogram = new Uint32Array(32768);
    const offsets = new Uint32Array(32768);
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            const i = row * size + col;
            const x = minX + col * step;
            const z = minZ + row * step;
            original[i] = baseTerrainHeight(x, z, seed);
            const roughness = noise(x / 33 + z / 71 + 13.3) + noise(z / 27 - x / 89 + seed * 0.01) - 1;
            ground[i] = original[i] + roughness * 7;
        }
    }
    // Actual D8 flow accumulation, re-routed after each stream-power pass. The
    // small relief seeds tributaries; accumulation deepens connected trunk beds.
    for (let pass = 0; pass < 40; pass++) {
        water.fill(1);
        receiver.fill(-1);
        slope.fill(0);
        for (let row = 1; row < size - 1; row++) {
            for (let col = 1; col < size - 1; col++) {
                const i = row * size + col;
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dz === 0) continue;
                        const next = i + dz * size + dx;
                        const drop = (ground[i] - ground[next]) / (step * (dx && dz ? Math.SQRT2 : 1));
                        if (drop > slope[i]) { slope[i] = drop; receiver[i] = next; }
                    }
                }
            }
        }
        // 3 cm height buckets preserve downhill order without repeatedly sorting
        // the whole grid through JavaScript callbacks during theme preparation.
        histogram.fill(0);
        for (let i = 0; i < count; i++) {
            bins[i] = Math.max(0, Math.min(32767, Math.floor((ground[i] + 128) * 32)));
            histogram[bins[i]]++;
        }
        let at = 0;
        for (let b = 32767; b >= 0; b--) { offsets[b] = at; at += histogram[b]; }
        for (let i = 0; i < count; i++) order[offsets[bins[i]]++] = i;
        for (const i of order) if (receiver[i] >= 0) water[receiver[i]] += water[i];
        for (let i = 0; i < count; i++) ground[i] -= Math.min(2, 0.52 * Math.sqrt(water[i]) * slope[i]);
    }
    const values = new Float32Array(count);
    for (let i = 0; i < count; i++) values[i] = Math.max(-72, ground[i] - original[i]);
    const field = {
        values, size, minX, minZ, step,
    };
    if (erosionCache.size > 3) erosionCache.clear();
    erosionCache.set(seed, field);
    return field;
}

function erosionHeight(x, z, seed, cachedField = null) {
    if (x < -2200 || x > 2300 || z < -4300 || z > 200) return 0;
    const field = cachedField || erodedField(seed);
    const cx = (x - field.minX) / field.step;
    const cz = (z - field.minZ) / field.step;
    const ix = Math.min(field.size - 2, Math.floor(cx));
    const iz = Math.min(field.size - 2, Math.floor(cz));
    const tx = cx - ix;
    const tz = cz - iz;
    const i = iz * field.size + ix;
    const a = field.values[i] * (1 - tx) + field.values[i + 1] * tx;
    const b = field.values[i + field.size] * (1 - tx) + field.values[i + field.size + 1] * tx;
    const edge = smooth(0, 220, Math.min(x + 2200, 2300 - x, z + 4300, 200 - z));
    const wash = smooth(78, 135, Math.abs(x - 50 * Math.sin(-z * 0.003)));
    return (a * (1 - tz) + b * tz) * edge * wash * (1 - smooth(20, 65, z));
}

/** Unequal trunk valleys split upstream into tapering tributaries, then rejoin. */
function drainageIncision(along, across, ridge) {
    const cell = Math.floor(along / 105);
    const upstream = smooth(0.10, 0.82, ridge);
    let incision = 0;
    for (let i = cell - 1; i <= cell + 1; i++) {
        const random = hash(i + 39.7);
        const centre = (i + 0.18 + random * 0.63) * 105
            + Math.sin(across * 0.008 + i * 1.7) * 12
            + Math.sin(across * 0.023 + i) * 3;
        const width = 15 + random * 21 + (1 - upstream) * 10;
        const trunk = Math.max(0, 1 - Math.abs(along - centre) / width) ** 0.8;
        const spread = (17 + hash(i + 13.8) * 25) * upstream;
        const left = Math.max(0, 1 - Math.abs(along - centre + spread) / (9 + random * 8)) ** 1.1;
        const right = Math.max(0, 1 - Math.abs(along - centre - spread * 0.71) / (7 + random * 10)) ** 1.1;
        const branches = Math.max(left, right * 0.8) * upstream * (0.5 + random * 0.22);
        incision = Math.max(incision, trunk, branches);
    }
    return incision;
}

/** Long dip slope and short scarp. Its two derivatives differ by over 3:1. */
export function hogbackProfile(phase) {
    const p = fract(phase);
    return p < TERRAIN.crest ? p / TERRAIN.crest : (1 - p) / (1 - TERRAIN.crest);
}

/** Analytic height is also the exact shared ground sampler for all event ribbons. */
function baseTerrainHeight(x, z, seed = TERRAIN.seed) {
    const d = -z;
    const jitter = (seed - TERRAIN.seed) * 0.00137;
    const strike = x * 0.573576 - d * 0.819152;
    const acrossBase = x * 0.819152 + d * 0.573576;
    const across = acrossBase
        + 140 * (noise(strike / 620 + jitter) - 0.5)
        + 180 * (noise(acrossBase / 1350) - 0.5)
        + 42 * Math.sin(d * 0.0029 - x * 0.0006);
    const ridge = hogbackProfile((across + 280) / TERRAIN.spacing);
    const amp = 115 + 55 * smooth(300, 3200, d) + 70 * smooth(4000, 8500, d);
    const along = strike / (1 + Math.max(d - 1800, 0) / 5000)
        + 36 * (noise(across / 270 + jitter) - 0.5);
    const incision = drainageIncision(along, across, ridge);
    const saddle = 1 - 0.34 * smooth(0.53, 0.91, noise(strike / 330 + across / 1700));
    const shoulder = 0.78 + noise(strike / 940 + across / 2100) * 0.48;
    let height = 18 + ridge * amp * saddle * shoulder;
    const flank = 1 - 0.76 * smooth(0.73, 0.98, ridge);
    height -= (26 + 38 * smooth(1500, 4000, d)) * incision * (0.25 + 0.75 * ridge) * flank;
    // Broad planar spurs break each dip slope; fine relief follows those spurs.
    const spur = 1 - Math.abs(noise(strike / 92 + across / 370) * 2 - 1);
    height += (spur - 0.6) * 24 * ridge;
    const wash = Math.exp(-sq((x - 50 * Math.sin(d * 0.003)) / (95 + Math.max(d, 0) * 0.12)))
        * (1 - smooth(6200, 7600, d));
    height = height * (1 - wash * 0.88) + (6 + Math.max(d, 0) * 0.006) * wash;
    const left = clamp01((x + 535 + (d - 380) * 0.25 + 19 * Math.sin(d * 0.016)) / 330);
    const right = clamp01((x - 180 + (d - 730) * 0.48 + 28 * Math.sin(d * 0.009)) / 450);
    const leftRidge = left < 0.80 ? left / 0.80 : (1 - left) / 0.20;
    const rightRidge = right < 0.24 ? right / 0.24 : (1 - right) / 0.76;
    const leftFlank = 1 - 0.84 * smooth(0.67, 0.95, leftRidge);
    const rightFlank = 1 - 0.84 * smooth(0.67, 0.95, rightRidge);
    const crown = 0.86 + 0.24 * noise(d / 370 + 6);
    height += 66 * leftRidge * Math.exp(-(((d - 400) / 360) ** 4))
        * (1 - 0.49 * incision * leftFlank) * crown;
    height += 112 * rightRidge * Math.exp(-(((d - 660) / 470) ** 4))
        * (1 - 0.49 * incision * rightFlank) * crown;
    const phase = x * 0.00175 + (noise(x / 1400) - 0.5) * 1.4 + Math.sin(x * 0.0011) * 0.24;
    const flatiron = 1 - Math.abs(fract(phase / Math.PI) * 2 - 1);
    const crestDepth = 9350 + (noise(x / 1900 + 2) - 0.5) * 950;
    const face = d < crestDepth ? clamp01((d - 6500) / (crestDepth - 6500))
        : clamp01((12200 - d) / (12200 - crestDepth));
    height *= 1 - 0.68 * smooth(6800, 9000, d);
    height += face
        * (790 + 230 * flatiron * (0.65 + noise(x / 1600 + 3) * 0.65)
            + 140 * noise(x / 2400 + 8)
            - 115 * incision * (0.4 + 0.6 * flatiron));
    height += 45 * Math.exp(-sq((x + 140) / 120) - sq((d - 170) / 110));
    height += 35 * Math.exp(-sq((d + 55) / 110)) * (1 - Math.exp(-sq(x / 80)));
    // A close pale apron is visible below the portrait card when its lens looks
    // down enough to put the distant face above the card. It is below desktop FOV.
    const apron = Math.exp(-((x / 105) ** 4)) * smooth(30, 65, z) * (1 - smooth(155, 195, z));
    const apronHeight = Math.max(2, 20 - (z - 55) * 0.22 + x * 0.005);
    height = height * (1 - apron) + apronHeight * apron;
    return height;
}

/** Exact shared sampler includes the transferred near drainage displacement. */
export function terrainHeight(x, z, seed = TERRAIN.seed) {
    return baseTerrainHeight(x, z, seed) + erosionHeight(x, z, seed);
}

/** First visible surface on a desktop ray; a projected point alone can be behind a ridge. */
function visibleDesktopGround(u, v, heightAt) {
    const pitch = -7 * (Math.PI / 180);
    const tan = Math.tan(21 * (Math.PI / 180));
    const dx = (2 * u - 1) * tan * (16 / 9);
    const dy = (1 - 2 * v) * tan;
    const ry = Math.sin(pitch) + Math.cos(pitch) * dy;
    const rz = -Math.cos(pitch) + Math.sin(pitch) * dy;
    let previous = 0;
    for (let distance = 1; distance < 12000; distance++) {
        const x = dx * distance;
        const z = 200 + rz * distance;
        if (140 + ry * distance <= heightAt(x, z)) {
            let low = previous;
            let high = distance;
            for (let step = 0; step < 12; step++) {
                const mid = (low + high) * 0.5;
                if (140 + ry * mid <= heightAt(dx * mid, 200 + rz * mid)) high = mid;
                else low = mid;
            }
            const at = (low + high) * 0.5;
            const hitX = dx * at;
            const hitZ = 200 + rz * at;
            return [hitX, heightAt(hitX, hitZ) + 0.6, hitZ];
        }
        previous = distance;
    }
    return null;
}

function bakeVisibleDesktopChutes(heightAt) {
    const chutes = [];
    const tributaries = [0, -0.004, 0.004, -0.009, 0.009, -0.016, 0.016, -0.025, 0.025];
    const descend = (u, v) => {
        let point = visibleDesktopGround(u, v, heightAt);
        const points = [...point];
        // Search neighbouring visible tributaries, retaining only descending
        // ground. This prevents the old crest routes diving behind nearer land.
        for (let step = 1; step <= 28; step++) {
            for (const offset of tributaries) {
                const next = visibleDesktopGround(u + offset, v + step * 0.007, heightAt);
                if (next && next[1] < point[1] - 0.01
                    && Math.hypot(next[0] - point[0], next[2] - point[2]) < 50) {
                    points.push(...next);
                    point = next;
                    break;
                }
            }
        }
        return points;
    };
    for (let front = 0; front < 2; front++) {
        for (let lane = 0; lane < 20; lane++) {
            const u = front === 0 ? 0.09 + (lane % 5) * 0.0475 : 0.755 + (lane % 5) * 0.045;
            const v = 0.44 + Math.floor(lane / 5) * 0.055;
            let points = descend(u, v);
            // A head can land in a closed pocket. Move its release point down the
            // same exposed flank until it has enough connected terrain to flow.
            for (let attempt = 1; points.length < 36 && attempt <= 8; attempt++) {
                const candidate = descend(u, v + attempt * 0.023);
                if (candidate.length > points.length) points = candidate;
            }
            for (const offset of [-0.015, 0.015, -0.03, 0.03]) {
                if (points.length >= 36) break;
                const candidate = descend(u + offset, v + 0.09);
                if (candidate.length > points.length) points = candidate;
            }
            chutes.push({ id: chutes.length, front, points: new Float32Array(points) });
        }
    }
    return chutes;
}

function bakePortraitChutes(heightAt) {
    const yaw = PORTRAIT_RIG.yaw * (Math.PI / 180);
    const pitch = PORTRAIT_RIG.pitch * (Math.PI / 180);
    const tan = Math.tan(PORTRAIT_RIG.fov * (Math.PI / 360));
    const aspect = 390 / 844;
    const forward = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const right = [Math.cos(yaw), 0, Math.sin(yaw)];
    const up = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const project = (p) => {
        const q = [p[0], p[1] - 140, p[2] - 200];
        const d = dot(q, forward);
        return [(dot(q, right) / (d * tan * aspect)) * 0.5 + 0.5, 0.5 - (dot(q, up) / (d * tan)) * 0.5];
    };
    return Array.from({ length: 10 }, (_, column) => {
        const u = 0.05 + 0.1 * column;
        const dx = (u * 2 - 1) * tan * aspect;
        const dy = (1 - 0.89 * 2) * tan;
        const ray = forward.map((v, i) => v + right[i] * dx + up[i] * dy);
        let point = [0, heightAt(0, 0), 0];
        for (let distance = 30; distance < 1200; distance++) {
            const x = ray[0] * distance;
            const z = 200 + ray[2] * distance;
            const y = heightAt(x, z);
            if (140 + ray[1] * distance <= y) { point = [x, y, z]; break; }
        }
        const points = [...point];
        // A constrained D8 descent keeps the whole run below the portrait card.
        for (let i = 0; i < 50; i++) {
            const current = project(point);
            if (current[1] > 0.975) break;
            let score = -Infinity;
            let next = null;
            for (let reach = 1; reach <= 8 && !next; reach *= 2) {
                for (let a = 0; a < 16; a++) {
                    const angle = a * (Math.PI / 8);
                    const q = [point[0] + Math.cos(angle) * 3 * reach, 0, point[2] + Math.sin(angle) * 3 * reach];
                    q[1] = heightAt(q[0], q[2]);
                    const screen = project(q);
                    if (q[1] >= point[1] || screen[1] <= current[1]) continue;
                    const candidate = (screen[1] - current[1]) * 30 - Math.abs(screen[0] - u);
                    if (candidate > score) { score = candidate; next = q; }
                }
            }
            if (!next) break;
            point = next;
            points.push(...point);
        }
        for (let i = 1; i < points.length; i += 3) points[i] += 0.6;
        return { id: 40 + column, front: column < 5 ? 0 : 1, points: new Float32Array(points) };
    });
}

function bakeSites(heightAt) {
    const chutes = bakeVisibleDesktopChutes(heightAt);
    const visibleVent = (x, z) => {
        const y = heightAt(x, z);
        const distance = Math.hypot(x, z - 200);
        for (let step = 1; step <= distance; step++) {
            const t = step / distance;
            const sx = x * t;
            const sz = 200 + (z - 200) * t;
            if (140 + (y - 140) * t <= heightAt(sx, sz)) {
                const before = Math.max(0, step - 1) / distance;
                const hitX = x * before;
                const hitZ = 200 + (z - 200) * before;
                return { x: hitX, y: heightAt(hitX, hitZ), z: hitZ };
            }
        }
        return { x, y, z };
    };
    const channels = [];
    // Each downstream segment shares its exact endpoint with the following segment.
    for (let branch = 0; branch < 10; branch++) {
        const points = [];
        for (let j = 0; j < 65; j++) {
            const t = j / 64;
            const z = -7800 + t * 7860;
            const d = -z;
            const farDivide = smooth(0.10, 0.72, Math.abs(Math.sin(t * Math.PI * 4)));
            const nearDivide = smooth(0.10, 0.72, Math.abs(Math.sin((j - 56) * (Math.PI / 4))));
            const nearWeight = smooth(52, 56, j);
            const divide = farDivide * (1 - nearWeight) + nearDivide * nearWeight;
            const offset = (branch - 4.5) * 8 * (1 + d / 5000) * divide;
            const x = 50 * Math.sin(d * 0.003) + offset + Math.sin(t * 17 + branch) * 6 * divide;
            points.push(x, heightAt(x, z) + 1.7, z);
        }
        channels.push(new Float32Array(points));
    }
    const vents = Array.from({ length: 10 }, (_, i) => {
        let x = -155 - (i % 5) * 27;
        let z = -155 - Math.floor(i / 5) * 100 - Math.sin(i * 2.7) * 35;
        if (i === 0) { x = -95; z = -450; }
        if (i === 1) { x = 160; z = -300; }
        return i < 2 ? visibleVent(x, z) : { x, y: heightAt(x, z), z };
    });
    const desktopVents = [visibleVent(-175, -450), visibleVent(180, -240)];
    const ledges = [chutes[5], chutes[25]].map(({ points }) => ({
        x: points[0], y: points[1], z: points[2],
    }));
    return {
        chutes, channels, vents, desktopVents, ledges, portraitChutes: bakePortraitChutes(heightAt),
    };
}

/** Sun-facing occlusion; lower suns can only add shadow to the same horizon. */
export function horizonVisibility(horizon, sunElevation, penumbra = 0.025) {
    return smooth(horizon - Math.max(0.001, penumbra), horizon + Math.max(0.001, penumbra), sunElevation);
}

/**
 * A view fan puts geometry into the lens, logarithmically spaced from 22 m to 15 km.
 * Normal derivatives come from adjacent samples, avoiding five costly height calls
 * per vertex. All returned buffers are transferrable for the optional worker path.
 */
export function bakeTerrain({
    seed = TERRAIN.seed, vertices = 110000, bakeSize = 768, erosionField: preparedErosion = null,
} = {}) {
    const start = performance.now();
    const erosionField = preparedErosion || erodedField(seed);
    const cols = Math.max(80, Math.floor(Math.sqrt(vertices * 0.85)));
    const rows = Math.max(40, Math.floor(vertices / (cols + 1)) - 1);
    const count = (cols + 1) * (rows + 1);
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const surface = new Float32Array(count * 4);
    const horizon = new Float32Array(count);
    const indices = new Uint32Array(cols * rows * 6);
    const heightAt = (x, z) => baseTerrainHeight(x, z, seed) + erosionHeight(x, z, seed, erosionField);
    const angles = new Float32Array((cols + 1) * 2);
    for (let col = 0; col <= cols; col++) {
        const angle = (col / cols - 0.5) * 2.6;
        angles[col * 2] = Math.sin(angle);
        angles[col * 2 + 1] = Math.cos(angle);
    }
    for (let row = 0; row <= rows; row++) {
        const distance = 22 * (15000 / 22) ** (row / rows);
        for (let col = 0; col <= cols; col++) {
            const i = row * (cols + 1) + col;
            const x = angles[col * 2] * distance;
            const z = 200 - angles[col * 2 + 1] * distance;
            const h = heightAt(x, z);
            positions[i * 3] = x;
            positions[i * 3 + 1] = h;
            positions[i * 3 + 2] = z;
            uvs[i * 2] = (x + 6000) / 12000;
            uvs[i * 2 + 1] = (200 - z) / 11200;
            const tongueCentre = -75 + z * 0.75 + 5 * Math.sin(z * 0.04);
            const tongueWidth = 10 + 11 * smooth(-180, -45, z);
            const tongue = Math.exp(-(((x - tongueCentre) / tongueWidth) ** 4))
                * smooth(-210, -175, z) * (1 - smooth(-55, -20, z));
            const obsidian = Math.max(tongue, 0.35 * Math.exp(-sq((x + 200 + 35 * Math.sin(z * 0.02)) / 30)
                - sq((z + 260) / 175)));
            const sulfur = Math.exp(-sq((x + 190) / 100) - sq((z + 170) / 100));
            surface[i * 4 + 2] = obsidian;
            surface[i * 4 + 3] = sulfur;
        }
    }
    const radialLog = Math.log(15000 / 22);
    const fanHeight = (x, z) => {
        const c = (Math.atan2(x, 200 - z) / 2.6 + 0.5) * cols;
        const r = (Math.log(Math.hypot(x, 200 - z) / 22) / radialLog) * rows;
        if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
        const ci = Math.floor(c);
        const ri = Math.floor(r);
        const ct = c - ci;
        const rt = r - ri;
        const a = (ri * (cols + 1) + ci) * 3 + 1;
        const b = a + (cols + 1) * 3;
        const near = positions[a] * (1 - ct) + positions[a + 3] * ct;
        const far = positions[b] * (1 - ct) + positions[b + 3] * ct;
        return near * (1 - rt) + far * rt;
    };
    const horizonDistances = [6, 11, 21, 40, 76, 144, 273, 518, 984, 1869];
    for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
            const i = row * (cols + 1) + col;
            const l = (row * (cols + 1) + Math.max(0, col - 1)) * 3;
            const r = (row * (cols + 1) + Math.min(cols, col + 1)) * 3;
            const n = (Math.max(0, row - 1) * (cols + 1) + col) * 3;
            const f = (Math.min(rows, row + 1) * (cols + 1) + col) * 3;
            const ax = positions[r] - positions[l];
            const ay = positions[r + 1] - positions[l + 1];
            const az = positions[r + 2] - positions[l + 2];
            const bx = positions[f] - positions[n];
            const by = positions[f + 1] - positions[n + 1];
            const bz = positions[f + 2] - positions[n + 2];
            const nx = ay * bz - az * by;
            const ny = az * bx - ax * bz;
            const nz = ax * by - ay * bx;
            const magnitude = Math.hypot(nx, ny, nz) || 1;
            normals[i * 3] = nx / magnitude;
            normals[i * 3 + 1] = ny / magnitude;
            normals[i * 3 + 2] = nz / magnitude;
            const mean = (positions[l + 1] + positions[r + 1] + positions[n + 1] + positions[f + 1]) * 0.25;
            surface[i * 4] = clamp01((mean - positions[i * 3 + 1]) * 0.12 + 0.3);
            surface[i * 4 + 1] = smooth(0.82, 0.995, ny / magnitude);
            // World-space rays toward the nominal 115° behind-left sun sample the
            // existing view fan. No extra terrain evaluations or shader raymarch.
            let slope = 0;
            for (const distance of horizonDistances) {
                const sx = positions[i * 3] - 0.906308 * distance;
                const sz = positions[i * 3 + 2] + 0.422618 * distance;
                const sample = fanHeight(sx, sz);
                if (sample !== null) slope = Math.max(slope, (sample - positions[i * 3 + 1] - 0.35) / distance);
            }
            horizon[i] = Math.atan(slope);
        }
    }
    let offset = 0;
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const a = row * (cols + 1) + col;
            const b = a + 1;
            const c = a + cols + 1;
            const d = c + 1;
            indices[offset++] = a; indices[offset++] = b; indices[offset++] = c;
            indices[offset++] = b; indices[offset++] = d; indices[offset++] = c;
        }
    }
    const siteKey = `${seed}:${erosionField.size}`;
    if (!siteCache.has(siteKey)) {
        if (siteCache.size > 3) siteCache.clear();
        siteCache.set(siteKey, bakeSites(heightAt));
    }
    const sites = siteCache.get(siteKey);
    return {
        positions,
        normals,
        uvs,
        surface,
        horizon,
        indices,
        erosionField,
        heightAt,
        ...sites,
        diagnostics: {
            seed, vertices: count, triangles: indices.length / 3, bakeSize, bakeMs: performance.now() - start,
        },
    };
}

/**
 * Browser entry point: the measured cold bake belongs off the animation thread.
 * Every terminal path terminates its worker and removes its abort listener.
 * Node tests keep the synchronous deterministic API; a failed worker has a small
 * complete fallback so a player still gets land instead of a blank loading surface.
 */
export async function bakeTerrainAsync(options = {}, { signal } = {}) {
    if (signal?.aborted) throw new DOMException('Terrain preparation cancelled', 'AbortError');
    if (typeof Worker === 'undefined') return bakeTerrain(options);
    let worker;
    let timeout;
    let abort;
    try {
        const result = await new Promise((resolve, reject) => {
            worker = new Worker(new URL('./painted-ages-terrain-worker.js', import.meta.url), { type: 'module' });
            abort = () => reject(new DOMException('Terrain preparation cancelled', 'AbortError'));
            signal?.addEventListener('abort', abort, { once: true });
            worker.onmessage = ({ data }) => {
                if (data.error) reject(new Error(data.error));
                else resolve(data);
            };
            worker.onerror = (event) => {
                event.preventDefault();
                reject(new Error(event.message || 'Terrain worker failed'));
            };
            timeout = setTimeout(() => reject(new Error('Terrain preparation timed out')), 10000);
            worker.postMessage(options);
        });
        const { seed } = result.diagnostics;
        if (result.erosionField) {
            if (erosionCache.size > 3 && !erosionCache.has(seed)) erosionCache.clear();
            erosionCache.set(seed, result.erosionField);
        }
        // Keep a direct reference: sampling remains cheap even when another theme
        // preparation evicts this seed from the bounded development cache.
        result.heightAt = (x, z) => baseTerrainHeight(x, z, seed) + erosionHeight(x, z, seed, result.erosionField);
        result.diagnostics.worker = true;
        return result;
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        // A broken worker must not move the erosion simulation onto the animation
        // thread. Keep a complete low-resolution analytical landscape instead.
        const erosionField = {
            values: new Float32Array(4), size: 2, minX: -2200, minZ: -4300, step: 4500,
        };
        const fallback = bakeTerrain({
            ...options, vertices: 18000, bakeSize: 128, erosionField,
        });
        fallback.diagnostics.workerFallback = error.message;
        return fallback;
    } finally {
        clearTimeout(timeout);
        if (abort) signal?.removeEventListener('abort', abort);
        if (worker) {
            worker.onmessage = null;
            worker.onerror = null;
            worker.terminate();
        }
    }
}
