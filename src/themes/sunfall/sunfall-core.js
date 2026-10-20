/**
 * Sunfall Theme — Pure Core Constants, Stations, Weathers & Optical Helpers
 *
 * Hang Sơn Đoòng doline world math:
 * - Five solar-shaft stations and four subterranean micro-weathers
 * - Shared analytical oculus projection `sunlitAt()` matching the TSL node
 * - CPU mirror of `dlBow` and `solveBowSun` for the 4-line Cataract double rainbow
 * - Botanical delayed-greening curves (`greeningTau`, `leafTintAtAge`)
 * - Deterministic PRNG (`mulberry32`), code bit-packing (`packCodes` / `unpackCodes`),
 *   and chamber geometry planner (`planDoline`).
 */

export const SUNFALL_SEED = 0x53554e46; // 'SUNF'
export const SUNFALL_CLEAR = 0x5d8087; // Chamber Haze — sunlit mist fill

export const SUNFALL_PARTS = Object.freeze([
    'sky',
    'cave',
    'jungle',
    'beam',
    'mist',
    'water',
    'roots',
    'birds',
    'gours',
]);

export const OCULUS_CENTER = Object.freeze([26, 88, -118]);
export const OCULUS_RX = 26;
export const OCULUS_RZ = 19;
export const POOL_CENTER = Object.freeze([14, -22, -96]);
export const FAR_DOLINE_CENTER = Object.freeze([-32, 34, -340]);

export const PIECE_CODES = Object.freeze(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);

// Linear sRGB piece swatches matching SUNFALL_TETROMINOS.colors
export const PIECE_SWATCH_RGB = Object.freeze({
    I: Object.freeze([0.807, 0.040, 0.114]), // #E8385E Flush Crimson
    O: Object.freeze([0.063, 0.220, 0.916]), // #4781F6 Peacock Fern
    T: Object.freeze([0.258, 0.578, 0.114]), // #8BC85F New-Growth Chartreuse
    S: Object.freeze([1.000, 0.539, 0.048]), // #FFC23E Sunfall Gold
    Z: Object.freeze([0.059, 0.503, 0.279]), // #45BC90 Canopy Jade
    J: Object.freeze([0.730, 0.144, 0.020]), // #DE6A27 Bronze Flush
    L: Object.freeze([0.533, 0.138, 0.552]), // #C168C4 Doline Orchid
});

export const MATURE_LEAF_RGB = Object.freeze([0.072, 0.295, 0.088]);
export const BACKLIT_LEAF_RGB = Object.freeze([0.465, 0.770, 0.074]);

function norm3([x, y, z]) {
    const len = Math.hypot(x, y, z) || 1;
    return Object.freeze([x / len, y / len, z / len]);
}

/**
 * Five stations along the sun's daily crossing of the doline oculus.
 * `sunDir` points upward from the jungle pool `(14, -22, -96)` through the
 * oculus `(26, 88, -118)` toward the sun so `sunlitAt` projects `(14, -22, -96)`
 * straight onto the oculus centre and `dot(N, sunDir)` lights upward faces.
 */
export const SUNFALL_STATIONS = Object.freeze([
    Object.freeze({
        index: 0,
        id: 'first-shaft',
        name: 'First Shaft',
        sunDir: norm3([0.16, 0.95, -0.22]),
        beamWarmth: 0.58,
        cloudFloor: 0.72,
        skyZenith: Object.freeze([0.92, 0.98, 1.00]),
        skyRim: Object.freeze([1.00, 0.89, 0.68]),
        beamCore: Object.freeze([1.00, 0.95, 0.80]),
        beamScatter: Object.freeze([0.74, 0.89, 0.80]),
        poolSun: Object.freeze([0.71, 0.89, 0.30]),
        bounceVault: Object.freeze([0.29, 0.42, 0.31]),
        caveShadow: Object.freeze([0.13, 0.19, 0.22]),
        mistTint: Object.freeze([0.45, 0.63, 0.62]),
        gourBlue: Object.freeze([0.16, 0.47, 0.82]),
    }),
    Object.freeze({
        index: 1,
        id: 'high-sunfall',
        name: 'High Sunfall',
        sunDir: norm3([0.11, 0.97, -0.19]),
        beamWarmth: 0.42,
        cloudFloor: 0.46,
        skyZenith: Object.freeze([0.94, 0.99, 1.00]),
        skyRim: Object.freeze([1.00, 0.96, 0.84]),
        beamCore: Object.freeze([1.00, 0.98, 0.90]),
        beamScatter: Object.freeze([0.76, 0.93, 0.85]),
        poolSun: Object.freeze([0.75, 0.92, 0.32]),
        bounceVault: Object.freeze([0.33, 0.47, 0.34]),
        caveShadow: Object.freeze([0.14, 0.21, 0.24]),
        mistTint: Object.freeze([0.47, 0.67, 0.66]),
        gourBlue: Object.freeze([0.18, 0.52, 0.88]),
    }),
    Object.freeze({
        index: 2,
        id: 'cloud-breath',
        name: 'Cloud Breath',
        sunDir: norm3([0.09, 0.96, -0.21]),
        beamWarmth: 0.50,
        cloudFloor: 0.88,
        skyZenith: Object.freeze([0.90, 0.97, 0.99]),
        skyRim: Object.freeze([0.98, 0.93, 0.82]),
        beamCore: Object.freeze([1.00, 0.96, 0.86]),
        beamScatter: Object.freeze([0.72, 0.90, 0.86]),
        poolSun: Object.freeze([0.68, 0.88, 0.33]),
        bounceVault: Object.freeze([0.30, 0.45, 0.35]),
        caveShadow: Object.freeze([0.14, 0.21, 0.25]),
        mistTint: Object.freeze([0.50, 0.69, 0.69]),
        gourBlue: Object.freeze([0.17, 0.50, 0.86]),
    }),
    Object.freeze({
        index: 3,
        id: 'rain-thread',
        name: 'Rain Thread',
        sunDir: norm3([0.13, 0.96, -0.20]),
        beamWarmth: 0.46,
        cloudFloor: 0.64,
        skyZenith: Object.freeze([0.88, 0.96, 1.00]),
        skyRim: Object.freeze([0.96, 0.94, 0.86]),
        beamCore: Object.freeze([0.98, 0.97, 0.90]),
        beamScatter: Object.freeze([0.70, 0.91, 0.88]),
        poolSun: Object.freeze([0.69, 0.90, 0.36]),
        bounceVault: Object.freeze([0.28, 0.44, 0.36]),
        caveShadow: Object.freeze([0.13, 0.20, 0.24]),
        mistTint: Object.freeze([0.46, 0.66, 0.68]),
        gourBlue: Object.freeze([0.20, 0.55, 0.92]),
    }),
    Object.freeze({
        index: 4,
        id: 'amber-slant',
        name: 'Amber Slant',
        sunDir: norm3([0.19, 0.94, -0.23]),
        beamWarmth: 0.78,
        cloudFloor: 0.56,
        skyZenith: Object.freeze([0.95, 0.96, 0.94]),
        skyRim: Object.freeze([1.00, 0.83, 0.56]),
        beamCore: Object.freeze([1.00, 0.91, 0.72]),
        beamScatter: Object.freeze([0.84, 0.86, 0.72]),
        poolSun: Object.freeze([0.78, 0.87, 0.28]),
        bounceVault: Object.freeze([0.34, 0.43, 0.29]),
        caveShadow: Object.freeze([0.15, 0.19, 0.22]),
        mistTint: Object.freeze([0.49, 0.62, 0.58]),
        gourBlue: Object.freeze([0.16, 0.46, 0.82]),
    }),
]);

export const SUNFALL_WEATHERS = Object.freeze([
    Object.freeze({
        id: 'clear',
        name: 'Clear Beam',
        dripScale: 0.55,
        mistScale: 0.75,
        cloudOpacity: 0.45,
        sprayRate: 0.35,
    }),
    Object.freeze({
        id: 'mist',
        name: 'Chamber Mist',
        dripScale: 0.75,
        mistScale: 1.15,
        cloudOpacity: 0.75,
        sprayRate: 0.55,
    }),
    Object.freeze({
        id: 'shower',
        name: 'Rim Shower',
        dripScale: 1.45,
        mistScale: 1.05,
        cloudOpacity: 0.65,
        sprayRate: 1.00,
    }),
    Object.freeze({
        id: 'cloud',
        name: 'Cave Cloud',
        dripScale: 0.65,
        mistScale: 1.35,
        cloudOpacity: 1.00,
        sprayRate: 0.45,
    }),
]);

export const SUNFALL_TIMINGS = Object.freeze({
    stationSeconds: 110,
    levelAdvance: 1.0,
    levelPanSeconds: 6.5,
    weatherHoldMin: 48,
    weatherHoldMax: 88,
    weatherCrossfade: 9.0,
    lockFlushSeconds: 3.2,
    hardDropSnapSeconds: 1.8,
    showerSeconds: 2.8,
    cataractSeconds: 5.2,
    cataractRainbowDelay: 0.35,
    cataractRainbowFade: 3.8,
    comboExhaleSeconds: 3.4,
    tSpinTurnDeg: 15,
    tSpinFlashSeconds: 2.2,
    zenithSeconds: 4.6,
    gameOverSeconds: 2.6,
    morningSeconds: 1.8,
    newGrowthHoldSeconds: 38,
    greeningTauMean: 19,
});

export function clamp(v, min = 0, max = 1) {
    return Math.max(min, Math.min(max, v));
}

export function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function lerp3(a, b, t) {
    return [
        lerp(a[0], b[0], t),
        lerp(a[1], b[1], t),
        lerp(a[2], b[2], t),
    ];
}

export function smooth(edge0, edge1, x) {
    if (edge0 === edge1) return x < edge0 ? 0 : 1;
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

export function approach(current, target, tau, dt) {
    if (!(dt > 0) || !(tau > 0)) return target;
    const alpha = 1 - Math.exp(-dt / tau);
    return current + (target - current) * alpha;
}

/**
 * Deterministic 32-bit PRNG (Mulberry32).
 * @param {number} [seed]
 */
export function mulberry32(seed = SUNFALL_SEED) {
    let a = (seed >>> 0) || SUNFALL_SEED;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Map a 1-based level onto a station index in `[0, SUNFALL_STATIONS.length - 1]`.
 * @param {number} [level]
 */
export function stationIndexForLevel(level = 1) {
    const n = SUNFALL_STATIONS.length;
    const lv = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
    return (((lv - 1) % n) + n) % n;
}

/**
 * Smoothly sample the cyclic 5-station ring at any fractional station coordinate.
 * @param {number} [stationFloat]
 */
export function sampleStation(stationFloat = 0) {
    const n = SUNFALL_STATIONS.length;
    const f = Number.isFinite(stationFloat) ? stationFloat : 0;
    const wrapped = ((f % n) + n) % n;
    const idx = Math.floor(wrapped);
    const nextIdx = (idx + 1) % n;
    const rawT = wrapped - idx;
    const mix = rawT * rawT * (3 - 2 * rawT);

    const a = SUNFALL_STATIONS[idx];
    const b = SUNFALL_STATIONS[nextIdx];
    const rawSun = lerp3(a.sunDir, b.sunDir, mix);
    const sunLen = Math.hypot(rawSun[0], rawSun[1], rawSun[2]) || 1;

    return {
        stationFloat: wrapped,
        index: idx,
        nextIndex: nextIdx,
        mix,
        id: rawT < 0.5 ? a.id : b.id,
        name: rawT < 0.5 ? a.name : b.name,
        sunDir: [rawSun[0] / sunLen, rawSun[1] / sunLen, rawSun[2] / sunLen],
        beamWarmth: lerp(a.beamWarmth, b.beamWarmth, mix),
        cloudFloor: lerp(a.cloudFloor, b.cloudFloor, mix),
        skyZenith: lerp3(a.skyZenith, b.skyZenith, mix),
        skyRim: lerp3(a.skyRim, b.skyRim, mix),
        beamCore: lerp3(a.beamCore, b.beamCore, mix),
        beamScatter: lerp3(a.beamScatter, b.beamScatter, mix),
        poolSun: lerp3(a.poolSun, b.poolSun, mix),
        bounceVault: lerp3(a.bounceVault, b.bounceVault, mix),
        caveShadow: lerp3(a.caveShadow, b.caveShadow, mix),
        mistTint: lerp3(a.mistTint, b.mistTint, mix),
        gourBlue: lerp3(a.gourBlue, b.gourBlue, mix),
    };
}

/**
 * Sample or blend subterranean weather states by ID or index.
 * @param {string|number} [weather]
 * @param {string|number} [nextWeather]
 * @param {number} [mix]
 */
export function sampleWeather(weather = 'clear', nextWeather = null, mix = 0) {
    const find = (w) => {
        if (typeof w === 'number' && Number.isFinite(w)) {
            const n = SUNFALL_WEATHERS.length;
            return SUNFALL_WEATHERS[((Math.floor(w) % n) + n) % n];
        }
        if (typeof w === 'string') {
            const lower = w.trim().toLowerCase();
            return SUNFALL_WEATHERS.find((entry) => entry.id === lower) || SUNFALL_WEATHERS[0];
        }
        return SUNFALL_WEATHERS[0];
    };
    const a = find(weather);
    if (nextWeather == null || !(mix > 0)) {
        return { ...a };
    }
    const b = find(nextWeather);
    const t = smooth(0, 1, mix);
    return {
        id: t < 0.5 ? a.id : b.id,
        name: t < 0.5 ? a.name : b.name,
        dripScale: lerp(a.dripScale, b.dripScale, t),
        mistScale: lerp(a.mistScale, b.mistScale, t),
        cloudOpacity: lerp(a.cloudOpacity, b.cloudOpacity, t),
        sprayRate: lerp(a.sprayRate, b.sprayRate, t),
    };
}

/**
 * Shared CPU mirror of the TSL `sunlitAt(worldPos, sunDir, fringeTex)` node.
 * Projects `(worldX, worldY, worldZ)` along `sunDir` onto the oculus plane `y = 88`,
 * evaluates the elliptical oculus opening at `(26, -118)` with semi-axes `(26, 19)`,
 * and modulates by optional vine-fringe transmission.
 *
 * Accepts `sunDir` pointing either upward toward the oculus (`sunDir[1] > 0`)
 * or downward along the beam (`sunDir[1] < 0`).
 *
 * @param {number} worldX
 * @param {number} worldY
 * @param {number} worldZ
 * @param {readonly number[]} [sunDir]
 * @param {number|((angleRad: number) => number)} [fringeSample]
 */
export function sunlitAt(
    worldX,
    worldY,
    worldZ,
    sunDir = SUNFALL_STATIONS[1].sunDir,
    fringeSample = 0.88,
) {
    const sign = (sunDir?.[1] ?? 1) < 0 ? -1 : 1;
    const sx = (sunDir?.[0] ?? 0.11) * sign;
    const sy = Math.max(0.15, Math.abs(sunDir?.[1] ?? 0.97));
    const sz = (sunDir?.[2] ?? -0.19) * sign;

    const t = (OCULUS_CENTER[1] - worldY) / sy;
    const hitX = worldX + sx * t;
    const hitZ = worldZ + sz * t;

    const dx = (hitX - OCULUS_CENTER[0]) / OCULUS_RX;
    const dz = (hitZ - OCULUS_CENTER[2]) / OCULUS_RZ;
    const r = Math.hypot(dx, dz);

    const open = 1 - smooth(0.78, 1.05, r);
    if (open <= 0) return 0;

    let fringe = 0.88;
    if (typeof fringeSample === 'function') {
        fringe = clamp01(fringeSample(Math.atan2(dz, dx)));
    } else if (typeof fringeSample === 'number' && Number.isFinite(fringeSample)) {
        fringe = clamp01(fringeSample);
    }

    const rimWeight = smooth(0.55, 0.95, r);
    const rimFactor = lerp(1.0, fringe, rimWeight);
    return open * rimFactor;
}

/**
 * CPU mirror of the analytic Lee/Airy primary + secondary double rainbow `dlBow(cosTheta)`.
 * Primary bow peaks around `cos(41.3°) ≈ 0.751`; secondary bow around `cos(51°) ≈ 0.629`
 * with reversed dispersion order and Alexander's dark band (`[0.64, 0.73]`) between them.
 *
 * @param {number} cosTheta - `dot(viewRay, -bowSun)`
 * @returns {[number, number, number]} linear RGB `[r, g, b]`
 */
export function dlBowCpu(cosTheta) {
    const c = Number.isFinite(cosTheta) ? cosTheta : 0;
    const g = (mu, sigma) => {
        const d = (c - mu) / sigma;
        return Math.exp(-0.5 * d * d);
    };
    // Primary rainbow (40.6° violet to 42.3° red -> cos 0.759 down to 0.740)
    const pR = g(0.742, 0.0065);
    const pG = g(0.751, 0.0060);
    const pB = g(0.760, 0.0065);
    // Supernumerary inner fringes inside primary violet (cos ~ 0.769, 0.777)
    const sup1 = g(0.769, 0.0038) * 0.28;
    const sup2 = g(0.776, 0.0035) * 0.14;

    // Secondary rainbow (50.4° red to 53.2° violet -> cos 0.637 down to 0.599, reversed order)
    const sR = g(0.636, 0.0095) * 0.36;
    const sG = g(0.623, 0.0090) * 0.36;
    const sB = g(0.610, 0.0095) * 0.36;

    return [
        pR + sup1 * 0.45 + sR,
        pG + sup1 * 0.85 + sup2 * 0.55 + sG,
        pB + sup1 * 0.95 + sup2 * 0.90 + sB,
    ];
}

/**
 * Compute a unit sun direction `bowSun` at `41.3°` (`cos = 0.751`) from `-camToSheetDir`
 * so that `dot(viewRay, -bowSun)` sweeps `[0.73, 0.77]` across the Cataract spray sheet
 * regardless of the real oculus sun elevation.
 *
 * @param {readonly number[]} [camToSheetDir] - Direction from camera toward the spray sheet
 * @returns {[number, number, number]} unit `bowSun` vector
 */
export function solveBowSun(camToSheetDir = [0.14, -0.18, -0.97]) {
    const vx = Number.isFinite(camToSheetDir?.[0]) ? camToSheetDir[0] : 0.14;
    const vy = Number.isFinite(camToSheetDir?.[1]) ? camToSheetDir[1] : -0.18;
    const vz = Number.isFinite(camToSheetDir?.[2]) ? camToSheetDir[2] : -0.97;
    const vLen = Math.hypot(vx, vy, vz) || 1;
    // Antisolar axis aligned with viewRay so dot(viewRay, -bowSun) = cos(angle)
    const ax = -vx / vLen;
    const ay = -vy / vLen;
    const az = -vz / vLen;

    // Build an orthonormal upward tangent perpendicular to `a`
    let ux = 0;
    let uy = 1;
    let uz = 0;
    const dotAU = ax * ux + ay * uy + az * uz;
    ux -= dotAU * ax;
    uy -= dotAU * ay;
    uz -= dotAU * az;
    const uLen = Math.hypot(ux, uy, uz) || 1;
    ux /= uLen;
    uy /= uLen;
    uz /= uLen;

    const theta = 41.3 * (Math.PI / 180);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    const bx = ax * cosT + ux * sinT;
    const by = ay * cosT + uy * sinT;
    const bz = az * cosT + uz * sinT;
    const bLen = Math.hypot(bx, by, bz) || 1;
    return [bx / bLen, by / bLen, bz / bLen];
}

/**
 * Botanical delayed-greening time constant `tau` in seconds (`[14, 24]` s, mean `19` s).
 * @param {number} [seed01] - Deterministic value in `[0, 1]`
 */
export function greeningTau(seed01 = 0.5) {
    const s = clamp01(Number.isFinite(seed01) ? seed01 : 0.5);
    return 14 + s * 10;
}

/**
 * Evaluate a young tropical leaf's linear RGB colour at `ageSeconds` along its
 * delayed-greening curve (`flushSwatch -> matureLeaf`, plus backlit chartreuse transmission).
 *
 * @param {number|string} pieceCodeOrIndex - Piece code ('I'..'L') or index `0..6`
 * @param {number} [ageSeconds] - Seconds since flush/emergence
 * @param {number} [tauSeconds] - Greening time constant (default 19 s)
 * @param {number} [backlitAmount] - Transmission factor in `[0, 1]`
 * @returns {[number, number, number]}
 */
export function leafTintAtAge(
    pieceCodeOrIndex = 0,
    ageSeconds = 0,
    tauSeconds = SUNFALL_TIMINGS.greeningTauMean,
    backlitAmount = 0,
) {
    let code = PIECE_CODES[0];
    if (typeof pieceCodeOrIndex === 'string') {
        if (PIECE_SWATCH_RGB[pieceCodeOrIndex]) code = pieceCodeOrIndex;
    } else {
        code = PIECE_CODES[((Math.floor(pieceCodeOrIndex) % 7) + 7) % 7];
    }
    const swatch = PIECE_SWATCH_RGB[code];
    const age = Math.max(0, Number.isFinite(ageSeconds) ? ageSeconds : 0);
    const tau = Math.max(1, Number.isFinite(tauSeconds) ? tauSeconds : SUNFALL_TIMINGS.greeningTauMean);
    const young = Math.exp(-age / tau);

    const base = lerp3(MATURE_LEAF_RGB, swatch, young);
    const bl = clamp01(backlitAmount) * 0.55;
    return lerp3(base, BACKLIT_LEAF_RGB, bl);
}

/**
 * Pack up to 8 piece-code indices (`0..6`, 3 bits each) into a single 24-bit integer
 * safe for a float32 uniform.
 * @param {readonly (number|string)[]} codes
 */
export function packCodes(codes = []) {
    let packed = 0;
    const count = Math.min(8, codes.length);
    for (let i = 0; i < count; i += 1) {
        const item = codes[i];
        let idx = 0;
        if (typeof item === 'string') {
            const found = PIECE_CODES.indexOf(item.toUpperCase());
            idx = found >= 0 ? found : 0;
        } else if (Number.isFinite(item)) {
            idx = ((Math.floor(item) % 7) + 7) % 7;
        }
        packed |= (idx & 0x7) << (i * 3);
    }
    return packed >>> 0;
}

/**
 * Unpack `count` piece-code indices (`0..6`) from a bit-packed integer produced by `packCodes`.
 * @param {number} packed
 * @param {number} [count]
 * @returns {number[]}
 */
export function unpackCodes(packed = 0, count = 4) {
    const p = (Number.isFinite(packed) ? Math.floor(packed) : 0) >>> 0;
    const n = clamp(Math.floor(count), 0, 8);
    const out = [];
    for (let i = 0; i < n; i += 1) {
        out.push(((p >>> (i * 3)) & 0x7) % 7);
    }
    return out;
}

/**
 * Extract occupied board cells from a piece shape matrix or cell list.
 * Normalizes columns into `[0, 9]` and rows into `[0, 19]`.
 *
 * @param {Array} [shape]
 * @param {string} [code]
 * @param {number} [baseCol]
 * @param {number} [baseRow]
 */
export function cellsFromMatrix(shape = null, code = 'T', baseCol = 4, baseRow = 12) {
    const pieceCode = PIECE_SWATCH_RGB[code] ? code : 'T';
    const codeIndex = Math.max(0, PIECE_CODES.indexOf(pieceCode));
    const cells = [];

    if (Array.isArray(shape) && shape.length > 0) {
        for (let r = 0; r < shape.length; r += 1) {
            const rowArr = shape[r];
            if (Array.isArray(rowArr)) {
                for (let c = 0; c < rowArr.length; c += 1) {
                    if (rowArr[c]) {
                        cells.push({
                            col: clamp(Math.round(baseCol + c), 0, 9),
                            row: clamp(Math.round(baseRow + r), 0, 19),
                            code: pieceCode,
                            codeIndex,
                        });
                    }
                }
            } else if (rowArr && typeof rowArr === 'object' && ('x' in rowArr || 'col' in rowArr)) {
                const c = rowArr.col ?? rowArr.x ?? baseCol;
                const rr = rowArr.row ?? rowArr.y ?? baseRow;
                cells.push({
                    col: clamp(Math.round(c), 0, 9),
                    row: clamp(Math.round(rr), 0, 19),
                    code: pieceCode,
                    codeIndex,
                });
            }
        }
    }

    if (cells.length === 0) {
        // Fallback 4-cell T-shape cluster around (baseCol, baseRow)
        const offsets = [[0, 0], [-1, 0], [1, 0], [0, 1]];
        for (const [dc, dr] of offsets) {
            cells.push({
                col: clamp(Math.round(baseCol + dc), 0, 9),
                row: clamp(Math.round(baseRow + dr), 0, 19),
                code: pieceCode,
                codeIndex,
            });
        }
    }

    return cells.slice(0, 4);
}

/**
 * Map a board cell `(col, row)` onto a 3D world position on the doline jungle cone
 * or hanging root curtains so locks, hard drops, and row clears land in the sunlit garden.
 *
 * @param {number} [col] - `[0, 9]`
 * @param {number} [row] - `[0, 19]` (0 = top of board, 19 = floor of board)
 */
export function boardCellToDolineWorld(col = 4.5, row = 12) {
    const u = clamp01(col / 9);
    const v = clamp01(row / 19); // 0 = high canopy / roots, 1 = lower cone / gour rim
    const angle = (u - 0.5) * 2.15;
    const radius = lerp(11.5, 29.0, v);
    const x = POOL_CENTER[0] + Math.sin(angle) * radius + (u - 0.5) * 14.0;
    const z = POOL_CENTER[2] + Math.cos(angle) * radius * 0.72 - (1 - v) * 8.0;
    const coneHeight = Math.max(0, 1 - Math.hypot(x - POOL_CENTER[0], z - POOL_CENTER[2]) / 36.0) * 26.0;
    const y = POOL_CENTER[1] - 6.0 + coneHeight + (1 - v) * 9.0;
    return [x, y, z];
}

/**
 * Deterministic layout planner for the Hang Sơn Đoòng doline chamber.
 * Returns placements for the breakdown cone foliage, hanging root curtains,
 * dry foreground rimstone gours, cave-swift orbit rings, and oculus drip streams.
 *
 * @param {number} [seed]
 * @param {object} [preset]
 */
export function planDoline(seed = SUNFALL_SEED, preset = {}) {
    const rng = mulberry32(seed);
    const gourCount = Math.max(0, preset.gourPools ?? 5);
    const curtainCount = Math.max(0, preset.fringeCurtains ?? 14);
    const dripCount = Math.max(0, preset.dripStreams ?? 40);
    const swiftCount = Math.max(0, preset.swiftCount ?? 40);

    // Foreground dry rimstone gour terraces (left and right of the board lane)
    const gours = [];
    for (let i = 0; i < gourCount; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const tier = Math.floor(i / 2);
        const x = side * (16 + tier * 7.5 + (rng() - 0.5) * 3.0) + 4.0;
        const y = -11.5 - tier * 3.2 + (rng() - 0.5) * 0.6;
        const z = -22.0 - tier * 9.5 + (rng() - 0.5) * 3.5;
        const rx = 5.8 + rng() * 3.2;
        const rz = 3.8 + rng() * 2.4;
        gours.push({
            index: i,
            x,
            y,
            z,
            rx,
            rz,
            yaw: (rng() - 0.5) * 0.55,
            mossBand: 0.45 + rng() * 0.45,
        });
    }

    // Hanging aerial root & vine curtains around the oculus rim and upper vault
    const curtains = [];
    for (let i = 0; i < curtainCount; i += 1) {
        const theta = (i / Math.max(1, curtainCount)) * Math.PI * 2 + (rng() - 0.5) * 0.22;
        const rimScale = 0.86 + rng() * 0.32;
        const x = OCULUS_CENTER[0] + Math.cos(theta) * OCULUS_RX * rimScale;
        const z = OCULUS_CENTER[2] + Math.sin(theta) * OCULUS_RZ * rimScale;
        const topY = OCULUS_CENTER[1] - 2.0 - rng() * 8.0;
        const length = 18.0 + rng() * 28.0;
        const codeIndex = i % PIECE_CODES.length;
        curtains.push({
            index: i,
            theta,
            x,
            topY,
            z,
            length,
            swayPhase: rng() * Math.PI * 2,
            codeIndex,
            tau: greeningTau(rng()),
        });
    }

    // Oculus rim drip columns
    const drips = [];
    for (let i = 0; i < dripCount; i += 1) {
        const theta = (i / Math.max(1, dripCount)) * Math.PI * 2 + (rng() - 0.5) * 0.15;
        const rScale = 0.72 + rng() * 0.36;
        const x = OCULUS_CENTER[0] + Math.cos(theta) * OCULUS_RX * rScale;
        const z = OCULUS_CENTER[2] + Math.sin(theta) * OCULUS_RZ * rScale;
        const speed = 22.0 + rng() * 16.0;
        const phase = rng();
        drips.push({
            index: i,
            x,
            z,
            topY: OCULUS_CENTER[1] - 1.5,
            bottomY: POOL_CENTER[1] + 2.0,
            speed,
            phase,
        });
    }

    // Cave swifts (Aerodramus) orbiting the upper sunlit shaft below the oculus
    const swifts = [];
    for (let i = 0; i < swiftCount; i += 1) {
        const orbitR = 11.0 + rng() * 19.0;
        const orbitY = 32.0 + rng() * 44.0;
        const speed = (0.38 + rng() * 0.34) * (i % 2 === 0 ? 1 : -1);
        const phase = rng() * Math.PI * 2;
        const bank = 0.25 + rng() * 0.35;
        swifts.push({
            index: i,
            orbitR,
            orbitY,
            speed,
            phase,
            bank,
            flapRate: 7.5 + rng() * 3.5,
        });
    }

    return {
        oculus: { center: OCULUS_CENTER, rx: OCULUS_RX, rz: OCULUS_RZ },
        pool: { center: POOL_CENTER, radius: 36 },
        farDoline: { center: FAR_DOLINE_CENTER, rx: 16, rz: 12 },
        gours,
        curtains,
        drips,
        swifts,
    };
}
