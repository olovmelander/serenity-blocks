/**
 * Wolfhour — the landscape's bakes (CPU only, three-free).
 *
 * The four ranges (sculpted, their normals smoothed, moonlight and snow baked into their colours)
 * and the granite grain are pure functions of the quality's scale and the seed: 0.15-0.2 s of main
 * thread on a first visit (play-feel probe 2026-10-16), kept in the shared bake cache (read-only).
 * A first visit bakes them in a module Worker (wolfhour-landscape-bake.worker.js, started by
 * wolfhour-landscape-bakes.js) while the renderer comes up; wolfhour-landscape.js makes the meshes
 * and the texture from them.
 */
import { bakeOnce } from '../shared/bake-cache.js';

export const HALF_WIDTH = 2400;
/** The moon's direction: three's Vector3(-0.52, 0.66, 0.54).normalize(), the same operations. */
export const MOON_LIGHT = (() => {
    const [x, y, z] = [-0.52, 0.66, 0.54];
    const s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    return Object.freeze({ x: x * s, y: y * s, z: z * s });
})();
export const GRANITE_SIZE = 512;
/** The seed the theme's landscape is built with. */
export const LANDSCAPE_SEED = 73013;

/** How finely each quality samples the ranges. */
export function landscapeScale(quality) {
    return ({
        Minimal: 0.32, Low: 0.56, Medium: 0.76, High: 1, Ultra: 1, Extreme: 1,
    })[quality] ?? 1;
}

// Crest points are deliberately asymmetric: shoulders, notches and subsidiary summits
// connect into a continuous range. Their slopes continue down into branching rock spurs.
export const RANGES = Object.freeze([
    {
        name: 'distant-cirque',
        z: -1920,
        depth: 300,
        drop: 880,
        columns: 256,
        rows: 32,
        relief: 48,
        seed: 317,
        snowLine: -130,
        air: [0.018, 0.019, 0.022],
        haze: 0.32,
        rock: [0.022, 0.023, 0.027],
        snow: [0.22, 0.225, 0.24],
        crest: [
            [-2400, 110], [-1850, 160], [-1460, 50], [-1120, 95],
            [-970, 150], [-820, 190], [-720, 254], [-615, 213], [-510, 90],
            [-375, 30], [-240, -69], [-80, -99], [110, -70], [245, 42],
            [385, 180], [455, 240], [575, 270], [665, 190], [790, 142],
            [1030, 176], [1260, 90], [1590, 198], [1860, 90], [2400, 176],
        ],
    },
    {
        name: 'moonlit-massif',
        z: -1450,
        depth: 540,
        drop: 1280,
        columns: 416,
        rows: 48,
        relief: 112,
        seed: 791,
        snowLine: -300,
        air: [0.006, 0.0065, 0.008],
        haze: 0.06,
        rock: [0.045, 0.046, 0.050],
        snow: [0.39, 0.40, 0.425],
        hero: true,
        crest: [
            [-2400, 125], [-2050, 185], [-1640, 90], [-1330, 130],
            [-1120, 247], [-990, 268], [-930, 281], [-875, 275],
            [-819, 292], [-766, 284], [-710, 299], [-666, 289],
            [-618, 272], [-581, 247], [-548, 199], [-508, 169],
            [-467, 136], [-423, 61], [-387, 28],
            [-347, -18], [-286, -82], [-214, -130], [-125, -154],
            [-33, -177], [77, -151], [180, -110], [262, -24],
            [332, 46], [388, 125], [449, 190], [493, 247],
            [535, 271], [582, 284], [621, 277], [658, 305],
            [699, 297], [744, 262], [793, 240], [849, 213], [946, 182],
            [1120, 132], [1330, 48], [1600, 142], [1900, 214], [2400, 110],
        ],
    },
    {
        name: 'shadowed-granite-spurs',
        z: -965,
        depth: 320,
        drop: 850,
        columns: 384,
        rows: 48,
        relief: 92,
        seed: 1201,
        snowLine: -225,
        air: [0.0045, 0.005, 0.0065],
        haze: 0.10,
        rock: [0.019, 0.020, 0.023],
        snow: [0.13, 0.137, 0.15],
        crest: [
            [-2400, -200], [-1820, -121], [-1430, -227], [-1110, -148],
            [-919, -247], [-788, -206], [-705, -234], [-596, -261],
            [-473, -287], [-330, -315], [-208, -245], [-135, -198],
            [-54, -159], [12, -190], [65, -167], [151, -212],
            [245, -272], [355, -303], [448, -267], [531, -223],
            [620, -191], [724, -164], [830, -218], [960, -264],
            [1108, -225], [1390, -174], [1710, -229], [2400, -185],
        ],
    },
    {
        name: 'foreground-spurs',
        z: -540,
        depth: 250,
        drop: 750,
        columns: 240,
        rows: 24,
        relief: 58,
        seed: 1951,
        snowLine: -270,
        air: [0.0028, 0.003, 0.0035],
        haze: 0.06,
        rock: [0.016, 0.0165, 0.018],
        snow: [0.042, 0.044, 0.047],
        crest: [
            [-2400, -365], [-1680, -344], [-1130, -369], [-944, -382],
            [-790, -404], [-671, -380], [-563, -355], [-385, -316],
            [-273, -297], [-173, -268], [-91, -215], [-28, -187],
            [19, -208], [73, -227], [153, -275], [221, -303], [386, -360],
            [541, -386], [682, -407], [804, -381], [970, -353],
            [1180, -392], [1540, -330], [1860, -378], [2400, -351],
        ],
    },
]);

function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}

function smoothstep(low, high, value) {
    const t = clamp01((value - low) / (high - low));
    return t * t * (3 - 2 * t);
}

function hash(x, y, seed) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 69069);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, seed);
    const b = hash(ix + 1, iy, seed);
    const c = hash(ix, iy + 1, seed);
    const d = hash(ix + 1, iy + 1, seed);
    return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/** Periodic granite grain (RGBA8, size²): one filtered texture read replaces per-fragment FBM. */
export function computeGranite(seed, size = GRANITE_SIZE) {
    const pixels = new Uint8Array(size * size * 4);
    const periodic = (x, y, period) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const a = hash(ix & (period - 1), iy & (period - 1), seed);
        const b = hash((ix + 1) & (period - 1), iy & (period - 1), seed);
        const c = hash(ix & (period - 1), (iy + 1) & (period - 1), seed);
        const d = hash((ix + 1) & (period - 1), (iy + 1) & (period - 1), seed);
        return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    };
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // Granite has dense mineral-scale contrast, not a cloudy low-frequency
            // colour wash. Integer shears keep every octave exactly periodic while
            // breaking the horizontal/vertical lattice into diagonal rock fragments.
            const coarse = periodic(((x + y) / size) * 32, ((y - x) / size) * 32, 32);
            const medium = periodic(((x + y) / size) * 64, (y / size) * 64, 64);
            const fine = periodic((x / size) * 128, ((y - x) / size) * 128, 128);
            const crystal = periodic(((x + y) / size) * 256, (y / size) * 256, 256);
            const sum = coarse * 0.12 + medium * 0.22 + fine * 0.32 + crystal * 0.34;
            const i = (y * size + x) * 4;
            pixels[i] = Math.round(clamp01((sum - 0.5) * 2.8 + 0.5) * 255);
            pixels[i + 1] = Math.round(hash(x, y, seed + 951) * 255);
            // Filled angular mineral inclusions replace the conspicuous contour web.
            pixels[i + 2] = Math.round(smoothstep(0.49, 0.72, medium * 0.6 + fine * 0.4) * 255);
            pixels[i + 3] = 255;
        }
    }
    return pixels;
}

function ridges(x, y, seed) {
    let sampleX = x;
    let sampleY = y;
    let result = 0;
    let weight = 0.57;
    let previous = 1;
    for (let octave = 0; octave < 4; octave++) {
        const ridge = 1 - Math.abs(noise(sampleX, sampleY, seed + octave * 83) * 2 - 1);
        result += ridge * ridge * weight * previous;
        previous = ridge;
        sampleX = sampleX * 2.07 + 8.1;
        sampleY = sampleY * 2.03 + 5.3;
        weight *= 0.49;
    }
    return result;
}

function crestHeight(points, x) {
    let i = 1;
    while (i < points.length - 1 && x > points[i][0]) i++;
    const a = points[i - 1];
    const b = points[i];
    const t = clamp01((x - a[0]) / (b[0] - a[0]));
    // Mostly linear arêtes, with a small shoulder ease so the skyline is not a saw wave.
    const shaped = t * 0.78 + t * t * (3 - 2 * t) * 0.22;
    return a[1] + (b[1] - a[1]) * shaped;
}

/** Broad distorted granite masses break radial symmetry into uneven fractured walls. */
function graniteRelief(x, y, seed) {
    const warpX = x + (noise(x * 0.005, y * 0.004, seed + 37) - 0.5) * 95;
    const warpY = y + (noise(x * 0.004, y * 0.006, seed + 193) - 0.5) * 82;
    const broad = ridges(warpX * 0.011 + warpY * 0.009, warpY * 0.015 - warpX * 0.006, seed);
    const fractured = ridges(warpX * 0.021 - warpY * 0.018, warpY * 0.031 + warpX * 0.014, seed + 449);
    // Distorted diagonal planes create long broken ledges, not vertical repeated fans.
    const ledges = Math.abs(noise(
        warpX * 0.014 + warpY * 0.009,
        warpY * 0.024 - warpX * 0.005,
        seed + 683,
    ) * 2 - 1);
    return broad * 0.88 + fractured * 0.43 + (1 - ledges) * 0.24;
}

/**
 * three's BufferGeometry.computeVertexNormals for an indexed mesh (r186), operation for operation:
 * each face's (C − B) × (A − B) added to its three corners (each corner read before any is
 * written), then every normal scaled by 1 / its length, in float32 throughout.
 */
export function vertexNormals(positions, indices) {
    const n = new Float32Array(positions.length);
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3;
        const b = indices[i + 1] * 3;
        const c = indices[i + 2] * 3;
        const cbx = positions[c] - positions[b];
        const cby = positions[c + 1] - positions[b + 1];
        const cbz = positions[c + 2] - positions[b + 2];
        const abx = positions[a] - positions[b];
        const aby = positions[a + 1] - positions[b + 1];
        const abz = positions[a + 2] - positions[b + 2];
        const x = cby * abz - cbz * aby;
        const y = cbz * abx - cbx * abz;
        const z = cbx * aby - cby * abx;
        const ax = n[a] + x;
        const ay = n[a + 1] + y;
        const az = n[a + 2] + z;
        const bx = n[b] + x;
        const by = n[b + 1] + y;
        const bz = n[b + 2] + z;
        const cx = n[c] + x;
        const cy = n[c + 1] + y;
        const cz = n[c + 2] + z;
        n[a] = ax;
        n[a + 1] = ay;
        n[a + 2] = az;
        n[b] = bx;
        n[b + 1] = by;
        n[b + 2] = bz;
        n[c] = cx;
        n[c + 1] = cy;
        n[c + 2] = cz;
    }
    for (let i = 0; i < n.length; i += 3) {
        const x = n[i];
        const y = n[i + 1];
        const z = n[i + 2];
        const s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
        n[i] = x * s;
        n[i + 1] = y * s;
        n[i + 2] = z * s;
    }
    return n;
}

/**
 * One range's mesh as arrays: positions, normals (smoothed), baked colours, the moon response,
 * the triangle indices, and the crest's column count (row 0 is the crest).
 */
export function computeRange(rangeIndex, qualityScale, seed) {
    const config = RANGES[rangeIndex];
    const nx = Math.max(96, Math.round(config.columns * qualityScale));
    const ny = Math.max(12, Math.round(config.rows * qualityScale));
    const width = nx + 1;
    const count = width * (ny + 1);
    const positions = new Float32Array(count * 3);
    const colours = new Float32Array(count * 3);
    const eventLight = new Float32Array(count);
    const drainage = new Float32Array(count);
    const indices = new Uint32Array(nx * ny * 6);
    const terrainSeed = seed + config.seed;
    const crestCeiling = Math.max(...config.crest.map((point) => point[1]));

    for (let row = 0; row <= ny; row++) {
        const t = row / ny;
        // Most vertices belong to the visible upper 450 units. The old even spacing
        // wasted over half the mesh below the viewport and blurred all the snow detail.
        const down = t ** 1.60;
        const reliefMask = smoothstep(0, 0.07, t) * (1 - smoothstep(0.70, 1.0, t));
        for (let col = 0; col <= nx; col++) {
            const index = row * width + col;
            const horizontal = (col / nx) * 2 - 1;
            const x = (horizontal * 0.42 + horizontal ** 3 * 0.58) * HALF_WIDTH;
            // The flow stretches toward the valley floor; domain warps merge small gullies
            // into broad buttresses instead of applying isotropic noise to a cone.
            const drift = (noise(x * 0.0023, 3.7, terrainSeed) - 0.5) * 72;
            const flowX = x + drift * down;
            const crest = crestHeight(config.crest, flowX);
            const baseY = crest - config.drop * down;
            const ridge = graniteRelief(flowX, baseY, terrainSeed);
            const branch = ridges(flowX * 0.042, baseY * 0.049, terrainSeed + 113);
            const serration = (noise(x * 0.082, 2.3, terrainSeed) - 0.5) * 15 * (1 - t);
            const erosion = (branch - 0.36) * config.relief * 0.08 * reliefMask;
            positions[index * 3] = x;
            const sculptedY = baseY + erosion + serration;
            // Preserve a front-facing height field even at the densely sampled crest:
            // fine fracture offsets must never fold a row back above its predecessor.
            positions[index * 3 + 1] = row > 0
                ? Math.min(sculptedY, positions[(index - width) * 3 + 1] - 0.35)
                : sculptedY;
            // Depth follows absolute elevation rather than the local crest profile.
            // Extruding each silhouette downhill reproduced its tiny notches as long
            // vertical folds even after all the radial noise had been turned down.
            positions[index * 3 + 2] = config.z + ((crestCeiling - baseY) / config.drop) * config.depth
                + (ridge - 0.42) * config.relief * reliefMask
                + (branch - 0.32) * config.relief * 0.10 * reliefMask;
            drainage[index] = ridge;
        }
    }

    let cursor = 0;
    for (let row = 0; row < ny; row++) {
        for (let col = 0; col < nx; col++) {
            const a = row * width + col;
            const b = a + 1;
            const c = a + width;
            const d = c + 1;
            // Alternating diagonals keep long, regular triangle strips out of the slopes.
            if ((row + col) % 2) {
                indices.set([a, c, b, b, c, d], cursor);
            } else {
                indices.set([a, d, b, a, c, d], cursor);
            }
            cursor += 6;
        }
    }

    const normals = vertexNormals(positions, indices);
    // Snow follows broad sculpted surfaces. Smooth their baked lighting over a small
    // neighbourhood; the single granite texture supplies the fine rock detail instead
    // of turning every triangulation change into a polished silver triangle.
    let normalValues = new Float32Array(normals);
    for (let pass = 0; pass < 1; pass++) {
        const filtered = new Float32Array(normalValues.length);
        for (let row = 0; row <= ny; row++) {
            for (let col = 0; col <= nx; col++) {
                let normalX = 0;
                let normalY = 0;
                let normalZ = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const r = Math.max(0, Math.min(ny, row + dy));
                        const c = Math.max(0, Math.min(nx, col + dx));
                        const weight = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
                        const source = (r * width + c) * 3;
                        normalX += normalValues[source] * weight;
                        normalY += normalValues[source + 1] * weight;
                        normalZ += normalValues[source + 2] * weight;
                    }
                }
                const invLength = 1 / Math.max(0.0001, Math.hypot(normalX, normalY, normalZ));
                const target = (row * width + col) * 3;
                filtered[target] = normalX * invLength;
                filtered[target + 1] = normalY * invLength;
                filtered[target + 2] = normalZ * invLength;
            }
        }
        normalValues = filtered;
    }
    normals.set(normalValues);

    for (let index = 0; index < count; index++) {
        const x = positions[index * 3];
        const y = positions[index * 3 + 1];
        const normalY = normals[index * 3 + 1];
        const facing = Math.max(0, normals[index * 3] * MOON_LIGHT.x
            + normalY * MOON_LIGHT.y + normals[index * 3 + 2] * MOON_LIGHT.z);
        const strata = ridges(x * 0.071 + y * 0.038, y * 0.083, terrainSeed + 337);
        const altitude = smoothstep(
            config.snowLine - 85,
            config.snowLine + 140,
            y + (strata - 0.4) * 145,
        );
        const shelf = smoothstep(-0.08, 0.53, normalY);
        const crevice = smoothstep(0.12, 0.50, drainage[index]);
        const snowPatch = smoothstep(0.16, 0.60, strata + crevice * 0.14);
        const gully = ridges(x * 0.014 + y * 0.006, y * 0.022 - x * 0.003, terrainSeed + 1019);
        const shelteredSnow = smoothstep(0.27, 0.58, gully) * smoothstep(-0.2, 0.5, normalY);
        // Cover composition: the left wall catches silver light. The right wall's
        // inward face falls dark, while snow lights its exposed outer shoulder.
        const sideSnow = config.hero
            ? 0.16 + (1 - smoothstep(-70, 100, x)) * 0.84 + smoothstep(560, 780, x) * 0.75
            : 1;
        const sideLight = config.hero && x > 0 ? 0.20 + smoothstep(510, 790, x) * 0.80 : 1;
        const snow = clamp01(altitude * (shelf * (0.42 + snowPatch * 0.39) + shelteredSnow * 0.20) * sideSnow);
        const rockLight = (0.15 + facing ** 1.25 * 1.19) * (0.60 + crevice * 0.40) * sideLight;
        const snowLight = (0.42 + facing * 0.58) * sideLight;
        const surfaceDetail = 0.70 + smoothstep(0.20, 0.62, strata) * 0.44;
        // Low valley airlight separates ranges but leaves the nearest spurs nearly black.
        const valleyHaze = config.haze + smoothstep(-230, -620, y) * 0.035;
        for (let channel = 0; channel < 3; channel++) {
            const rock = config.rock[channel] * rockLight * surfaceDetail;
            const frost = config.snow[channel] * snowLight;
            const surface = rock + (frost - rock) * snow;
            colours[index * 3 + channel] = surface + (config.air[channel] - surface) * valleyHaze;
        }
        eventLight[index] = altitude * (0.18 + snow * 0.82) * (0.15 + facing * 0.85)
            * (1 - config.haze * 0.5);
    }

    return {
        positions, normals, colours, eventLight, indices, crestColumns: width,
    };
}

/** The bake cache's keys. */
export const rangeKey = (index, scale, seed) => `wolfhour:range:${index}:${scale}:${seed}`;
export const graniteKey = (seed, size) => `wolfhour:granite:${seed}:${size}`;

/** One range's arrays, baked once per scale and seed. */
export function bakeRange(index, scale, seed) {
    return bakeOnce(rangeKey(index, scale, seed), () => computeRange(index, scale, seed));
}

/** The granite grain's pixels, baked once per seed. */
export function bakeGranite(seed, size = GRANITE_SIZE) {
    return bakeOnce(graniteKey(seed, size), () => computeGranite(seed, size));
}
