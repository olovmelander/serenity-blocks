/**
 * Waves — the green room: numbers, shape and noise (CPU only, three-free).
 *
 * Everything that has to agree between the renderer, the event aiming and the tests lives here:
 * the shape of the breaking wave, where its lip is at any point along it, the flow that carries
 * everything drawn on the water, and the noise field the water is textured with.
 *
 * World: metres, y up, the trough at y = 0. The wave's crest runs along z and the wave travels
 * toward −x. The eye rides inside the tube at z = 0 and looks toward −z, down the line: the face
 * of the wave rises on its right (+x), the roof goes over its head and the lip falls on its left
 * (−x), where the tube opens onto the sea. `d = −z` is the distance ahead of the eye.
 *
 * A cross-section is described by one parameter r:
 *   r in [−1, 0]  the trough and the sea in front of the wave, flat, from far out (r = −1) to
 *                 the foot of the face (r = 0);
 *   r in [0, 1]   the wave itself, from the foot of the face up and over to the lip's edge
 *                 (r = 1). In the tube that is an arc of an ellipse, swept as far round as the
 *                 lip has fallen at that distance; ahead, where the wave has not broken yet, it
 *                 relaxes into the plain hump of a swell.
 * The lip is thrown at the crest ahead and falls as the tube comes toward the eye, so how far
 * round the arc reaches (`lipAngle`) is a function of distance: the tube is an eye-shaped
 * opening that narrows to a closed pipe behind the viewer.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two DISTINCT edges (either order). */
export function smooth(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
}

/** Frame-rate independent easing factor: `value += (target - value) * approach(rate, dt)`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * Math.max(0, dt));

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * A piece's colour (a CSS hex string) as scene-linear light, its brightest channel at 1 so that
 * every piece strikes the water equally hard. Anything else (and a colour with no light in it)
 * gives sunlit foam white.
 */
export function pieceLight(color, out = [1, 0.93, 0.8]) {
    const hex = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
    const r = hex ? srgbToLinear(Number.parseInt(hex.slice(1, 3), 16) / 255) : 0;
    const g = hex ? srgbToLinear(Number.parseInt(hex.slice(3, 5), 16) / 255) : 0;
    const b = hex ? srgbToLinear(Number.parseInt(hex.slice(5, 7), 16) / 255) : 0;
    const peak = Math.max(r, g, b);
    if (peak < 0.01) {
        out[0] = 1;
        out[1] = 0.93;
        out[2] = 0.8;
        return out;
    }
    out[0] = r / peak;
    out[1] = g / peak;
    out[2] = b / peak;
    return out;
}

// ── The wave ────────────────────────────────────────────────────────────────────────────────

export const WAVE = Object.freeze({
    /** Half the tube's width and half its height (the roof is 2·b above the trough), metres. */
    a: 3.5,
    b: 3.0,
    /** Metres of water surface per radian of arc: the metric rings, ribbons and texture use. */
    rho: 3.25,
    /** How far round the lip reaches where it has touched down, and where it only feathers. */
    lipClosed: 338 * DEG,
    lipCrest: 164 * DEG,
    /** The lip falls slowly off the crest and fast at the end. */
    lipPower: 1.7,
    /** Where the lip touches down while the barrel is at rest: metres ahead of the eye. */
    landAhead: 5.0,
    /** From the first feathering of the crest back to the touchdown. */
    throwLength: 14,
    /** The touchdown retreats this far toward the eye when the barrel is fully open. */
    openReach: 0.8,
    /** Metres over which the tube relaxes into an unbroken swell ahead of the throw. */
    shoulderBlend: 34,
    /** The swell's hump: how far back its crest stands and how high. */
    swellWidth: 7.4,
    swellHeight: 5.6,
    /** The shoulder loses height with distance, down to this share. */
    taperLength: 110,
    taperFloor: 0.36,
    /** The line bowls toward the viewer's left ahead: metres of offset per metre squared. */
    bowl: 0.0016,
    bowlMax: 22,
    /** The sea in front of the wave reaches this far (the far rows are exponentially spaced). */
    floorFar: 700,
    floorCurve: 5.2,
    /** The mesh runs from this far behind the eye to this far ahead. */
    backReach: 4,
    aheadReach: 1100,
});

/**
 * The flow, in the frame that rides with the wave: water is drawn up the face (+u, metres of
 * surface a second) and the tube comes toward the eye (+z). Slow motion: about a seventh of
 * the real thing.
 */
export const FLOW = Object.freeze({ u: 1.05, z: 0.8 });
export const FLOW_SPEED = Math.hypot(FLOW.u, FLOW.z);

/** Where the lip touches down: metres ahead of the eye (negative: behind it). */
export function landingDistance(open = 0) {
    return WAVE.landAhead - WAVE.openReach * clamp01(open);
}

/** Where the crest starts to feather. */
export function crestDistance(open = 0) {
    return landingDistance(open) + WAVE.throwLength;
}

/** How far round the section the lip reaches (radians) at a distance ahead. */
export function lipAngle(d, open = 0) {
    const t = clamp01((crestDistance(open) - d) / WAVE.throwLength);
    return WAVE.lipCrest + (WAVE.lipClosed - WAVE.lipCrest) * t ** WAVE.lipPower;
}

/** 0 in the tube, 1 where the wave is an unbroken swell. */
export function shoulderWeight(d, open = 0) {
    const start = crestDistance(open) - 2;
    return smooth(start, start + WAVE.shoulderBlend, d);
}

/** The section's size at a distance (1 in the tube). */
export function sectionScale(d, open = 0) {
    const start = crestDistance(open);
    return 1 - (1 - WAVE.taperFloor) * smooth(start, start + WAVE.taperLength, d);
}

/** The x of the foot of the face at a distance: the line bowls to the left ahead. */
export function axisOffset(d) {
    const ahead = Math.max(0, d - 6);
    return -Math.min(WAVE.bowlMax, WAVE.bowl * ahead * ahead);
}

/** x of a trough row: 0 at the foot of the face, −floorFar at r = −1. */
export function floorX(r) {
    const t = clamp01(-r);
    return -WAVE.floorFar * ((Math.exp(WAVE.floorCurve * t) - 1) / (Math.exp(WAVE.floorCurve) - 1));
}

/** The row parameter (≤ 0) of a point x metres in front of the foot of the face. */
export function floorRow(x) {
    const t = Math.log(1 + (clamp(-x, 0, WAVE.floorFar) / WAVE.floorFar) * (Math.exp(WAVE.floorCurve) - 1))
        / WAVE.floorCurve;
    return -t;
}

/**
 * A point of the still wave (no swell, no wobble): the shape events are aimed at.
 * @returns {{x:number,y:number,z:number}}
 */
export function wavePoint(r, d, open = 0, out = { x: 0, y: 0, z: 0 }) {
    const xc = axisOffset(d);
    out.z = -d;
    if (r <= 0) {
        out.x = xc + floorX(r);
        out.y = 0;
        return out;
    }
    const rr = Math.min(1, r);
    const phi = rr * lipAngle(d, open);
    const w = shoulderWeight(d, open);
    const h = sectionScale(d, open);
    const xt = WAVE.a * Math.sin(phi);
    const yt = WAVE.b * (1 - Math.cos(phi));
    const xs = rr * WAVE.swellWidth;
    const ys = WAVE.swellHeight * 0.5 * (1 - Math.cos(Math.PI * rr));
    out.x = xc + lerp(xt, xs, w) * h;
    out.y = lerp(yt, ys, w) * h;
    return out;
}

/** The surface coordinate a row has at a distance: metres from the foot of the face. */
export function surfaceU(r, d, open = 0) {
    return r <= 0 ? floorX(r) : Math.min(1, r) * lipAngle(d, open) * WAVE.rho;
}

/** The row at a surface coordinate (the inverse of surfaceU; may exceed 1 past the lip). */
export function rowAtU(u, d, open = 0) {
    return u <= 0 ? floorRow(u) : u / (lipAngle(d, open) * WAVE.rho);
}

/**
 * The surface coordinate nearest a point in the world (the tube's own section, as castRay
 * treats it): the trough's x for a point on the water, the arc's metres for one up the wall.
 */
export function surfaceAt(x, y, z) {
    const xc = axisOffset(-z);
    // The trough lies in front of the foot of the face only: a point low on the face is on the arc.
    if (y < 0.12 && x - xc <= 0) return x - xc;
    let phi = Math.atan2((x - xc) / WAVE.a, (WAVE.b - y) / WAVE.b);
    if (phi < 0) phi += TAU;
    return phi * WAVE.rho;
}

/**
 * Where a ray meets the wave, treating it as the tube it is near the viewer (an elliptic pipe
 * on a flat trough). Rays that leave through the opening are followed to the sea in front of
 * the wave, or, when they climb into the sky, stopped at the lip's edge.
 *
 * @returns {{ kind: 'floor'|'wall'|'lip', u: number, z: number, d: number, r: number, t: number,
 *             x: number, y: number }}
 */
export function castRay(ox, oy, oz, dx, dy, dz, open = 0, out = {}) {
    const { a, b } = WAVE;
    let t = 60;
    let phi = 0;
    let xc = axisOffset(-oz);
    let missed = false;
    // Three rounds: each uses the section at the distance the one before it found.
    for (let round = 0; round < 3; round += 1) {
        const px = (ox - xc) / a;
        const py = (oy - b) / b;
        const rx = dx / a;
        const ry = dy / b;
        const A = Math.max(1e-9, rx * rx + ry * ry);
        const B = 2 * (px * rx + py * ry);
        const C = px * px + py * py - 1;
        const disc = B * B - 4 * A * C;
        t = disc > 0 ? (-B + Math.sqrt(disc)) / (2 * A) : 60;
        missed = !(disc > 0) || !(t > 0) || !(t < 1e4);
        if (missed) t = 60;
        const hx = (ox + dx * t - xc) / a;
        const hy = (oy + dy * t - b) / b;
        phi = Math.atan2(hx, -hy);
        if (phi < 0) phi += TAU;
        xc = axisOffset(-(oz + dz * t));
    }
    const tFloor = dy < -1e-6 ? -oy / dy : Infinity;
    if (missed && !(tFloor < t)) {
        // A ray that never meets the pipe (one straight down the line, or one that runs out past
        // where the line bowls away) is given the lip's edge where it passes the far crest.
        const far = crestDistance(open);
        const reach = dz < -1e-6 && far + oz > 0 ? (far + oz) / -dz : t;
        const z = oz + dz * reach;
        const edge = wavePoint(1, -z, open);
        out.kind = 'lip';
        out.t = reach;
        out.x = edge.x;
        out.y = edge.y;
        out.z = z;
        out.d = -z;
        out.u = lipAngle(-z, open) * WAVE.rho;
        out.r = 1;
        return out;
    }
    if (tFloor < t) {
        const z = oz + dz * tFloor;
        const x = ox + dx * tFloor;
        const u = Math.min(0, x - axisOffset(-z));
        out.kind = 'floor';
        out.t = tFloor;
        out.x = x;
        out.y = 0;
        out.z = z;
        out.d = -z;
        out.u = u;
        out.r = floorRow(u);
        return out;
    }
    const z = oz + dz * t;
    const d = -z;
    const lip = lipAngle(d, open);
    if (phi <= lip) {
        out.kind = 'wall';
        out.t = t;
        out.x = ox + dx * t;
        out.y = oy + dy * t;
        out.z = z;
        out.d = d;
        out.u = phi * WAVE.rho;
        out.r = phi / lip;
        return out;
    }
    if (dy < -1e-6) {
        // Out through the opening and down: the sea in front of the wave.
        const zf = oz + dz * tFloor;
        const xf = ox + dx * tFloor;
        const u = Math.min(0, xf - axisOffset(-zf));
        out.kind = 'floor';
        out.t = tFloor;
        out.x = xf;
        out.y = 0;
        out.z = zf;
        out.d = -zf;
        out.u = u;
        out.r = floorRow(u);
        return out;
    }
    // Into the sky: the lip's edge at that distance is the nearest water.
    const edge = wavePoint(1, d, open);
    out.kind = 'lip';
    out.t = t;
    out.x = edge.x;
    out.y = edge.y;
    out.z = z;
    out.d = d;
    out.u = lip * WAVE.rho;
    out.r = 1;
    return out;
}

// ── Noise ───────────────────────────────────────────────────────────────────────────────────

/**
 * A tileable field for the water, as bytes (RGBA8):
 *   R, G  the slope of a five-octave height field (d/du, d/dv around 0.5): one fetch gives a
 *         ripple normal, and the mip chain averages it correctly;
 *   B     the height itself (foam, lace, caustics);
 *   A     a second, independent height (breaks up everything that would otherwise repeat).
 */
export function bakeWaterNoise(size = 256, seed = 20261009) {
    const rand = mulberry32(seed);
    const field = (octaves) => {
        const out = new Float32Array(size * size);
        let amp = 1;
        let total = 0;
        for (let o = 0; o < octaves; o += 1) {
            const cells = 4 * 2 ** o;
            const lattice = new Float32Array(cells * cells);
            for (let i = 0; i < lattice.length; i += 1) lattice[i] = rand();
            for (let j = 0; j < size; j += 1) {
                const y = (j / size) * cells;
                const y0 = Math.floor(y);
                const fy = y - y0;
                const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
                const j0 = y0 % cells;
                const j1 = (j0 + 1) % cells;
                for (let i = 0; i < size; i += 1) {
                    const x = (i / size) * cells;
                    const x0 = Math.floor(x);
                    const fx = x - x0;
                    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
                    const i0 = x0 % cells;
                    const i1 = (i0 + 1) % cells;
                    const p = lattice[j0 * cells + i0];
                    const q = lattice[j0 * cells + i1];
                    const s = lattice[j1 * cells + i0];
                    const w = lattice[j1 * cells + i1];
                    out[j * size + i] += (p + (q - p) * sx + (s - p) * sy + (p - q - s + w) * sx * sy) * amp;
                }
            }
            total += amp;
            amp *= 0.55;
        }
        for (let i = 0; i < out.length; i += 1) out[i] /= total;
        return out;
    };
    const h = field(5);
    const h2 = field(4);
    const data = new Uint8Array(size * size * 4);
    const wrap = (n) => (n + size) % size;
    // Slopes in height per texel; scaled so the steepest lands near the ends of the byte range.
    let peak = 1e-6;
    const gx = new Float32Array(size * size);
    const gy = new Float32Array(size * size);
    for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < size; i += 1) {
            const at = j * size + i;
            gx[at] = (h[j * size + wrap(i + 1)] - h[j * size + wrap(i - 1)]) * 0.5;
            gy[at] = (h[wrap(j + 1) * size + i] - h[wrap(j - 1) * size + i]) * 0.5;
            peak = Math.max(peak, Math.abs(gx[at]), Math.abs(gy[at]));
        }
    }
    for (let at = 0; at < size * size; at += 1) {
        data[at * 4] = Math.round(clamp01((gx[at] / peak) * 0.5 + 0.5) * 255);
        data[at * 4 + 1] = Math.round(clamp01((gy[at] / peak) * 0.5 + 0.5) * 255);
        data[at * 4 + 2] = Math.round(clamp01((h[at] - 0.5) * 2.1 + 0.5) * 255);
        data[at * 4 + 3] = Math.round(clamp01((h2[at] - 0.5) * 2.1 + 0.5) * 255);
    }
    return data;
}
