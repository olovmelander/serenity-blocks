/**
 * Sunfall — the doline in numbers (three-free).
 *
 * The world is a giant collapse chamber modelled after Hang Sơn Đoòng. The eye stands on a
 * rimstone ledge on the near wall, about 110 m above the jungle canopy, looking across the
 * void. Up and to the left, the oculus (a collapse skylight through a thin roof) lets in a
 * column of sunlight — the sunfall — that lands on the canopy in the left third of the frame;
 * the passage runs on to the right and away, with the far doline at its end.
 *
 * The chamber, the ledge and the canopy plan are authored in Blender
 * (scripts/blender/sunfall_assets.py, layout in scripts/blender/sunfall/layout.py).
 * `SUNFALL_LAYOUT` mirrors that layout; a unit test compares it with the asset manifest.
 *
 * Also here: the five sun stations and four cave weathers, the CPU mirror of the shader's
 * sunlight test (`sunlitAt`), the analytic double rainbow (`dlBowCpu`) and its art-directed
 * sun (`solveBowSun`), delayed greening of young leaves, code packing, and the plan of the
 * hanging strands, swiftlets and drips.
 */

export const SUNFALL_SEED = 0x53554e46; // 'SUNF'
export const SUNFALL_CLEAR = 0x5d8087; // Chamber Haze

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

const freezeDeep = (o) => {
    Object.values(o).forEach((v) => { if (v && typeof v === 'object') freezeDeep(v); });
    return Object.freeze(o);
};

/** Metres, three.js axes (+y up, the eye looks down -z). Mirrors scripts/blender/sunfall/layout.py. */
export const SUNFALL_LAYOUT = freezeDeep({
    eye: [0, 0, 0],
    chamber: {
        center: [-40, -390], radii: [370, 402], wall_top: 34, crown: 168,
    },
    floor: {
        base: -150, cone_center: [-150, -365], cone_radius: 260, cone_height: 46,
    },
    oculus: {
        center: [-198, -432], radii: [54, 44], underside: 150, surface: 182,
    },
    passage: {
        a: [215, -470], b: [520, -930], half_width: [104, 78], floor: [-152, -160], crown: [142, 112],
    },
    farDoline: {
        center: [452, -828], radii: [34, 30], underside: 96, surface: 132,
    },
    flowstone: { center: [150, -720], radius: 190 },
    canopy: { tree_height: [30, 46], emergent_height: [50, 62] },
    camera: {
        position: [0, 0, 0], pitch_deg: -4, yaw_deg: 0, fov_deg: 52,
    },
    stations: [
        [-0.30, 0.90, -0.31],
        [-0.21, 0.93, -0.30],
        [-0.13, 0.95, -0.28],
        [-0.06, 0.96, -0.27],
        [-0.25, 0.88, -0.40],
    ],
});

export const OCULUS_CENTER = Object.freeze([
    SUNFALL_LAYOUT.oculus.center[0], SUNFALL_LAYOUT.oculus.underside, SUNFALL_LAYOUT.oculus.center[1],
]);
export const OCULUS_RX = SUNFALL_LAYOUT.oculus.radii[0];
export const OCULUS_RZ = SUNFALL_LAYOUT.oculus.radii[1];
export const FAR_DOLINE_CENTER = Object.freeze([
    SUNFALL_LAYOUT.farDoline.center[0], SUNFALL_LAYOUT.farDoline.underside, SUNFALL_LAYOUT.farDoline.center[1],
]);
/** Height of the canopy surface round the pool (the crowns stand 30-46 m on a floor near -150). */
export const CANOPY_LEVEL = -108;
/** The cave-cloud deck: a slab under the vault that the sunfall burns a hole through. */
export const DECK = Object.freeze({ bottom: 40, top: 78 });

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

const station = (index, id, name, fields) => Object.freeze({
    index,
    id,
    name,
    sunDir: norm3(SUNFALL_LAYOUT.stations[index]),
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Array.isArray(v) ? Object.freeze(v) : v])),
});

/**
 * Five stations of the sun's crossing above the oculus (unit vectors toward the sun). The sun
 * stands beyond the oculus and to the left, so the column leans toward the eye and the canopy
 * it lands on is lit through. Colours are linear tints; the shaders own the intensities.
 */
export const SUNFALL_STATIONS = Object.freeze([
    station(0, 'first-shaft', 'First Shaft', {
        beamWarmth: 0.62,
        cloudFloor: 0.72,
        skyZenith: [0.50, 0.70, 1.00],
        skyRim: [1.00, 0.93, 0.80],
        beamCore: [1.00, 0.88, 0.68],
        beamScatter: [1.00, 0.90, 0.74],
        poolSun: [0.80, 0.92, 0.30],
        bounceVault: [0.62, 0.62, 0.34],
        caveShadow: [0.10, 0.16, 0.18],
        mistTint: [0.36, 0.48, 0.50],
        gourBlue: [0.10, 0.40, 0.85],
    }),
    station(1, 'high-sunfall', 'High Sunfall', {
        beamWarmth: 0.42,
        cloudFloor: 0.50,
        skyZenith: [0.46, 0.68, 1.00],
        skyRim: [0.96, 0.98, 1.00],
        beamCore: [1.00, 0.94, 0.80],
        beamScatter: [0.98, 0.96, 0.84],
        poolSun: [0.74, 0.94, 0.30],
        bounceVault: [0.56, 0.64, 0.36],
        caveShadow: [0.09, 0.16, 0.19],
        mistTint: [0.34, 0.49, 0.52],
        gourBlue: [0.10, 0.44, 0.90],
    }),
    station(2, 'cloud-breath', 'Cloud Breath', {
        beamWarmth: 0.48,
        cloudFloor: 0.88,
        skyZenith: [0.52, 0.70, 0.96],
        skyRim: [0.94, 0.96, 0.96],
        beamCore: [1.00, 0.95, 0.84],
        beamScatter: [0.96, 0.97, 0.90],
        poolSun: [0.70, 0.92, 0.34],
        bounceVault: [0.54, 0.64, 0.40],
        caveShadow: [0.10, 0.17, 0.20],
        mistTint: [0.40, 0.53, 0.55],
        gourBlue: [0.10, 0.42, 0.86],
    }),
    station(3, 'rain-thread', 'Rain Thread', {
        beamWarmth: 0.44,
        cloudFloor: 0.64,
        skyZenith: [0.48, 0.66, 0.94],
        skyRim: [0.92, 0.95, 0.98],
        beamCore: [0.98, 0.96, 0.88],
        beamScatter: [0.94, 0.97, 0.94],
        poolSun: [0.68, 0.94, 0.38],
        bounceVault: [0.50, 0.62, 0.42],
        caveShadow: [0.09, 0.16, 0.21],
        mistTint: [0.38, 0.52, 0.57],
        gourBlue: [0.12, 0.46, 0.92],
    }),
    station(4, 'amber-slant', 'Amber Slant', {
        beamWarmth: 0.80,
        cloudFloor: 0.56,
        skyZenith: [0.56, 0.68, 0.92],
        skyRim: [1.00, 0.84, 0.62],
        beamCore: [1.00, 0.80, 0.54],
        beamScatter: [1.00, 0.84, 0.62],
        poolSun: [0.86, 0.88, 0.26],
        bounceVault: [0.66, 0.58, 0.30],
        caveShadow: [0.11, 0.15, 0.17],
        mistTint: [0.40, 0.46, 0.46],
        gourBlue: [0.10, 0.40, 0.82],
    }),
]);

export const SUNFALL_WEATHERS = Object.freeze([
    Object.freeze({
        id: 'clear', name: 'Clear Beam', dripScale: 0.55, mistScale: 0.80, cloudOpacity: 0.50, sprayRate: 0.35,
    }),
    Object.freeze({
        id: 'mist', name: 'Chamber Mist', dripScale: 0.75, mistScale: 1.45, cloudOpacity: 0.80, sprayRate: 0.55,
    }),
    Object.freeze({
        id: 'shower', name: 'Rim Shower', dripScale: 1.45, mistScale: 1.10, cloudOpacity: 0.65, sprayRate: 1.00,
    }),
    Object.freeze({
        id: 'cloud', name: 'Cave Cloud', dripScale: 0.65, mistScale: 1.30, cloudOpacity: 1.00, sprayRate: 0.45,
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
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
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

/** Deterministic 32-bit PRNG (Mulberry32). */
export function mulberry32(seed = SUNFALL_SEED) {
    let a = (seed >>> 0) || SUNFALL_SEED;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Level 1 rests on High Sunfall (the canonical frame); each level walks the light one station on. */
export function stationIndexForLevel(level = 1) {
    const n = SUNFALL_STATIONS.length;
    const lv = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
    return (((lv - 1 + 1) % n) + n) % n;
}

/** Smoothly sample the cyclic station ring at a fractional station coordinate. */
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
    const out = {
        stationFloat: wrapped,
        index: idx,
        nextIndex: nextIdx,
        mix,
        id: rawT < 0.5 ? a.id : b.id,
        name: rawT < 0.5 ? a.name : b.name,
        sunDir: [rawSun[0] / sunLen, rawSun[1] / sunLen, rawSun[2] / sunLen],
        beamWarmth: lerp(a.beamWarmth, b.beamWarmth, mix),
        cloudFloor: lerp(a.cloudFloor, b.cloudFloor, mix),
    };
    ['skyZenith', 'skyRim', 'beamCore', 'beamScatter', 'poolSun', 'bounceVault', 'caveShadow', 'mistTint',
        'gourBlue'].forEach((key) => { out[key] = lerp3(a[key], b[key], mix); });
    return out;
}

/** Sample or blend the cave's weathers by id or index. */
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
    if (nextWeather == null || !(mix > 0)) return { ...a };
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
 * Where a point's sun ray crosses the oculus plane, in units of the oculus radii about its
 * centre: `[qx, qz]`. Inside the opening when |q| < ~1. The same projection the shaders use.
 */
export function oculusCoord(x, y, z, sunDir = SUNFALL_STATIONS[1].sunDir) {
    const sy = Math.max(0.15, Math.abs(sunDir[1]));
    const sign = sunDir[1] < 0 ? -1 : 1;
    const t = (OCULUS_CENTER[1] - y) / sy;
    const hx = x + sunDir[0] * sign * t;
    const hz = z + sunDir[2] * sign * t;
    return [(hx - OCULUS_CENTER[0]) / OCULUS_RX, (hz - OCULUS_CENTER[2]) / OCULUS_RZ];
}

/**
 * CPU mirror of the shaders' sunlight test: 1 inside the sunfall (the oculus projected
 * along the sun), 0 outside, the ragged rim in between. `fringeSample` scales the light in
 * the rim band (a number, or a function of the angle round the opening).
 */
export function sunlitAt(worldX, worldY, worldZ, sunDir = SUNFALL_STATIONS[1].sunDir, fringeSample = 0.88) {
    if (worldY > OCULUS_CENTER[1]) return 1;
    const [qx, qz] = oculusCoord(worldX, worldY, worldZ, sunDir);
    const r = Math.hypot(qx, qz);
    const open = 1 - smooth(0.78, 1.05, r);
    if (open <= 0) return 0;
    let fringe = 0.88;
    if (typeof fringeSample === 'function') fringe = clamp01(fringeSample(Math.atan2(qz, qx)));
    else if (typeof fringeSample === 'number' && Number.isFinite(fringeSample)) fringe = clamp01(fringeSample);
    return open * lerp(1.0, fringe, smooth(0.55, 0.95, r));
}

/** Where the column's axis meets the canopy for a sun direction: the foot of the sunfall. */
export function footFor(sunDir = SUNFALL_STATIONS[1].sunDir, canopy = CANOPY_LEVEL) {
    const sy = Math.max(0.15, sunDir[1]);
    const t = (OCULUS_CENTER[1] - canopy) / sy;
    return [OCULUS_CENTER[0] - sunDir[0] * t, canopy, OCULUS_CENTER[2] - sunDir[2] * t];
}

/**
 * CPU mirror of the analytic primary + secondary rainbow `dlBow(cosTheta)`: the primary peaks
 * near cos(41.3°) ≈ 0.751 with red outside, the secondary near cos(51°) ≈ 0.629 with its order
 * reversed, Alexander's dark band between.
 * @param {number} cosTheta - `dot(viewRay, -bowSun)`
 */
export function dlBowCpu(cosTheta) {
    const c = Number.isFinite(cosTheta) ? cosTheta : 0;
    const g = (mu, sigma) => {
        const d = (c - mu) / sigma;
        return Math.exp(-0.5 * d * d);
    };
    const pR = g(0.742, 0.0065);
    const pG = g(0.751, 0.0060);
    const pB = g(0.760, 0.0065);
    const sup1 = g(0.769, 0.0038) * 0.28;
    const sup2 = g(0.776, 0.0035) * 0.14;
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
 * An art-directed sun direction `bowSun` 41.3° off the direction from the eye to the spray,
 * so the primary bow always stands in the cataract's spray whatever the real sun does.
 * @param {readonly number[]} [camToSheetDir] - from the eye toward the spray
 */
export function solveBowSun(camToSheetDir = [-0.3, -0.25, -0.92]) {
    const vx = Number.isFinite(camToSheetDir?.[0]) ? camToSheetDir[0] : -0.3;
    const vy = Number.isFinite(camToSheetDir?.[1]) ? camToSheetDir[1] : -0.25;
    const vz = Number.isFinite(camToSheetDir?.[2]) ? camToSheetDir[2] : -0.92;
    const vLen = Math.hypot(vx, vy, vz) || 1;
    const ax = -vx / vLen;
    const ay = -vy / vLen;
    const az = -vz / vLen;
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
    const bx = ax * Math.cos(theta) + ux * Math.sin(theta);
    const by = ay * Math.cos(theta) + uy * Math.sin(theta);
    const bz = az * Math.cos(theta) + uz * Math.sin(theta);
    const bLen = Math.hypot(bx, by, bz) || 1;
    return [bx / bLen, by / bLen, bz / bLen];
}

/** Delayed-greening time constant in seconds (`[14, 24]`, mean 19). */
export function greeningTau(seed01 = 0.5) {
    const s = clamp01(Number.isFinite(seed01) ? seed01 : 0.5);
    return 14 + s * 10;
}

/** A young leaf's linear colour `ageSeconds` after it opened: piece pigment greening to emerald. */
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
    return lerp3(base, BACKLIT_LEAF_RGB, clamp01(backlitAmount) * 0.55);
}

/** Pack up to 8 piece-code indices (3 bits each) into one integer that is exact in fp32. */
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

export function unpackCodes(packed = 0, count = 4) {
    const p = (Number.isFinite(packed) ? Math.floor(packed) : 0) >>> 0;
    const n = clamp(Math.floor(count), 0, 8);
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(((p >>> (i * 3)) & 0x7) % 7);
    return out;
}

/** Occupied board cells of a piece shape matrix or cell list (columns 0..9, rows 0..19). */
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
                cells.push({
                    col: clamp(Math.round(rowArr.col ?? rowArr.x ?? baseCol), 0, 9),
                    row: clamp(Math.round(rowArr.row ?? rowArr.y ?? baseRow), 0, 19),
                    code: pieceCode,
                    codeIndex,
                });
            }
        }
    }
    if (cells.length === 0) {
        for (const [dc, dr] of [[0, 0], [-1, 0], [1, 0], [0, 1]]) {
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
 * A board cell on the canopy round the rest foot of the sunfall: columns run left to right
 * across the pool (as on screen), rows run from its far edge (top rows) to its near edge.
 * New growth from a cleared row lands here, in the light.
 */
export function boardCellToDolineWorld(col = 4.5, row = 12) {
    const u = clamp01(col / 9);
    const v = clamp01(row / 19);
    const [fx, , fz] = footFor(SUNFALL_STATIONS[1].sunDir);
    const x = fx + (u - 0.5) * 70;
    const z = fz - 34 + v * 62;
    return [x, CANOPY_LEVEL + 4 - v * 6, z];
}

/**
 * Deterministic plan of what the world places in code: the hanging strands either side of
 * the card (anchors, lengths, sway), the swiftlets and the drips off the oculus rim.
 */
export function planDoline(seed = SUNFALL_SEED, preset = {}) {
    const rng = mulberry32(seed);
    const gourCount = Math.max(0, preset.gourPools ?? 5);
    const curtainCount = Math.max(0, preset.fringeCurtains ?? 14);
    const dripCount = Math.max(0, preset.dripStreams ?? 40);
    const swiftCount = Math.max(0, preset.swiftCount ?? 16);

    // Gours are authored in the ledge mesh; these are only the spikemoss sparkle sites.
    const gours = [];
    for (let i = 0; i < gourCount; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        gours.push({
            index: i,
            x: side * (14 + rng() * 14),
            y: -8 - rng() * 3,
            z: -10 - rng() * 10,
            rx: 2 + rng() * 2,
            rz: 1.5 + rng() * 1.5,
            yaw: (rng() - 0.5) * 0.55,
            mossBand: 0.45 + rng() * 0.45,
        });
    }

    // Strands of aerial roots and lianas hanging from the vault near the eye, either side of
    // the card: the left half of the strands at x < 0, the right half at x > 0.
    const curtains = [];
    for (let i = 0; i < curtainCount; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const lane = Math.floor(i / 2);
        const depth = 16 + rng() * 22 + lane * 1.5;
        // Outside the card (|NDC x| < 0.24 at rest) and, on the right, outside the HUD.
        const across = (side < 0 ? 0.27 + rng() * 0.4 : 0.5 + rng() * 0.24) * depth * side;
        curtains.push({
            index: i,
            side,
            theta: 0,
            x: across,
            topY: 34 + rng() * 10,
            z: -depth,
            // Most strands run past the frame's foot; a few root tips end in view.
            length: rng() < 0.3 ? 30 + rng() * 22 : 70 + rng() * 30,
            swayPhase: rng() * Math.PI * 2,
            codeIndex: i % PIECE_CODES.length,
            tau: greeningTau(rng()),
        });
    }

    const drips = [];
    for (let i = 0; i < dripCount; i += 1) {
        const theta = (i / Math.max(1, dripCount)) * Math.PI * 2 + (rng() - 0.5) * 0.15;
        const rScale = 0.86 + rng() * 0.2;
        drips.push({
            index: i,
            x: OCULUS_CENTER[0] + Math.cos(theta) * OCULUS_RX * rScale,
            z: OCULUS_CENTER[2] + Math.sin(theta) * OCULUS_RZ * rScale,
            topY: OCULUS_CENTER[1] - 1.5,
            bottomY: CANOPY_LEVEL,
            speed: 22.0 + rng() * 16.0,
            phase: rng(),
        });
    }

    // Cave swiftlets: specks that carve long arcs across the chamber in pairs.
    const swifts = [];
    for (let i = 0; i < swiftCount; i += 1) {
        const pair = Math.floor(i / 2);
        swifts.push({
            index: i,
            orbitR: 60 + ((pair * 37) % 90) + rng() * 10,
            orbitY: -40 + ((pair * 23) % 90) + rng() * 6,
            speed: (0.11 + rng() * 0.06) * (pair % 2 === 0 ? 1 : -1),
            phase: pair * 1.7 + (i % 2) * 0.05 + rng() * 0.02,
            bank: 0.25 + rng() * 0.35,
            flapRate: 7.5 + rng() * 3.5,
        });
    }

    return {
        oculus: { center: OCULUS_CENTER, rx: OCULUS_RX, rz: OCULUS_RZ },
        pool: { center: footFor(SUNFALL_STATIONS[1].sunDir), radius: 48 },
        farDoline: {
            center: FAR_DOLINE_CENTER, rx: SUNFALL_LAYOUT.farDoline.radii[0], rz: SUNFALL_LAYOUT.farDoline.radii[1],
        },
        gours,
        curtains,
        drips,
        swifts,
    };
}
