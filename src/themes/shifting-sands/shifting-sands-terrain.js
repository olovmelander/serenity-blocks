/**
 * Shifting Sands — the erg: a dune field baked once on the CPU, shaded per pixel on the GPU.
 *
 * Shape (DuneField): a rolling mega-dune swell, transverse barchanoid ridges with a gentle
 * windward slope, a razor crest and a 34° slip face (warped into sinuous crests, broken into
 * crescents whose horns run downwind), and a weaker cross-dune set that fills the gaps. The far
 * field relaxes into a hazy plain so nothing aliases at the horizon.
 *
 * Mesh: a polar grid around the rest camera's foot — columns uniform in azimuth, rows geometric
 * in distance — so vertex density is roughly uniform on screen from the lens to the horizon.
 *
 * Per-vertex bake (once, at build): height, the main ridge phase u and its gradient, the ridge
 * amplitude, the gradient of everything else, the tangent of the horizon toward the suns (one
 * soft-shadow march on a sub-grid, bilinearly filled) and a spice-stain mask.
 *
 * Per pixel: the main ridge's slope is re-evaluated EXACTLY from the interpolated phase, so every
 * crest is razor sharp at any distance (and anti-aliased by the phase footprint); both suns' cast
 * shadows come from the horizon tangent (the suns sit ~6° apart in elevation: slopes between the
 * two horizons are lit by the companion alone — coloured double shadows); wind ripples, grain
 * glitter, the backlit forward-scatter sheen, spice stains, and the shared aerial perspective.
 *
 * The worm writes itself into the sand through three small uniform sets: its sign (a travelling
 * mound with a collapsing wake), a ground wave per breach, and the wells — the sand around each
 * foot of the arch, which domes, bursts into a rim, slumps and craters. The wells displace the
 * grid, but their slope is re-evaluated per pixel like the ridges, so a rim still catches the low
 * sun where the grid is too coarse to carry it.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    atan,
    attribute,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    reflect,
    smoothstep,
    uniformArray,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import {
    mulberry32, ssHash21, ssHash22, ssTexNoise,
} from './shifting-sands-tsl.js';

// ── Dune profile ────────────────────────────────────────────────────────────────

/** Ridge wavelength (world units), crest position in the phase, slope exponents. */
export const DUNE = Object.freeze({
    lambda: 250,
    crest: 0.68,
    expWindward: 1.6,
    expLee: 1.45,
});

/** Height fraction of the ridge profile at phase p ∈ [0, 1). */
export function ridgeProfile(p) {
    const c = DUNE.crest;
    if (p < c) return (p / c) ** DUNE.expWindward;
    return (1 - (p - c) / (1 - c)) ** DUNE.expLee;
}

/** d(profile)/dp at phase p. */
export function ridgeSlope(p) {
    const c = DUNE.crest;
    if (p < c) return (DUNE.expWindward / c) * (p / c) ** (DUNE.expWindward - 1);
    const q = (p - c) / (1 - c);
    return -(DUNE.expLee / (1 - c)) * (1 - q) ** (DUNE.expLee - 1);
}

const smooth01 = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

// ── DuneField (CPU) ─────────────────────────────────────────────────────────────

const TABLE = 256;

export class DuneField {
    /**
     * @param {object} [opts]
     * @param {number} [opts.seed]
     * @param {{x:number, z:number}} [opts.wind]  unit downwind direction in the ground plane
     * @param {{x:number, z:number}} [opts.offset] sampling offset (chooses the view of the erg)
     */
    constructor({ seed = 20261001, wind = { x: -0.454, z: -0.891 }, offset = { x: 0, z: 0 } } = {}) {
        const rand = mulberry32(seed);
        this.table = new Float32Array(TABLE * TABLE);
        for (let i = 0; i < this.table.length; i++) this.table[i] = rand();
        const wl = Math.hypot(wind.x, wind.z) || 1;
        this.wx = wind.x / wl;
        this.wz = wind.z / wl;
        // Cross dunes: the wind direction rotated by +68°.
        const ca = Math.cos((68 * Math.PI) / 180);
        const sa = Math.sin((68 * Math.PI) / 180);
        this.w2x = this.wx * ca - this.wz * sa;
        this.w2z = this.wx * sa + this.wz * ca;
        this.ox = offset.x;
        this.oz = offset.z;
        /** Optional (x, z) → height of solid features (rock), for the shadow march. */
        this.extraHeight = null;
        this.scratch = {
            h: 0, u: 0, amp: 0, base: 0, spice: 0,
        };
    }

    /** Smooth value noise in [0, 1]. */
    noise(x, z) {
        const xi = Math.floor(x);
        const zi = Math.floor(z);
        let fx = x - xi;
        let fz = z - zi;
        fx = fx * fx * (3 - 2 * fx);
        fz = fz * fz * (3 - 2 * fz);
        const T = this.table;
        const i0 = xi & 255;
        const i1 = (xi + 1) & 255;
        const j0 = (zi & 255) << 8;
        const j1 = ((zi + 1) & 255) << 8;
        const a = T[j0 + i0];
        const b = T[j0 + i1];
        const c = T[j1 + i0];
        const d = T[j1 + i1];
        return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    }

    /**
     * Full sample at world (x, z). Fills and returns `out`:
     *   h: height, u: main ridge phase, amp: main ridge amplitude, base: h − main ridge,
     *   spice: spice-stain mask in [0, 1].
     */
    sample(x0, z0, out = this.scratch, cheap = false) {
        const x = x0 + this.ox;
        const z = z0 + this.oz;
        const a = x * this.wx + z * this.wz; // downwind
        const b = -x * this.wz + z * this.wx; // along the crests
        const r = Math.hypot(x0, z0);

        // Mega-dune swell (draa).
        const mega = (this.noise(x / 2100 + 3.7, z / 2100 - 1.3) * 0.68
            + this.noise(x / 900 + 9.2, z / 900 + 4.1) * 0.32 - 0.5) * 2 * 30;

        // Sinuous crest lines.
        let warp = (this.noise(b / 560 + 5.1, a / 1150 + 2.3) - 0.5) * 2 * 100;
        if (!cheap) warp += (this.noise(b / 190 - 4.4, a / 340 + 9.1) - 0.5) * 2 * 30;

        // Crescents: crest segments break apart; the weak tips (horns) migrate downwind.
        const brk = this.noise(b / 270 + 1.7, a / (DUNE.lambda * 1.35) + 0.4);
        const crestMask = smooth01(0.2, 0.58, brk);
        const ampN = smooth01(0.15, 0.85, this.noise(b / 600 + 11.3, a / 1000 - 7.7));
        const fadeMain = 1 - smooth01(3200, 6500, r);
        const amp = 37 * (0.4 + 0.6 * ampN) * (0.28 + 0.72 * crestMask) * fadeMain;
        const u = (a + warp - 44 * (1 - crestMask)) / DUNE.lambda;
        const p = u - Math.floor(u);
        const main = amp * ridgeProfile(p);

        // Cross dunes (weaker, where the main crests break).
        let sec = 0;
        if (!cheap) {
            const a2 = x * this.w2x + z * this.w2z;
            const u2 = (a2 + warp * 0.3) / 92;
            const p2 = u2 - Math.floor(u2);
            const c2 = 0.6;
            const prof2 = p2 < c2 ? (p2 / c2) ** 1.5 : (1 - (p2 - c2) / (1 - c2)) ** 1.35;
            sec = 9 * this.noise(x / 420 - 2.2, z / 420 + 6.6) * (0.35 + 0.65 * (1 - crestMask)) * prof2 * fadeMain;
        }

        const megaFar = mega * (1 - 0.45 * smooth01(5000, 11000, r));
        out.h = megaFar + main + sec;
        out.u = u;
        out.amp = amp;
        out.base = megaFar + sec;
        out.spice = cheap ? 0 : smooth01(0.6, 0.8, this.noise(x / 330 + 21.5, z / 330 - 13.2));
        return out;
    }

    /** Height including solid features (for the shadow march and spawn heights). */
    height(x, z, cheap = false) {
        const { h } = this.sample(x, z, this.scratch, cheap);
        if (this.extraHeight) {
            const e = this.extraHeight(x, z);
            if (e > h) return e;
        }
        return h;
    }
}

// ── Polar grid bake ─────────────────────────────────────────────────────────────

/** Per-tier grid density and the shadow sub-grid stride. */
export const TERRAIN_TIERS = Object.freeze({
    Minimal: {
        rows: 150, cols: 128, shadowStride: 4, shadowSteps: 14,
    },
    Low: {
        rows: 190, cols: 160, shadowStride: 4, shadowSteps: 16,
    },
    Medium: {
        rows: 240, cols: 208, shadowStride: 3, shadowSteps: 18,
    },
    High: {
        rows: 300, cols: 256, shadowStride: 3, shadowSteps: 20,
    },
    Ultra: {
        rows: 360, cols: 320, shadowStride: 2, shadowSteps: 20,
    },
    Extreme: {
        rows: 420, cols: 384, shadowStride: 2, shadowSteps: 22,
    },
});

const GRID = Object.freeze({
    nearDist: 18,
    farDist: 16000,
    halfAngleDeg: 66,
});

/**
 * Bake the terrain geometry.
 * @param {DuneField} field
 * @param {object} opts
 * @param {object} opts.tier          TERRAIN_TIERS entry
 * @param {{x:number,y:number,z:number}} opts.shadowDir  unit vector toward the (mean) sun
 * @returns {{ geometry: THREE.BufferGeometry, stats: object }}
 */
export function bakeTerrainGeometry(field, { tier, shadowDir }) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const { rows } = tier;
    const { cols } = tier;
    const n = rows * cols;
    const pos = new Float32Array(n * 3);
    const dune = new Float32Array(n * 4);
    const shade = new Float32Array(n * 4);
    const baseH = new Float32Array(n);
    const uArr = new Float64Array(n);

    const ratio = (GRID.farDist / GRID.nearDist) ** (1 / (rows - 1));
    const halfA = (GRID.halfAngleDeg * Math.PI) / 180;
    const s = field.scratch;
    for (let i = 0; i < rows; i++) {
        const d = GRID.nearDist * ratio ** i;
        for (let j = 0; j < cols; j++) {
            const th = -halfA + (2 * halfA * j) / (cols - 1);
            const x = Math.sin(th) * d;
            const z = -Math.cos(th) * d;
            field.sample(x, z, s);
            const k = i * cols + j;
            pos[k * 3] = x;
            pos[k * 3 + 1] = s.h;
            pos[k * 3 + 2] = z;
            uArr[k] = s.u;
            baseH[k] = s.base;
            dune[k * 4] = s.u;
            dune[k * 4 + 3] = s.amp;
            shade[k * 4 + 3] = s.spice;
        }
    }

    // Gradients of u and of the smooth base from grid neighbours (radial × tangential solve).
    for (let i = 0; i < rows; i++) {
        const i0 = i > 0 ? i - 1 : i;
        const i1 = i < rows - 1 ? i + 1 : i;
        for (let j = 0; j < cols; j++) {
            const j0 = j > 0 ? j - 1 : j;
            const j1 = j < cols - 1 ? j + 1 : j;
            const a = i1 * cols + j;
            const b = i0 * cols + j;
            const c = i * cols + j1;
            const e = i * cols + j0;
            const e1x = pos[a * 3] - pos[b * 3];
            const e1z = pos[a * 3 + 2] - pos[b * 3 + 2];
            const e2x = pos[c * 3] - pos[e * 3];
            const e2z = pos[c * 3 + 2] - pos[e * 3 + 2];
            const det = e1x * e2z - e1z * e2x;
            const k = i * cols + j;
            if (Math.abs(det) < 1e-9) continue;
            const du1 = uArr[a] - uArr[b];
            const du2 = uArr[c] - uArr[e];
            const db1 = baseH[a] - baseH[b];
            const db2 = baseH[c] - baseH[e];
            dune[k * 4 + 1] = (du1 * e2z - du2 * e1z) / det;
            dune[k * 4 + 2] = (e1x * du2 - e2x * du1) / det;
            shade[k * 4] = (db1 * e2z - db2 * e1z) / det;
            shade[k * 4 + 1] = (e1x * db2 - e2x * db1) / det;
        }
    }

    // Horizon tangent toward the suns: one geometric march per sub-grid vertex.
    const stride = Math.max(1, tier.shadowStride | 0);
    const steps = tier.shadowSteps;
    const hl = Math.hypot(shadowDir.x, shadowDir.z) || 1;
    const sx = shadowDir.x / hl;
    const sz = shadowDir.z / hl;
    const subRows = Math.ceil((rows - 1) / stride) + 1;
    const subCols = Math.ceil((cols - 1) / stride) + 1;
    const sub = new Float32Array(subRows * subCols);
    for (let si = 0; si < subRows; si++) {
        const i = Math.min(rows - 1, si * stride);
        for (let sj = 0; sj < subCols; sj++) {
            const j = Math.min(cols - 1, sj * stride);
            const k = i * cols + j;
            const x0 = pos[k * 3];
            const h0 = pos[k * 3 + 1] + 0.6;
            const z0 = pos[k * 3 + 2];
            let maxTan = -0.2;
            if (Math.hypot(x0, z0) < 9000) {
                let t = 4;
                for (let st = 0; st < steps; st++) {
                    const hx = field.height(x0 + sx * t, z0 + sz * t, true);
                    const tn = (hx - h0) / t;
                    if (tn > maxTan) maxTan = tn;
                    t *= 1.42;
                }
            }
            sub[si * subCols + sj] = maxTan;
        }
    }
    for (let i = 0; i < rows; i++) {
        const fi = i / stride;
        const si = Math.min(subRows - 2, Math.floor(fi));
        const ti = Math.min(1, fi - si);
        for (let j = 0; j < cols; j++) {
            const fj = j / stride;
            const sj = Math.min(subCols - 2, Math.floor(fj));
            const tj = Math.min(1, fj - sj);
            const a = sub[si * subCols + sj];
            const b = sub[si * subCols + sj + 1];
            const c = sub[(si + 1) * subCols + sj];
            const d = sub[(si + 1) * subCols + sj + 1];
            shade[(i * cols + j) * 4 + 2] = (a * (1 - tj) + b * tj) * (1 - ti) + (c * (1 - tj) + d * tj) * ti;
        }
    }

    const quads = (rows - 1) * (cols - 1);
    const index = new Uint32Array(quads * 6);
    let w = 0;
    for (let i = 0; i < rows - 1; i++) {
        for (let j = 0; j < cols - 1; j++) {
            const a = i * cols + j;
            const b = a + 1;
            const c = a + cols;
            const d = c + 1;
            // Row i is nearer than row i+1; wind counter-clockwise seen from above.
            index[w++] = a; index[w++] = b; index[w++] = c;
            index[w++] = b; index[w++] = d; index[w++] = c;
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aDune', new THREE.BufferAttribute(dune, 4));
    geometry.setAttribute('aShade', new THREE.BufferAttribute(shade, 4));
    geometry.computeBoundingSphere();
    const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
    return {
        geometry,
        stats: {
            vertices: n, triangles: quads * 2, bakeMs: Math.round((t1 - t0) * 10) / 10,
        },
    };
}

// ── Sand material ───────────────────────────────────────────────────────────────

/** Thumper rings (piece locks) and other ground pulses: (x, z, t0, strength). */
export const GROUND_PULSE_SLOTS = 4;
/** Worms that can mark the sand at once: each owns a sign, a ground wave and two wells. */
export const WORM_GROUND_SLOTS = 2;
/** Wells: where each worm comes up and where it goes down. */
export const WELL_SLOTS = WORM_GROUND_SLOTS * 2;

/**
 * @param {object} shared   the world's shared uniform nodes + atmosphere helpers
 * @param {object} [opts]
 * @param {boolean} [opts.glitter=true]
 * @param {boolean} [opts.ripples=true]
 */
export function createSandMaterial(shared, { glitter = true, ripples = true } = {}) {
    const {
        uTime, uSunA, uSunB, uSunLightA, uSunLightB, uUpper, uZenith, uHorizonCool, atmosphere, noiseTex,
        uWindDir, uWind, uGust,
    } = shared;
    const C = DUNE.crest;
    const EW = DUNE.expWindward;
    const EL = DUNE.expLee;

    // The thumper's slots first, then one ground wave per worm.
    const PULSES = GROUND_PULSE_SLOTS + WORM_GROUND_SLOTS;
    const vec4s = (n, x, y, z, w) => Array.from({ length: n }, () => new THREE.Vector4(x, y, z, w));
    const uPulses = uniformArray(vec4s(PULSES, 0, 0, -100, 0), 'vec4');
    const uSigns = uniformArray(vec4s(WORM_GROUND_SLOTS, 0, 0, 1, 0), 'vec4'); // x, z, wake length, strength
    const uSignDirs = uniformArray(vec4s(WORM_GROUND_SLOTS, 1, 0, 0, 0), 'vec4'); // heading.xz
    const uWells = uniformArray(vec4s(WELL_SLOTS, 0, 0, 40, 20), 'vec4'); // x, z, rim radius, rim width
    const uWellH = uniformArray(vec4s(WELL_SLOTS, 0, 0, 0, 0), 'vec4'); // rim, bulge, crater (heights), scar

    /** The parts of well i at a ground point: shared by the displaced grid and the per-pixel slope. */
    const wellShape = (xz, i) => {
        const W = uWells.element(i);
        const H = uWellH.element(i);
        const rel = xz.sub(W.xy);
        const d = length(rel);
        const n = rel.div(max(d, 1e-3));
        // Thrown sand never lands in a circle: two fixed lobes around the hole.
        const cos3 = n.x.mul(n.x).mul(4.0).sub(3.0).mul(n.x);
        const lobe = cos3.mul(0.2).add(n.x.mul(n.y).mul(0.28)).add(1.0);
        const u = d.sub(W.z).div(W.w);
        const sb = W.z.mul(1.1);
        const sc = W.z.mul(0.8);
        return {
            W,
            H,
            d,
            n,
            u,
            sb,
            sc,
            rim: exp(u.mul(u).negate()).mul(H.x).mul(lobe),
            bulge: exp(d.mul(d).div(sb.mul(sb)).negate()).mul(H.y),
            crater: exp(d.mul(d).div(sc.mul(sc)).negate()).mul(H.z),
        };
    };

    const aDune = attribute('aDune', 'vec4');
    const aShade = attribute('aShade', 'vec4');

    // ── Vertex: ground pulses (thumper rings), the worm signs and the wells ──
    const disp = Fn(() => {
        const p = positionLocal;
        const h = float(0.0).toVar();
        const gx = float(0.0).toVar();
        const gz = float(0.0).toVar();
        // Worm sign: a travelling mound with a collapsing wake behind it (as long as it has run).
        for (let i = 0; i < WORM_GROUND_SLOTS; i++) {
            const S = uSigns.element(i);
            const dir = uSignDirs.element(i).xy;
            const rel = p.xz.sub(S.xy);
            const along = dot(rel, dir);
            const across = dot(rel, vec2(dir.y.negate(), dir.x));
            const lat = exp(across.mul(across).div(-26.0 * 26.0));
            const ahead = exp(along.mul(along).div(-34.0 * 34.0));
            const wake = smoothstep(S.z.negate(), 0.0, along).mul(float(1.0).sub(smoothstep(-10.0, 30.0, along)));
            h.addAssign(ahead.mul(9.0).sub(wake.mul(2.6)).mul(lat).mul(S.w));
            // d/dalong of the mound (dominant) along the heading.
            const dAlong = ahead.mul(along).mul(-2.0 / (34.0 * 34.0)).mul(9.0).mul(lat)
                .mul(S.w);
            gx.addAssign(dAlong.mul(dir.x));
            gz.addAssign(dAlong.mul(dir.y));
        }
        // Thumper waves: a low swell of sand running out from each beat (and each worm strike).
        for (let i = 0; i < PULSES; i++) {
            const P = uPulses.element(i);
            const age = uTime.sub(P.z);
            const d = length(p.xz.sub(P.xy));
            const x = d.sub(age.mul(260.0)).div(14.0);
            const env = exp(age.mul(-1.3)).mul(smoothstep(0.0, 0.05, age)).mul(P.w);
            h.addAssign(exp(x.mul(x).negate()).mul(env).mul(0.8));
        }
        // Wells: the sand heaved, rimmed and cratered where a body pierces the surface.
        for (let i = 0; i < WELL_SLOTS; i++) {
            const well = wellShape(p.xz, i);
            h.addAssign(well.rim.add(well.bulge).sub(well.crater));
        }
        return vec3(h, gx, gz);
    })();
    const vDispGrad = vertexStage(disp.yz);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'shifting-sands-dunes';
    material.fog = false;
    material.positionNode = positionLocal.add(vec3(0.0, disp.x, 0.0));

    material.colorNode = Fn(() => {
        const wp = positionWorld;
        const V = normalize(cameraPosition.sub(wp)).toVar();
        const dist = length(cameraPosition.sub(wp)).toVar();

        // ── Exact ridge slope from the interpolated phase ──
        const u = aDune.x;
        const p = fract(u);
        const fwu = fwidth(u);
        const w = clamp(fwu.mul(0.75), 0.004, 0.3);
        const pw = clamp(p, 0.0, C);
        const q = clamp(p, C, 1.0).sub(C).div(1.0 - C);
        const crestT = smoothstep(float(C).sub(w), float(C).add(w), p);
        const slopeW = pow(pw.div(C).add(1e-4), EW - 1).mul(EW / C);
        const slopeL = pow(float(1.0).sub(q).add(1e-4), EL - 1).mul(-EL / (1 - C));
        const dprof = mix(slopeW, slopeL, crestT);
        const prof = mix(pow(pw.div(C), EW), pow(float(1.0).sub(q), EL), crestT);
        const detail = float(1.0).sub(smoothstep(0.22, 0.6, fwu));
        const grad = aShade.xy.add(vDispGrad).add(aDune.yz.mul(dprof.mul(aDune.w).mul(detail))).toVar();
        const nz = ssTexNoise(noiseTex, wp.xz.mul(0.035)).toVar();

        // ── Wells: the exact slope of the heaved sand, and the scar of churned sand around it ──
        // (rays of thrown sand; no ripples, no glitter until the wind has written them back)
        const scar = float(0.0).toVar();
        const scarTone = float(1.0).toVar();
        for (let i = 0; i < WELL_SLOTS; i++) {
            const well = wellShape(wp.xz, i);
            If(well.H.w.greaterThan(0.002).and(well.d.lessThan(well.W.z.mul(3.4))), () => {
                const slope = well.rim.mul(well.u.mul(-2.0).div(well.W.w))
                    .add(well.bulge.mul(well.d.mul(-2.0).div(well.sb.mul(well.sb))))
                    .sub(well.crater.mul(well.d.mul(-2.0).div(well.sc.mul(well.sc))));
                grad.addAssign(well.n.mul(slope));
                const rays = ssTexNoise(noiseTex, vec2(
                    atan(well.n.y, well.n.x).mul(5.1).add(i * 3.7),
                    well.d.div(well.W.z).mul(0.9),
                ));
                const reach = well.d.div(well.W.z.mul(mix(1.25, 2.3, rays.x)));
                const here = exp(reach.mul(reach).negate()).mul(well.H.w);
                scarTone.assign(mix(scarTone, mix(0.84, 1.1, rays.y), here));
                scar.assign(max(scar, here));
            });
        }

        // ── Wind ripples (transverse, asymmetric), off the slip faces, faded by footprint ──
        if (ripples) {
            // Ripples bend with a fine warp (tuning-fork junctions where the warp folds) and
            // their wavelength breathes, so they read as wind-written sand, not corduroy.
            const nr = ssTexNoise(noiseTex, wp.xz.mul(0.19).add(vec2(nz.x.mul(2.0), 7.3)));
            const rDir = normalize(uWindDir.add(vec2(uWindDir.y.negate(), uWindDir.x).mul(nz.y.sub(0.5).mul(0.7))));
            const rc = dot(wp.xz, rDir).add(nz.x.mul(6.0)).add(nr.x.mul(2.2)).div(mix(0.75, 1.15, nz.w));
            const rf = fract(rc);
            const rSlope = mix(float(0.55), float(-1.6), smoothstep(0.62, 0.78, rf))
                .mul(float(1.0).sub(smoothstep(0.88, 1.0, rf)));
            const rFade = float(1.0).sub(smoothstep(0.08, 0.32, fwidth(rc)));
            const rMask = float(1.0).sub(crestT).mul(smoothstep(0.02, 0.15, p))
                .mul(smoothstep(0.25, 0.75, nr.y.mul(0.6).add(nz.z.mul(0.4))))
                .mul(float(1.0).sub(scar));
            grad.addAssign(rDir.mul(rSlope.mul(0.075).mul(rFade).mul(rMask)));
        }
        const N = normalize(vec3(grad.x.negate(), 1.0, grad.y.negate())).toVar();

        // ── Sun visibility: horizon tangent vs each sun's elevation tangent ──
        const hz = aShade.z;
        const tanA = uSunA.y.div(length(uSunA.xz));
        const tanB = uSunB.y.div(length(uSunB.xz));
        const visA = smoothstep(-0.045, 0.035, tanA.sub(hz));
        const visB = smoothstep(-0.035, 0.03, tanB.sub(hz));
        const nlA = dot(N, uSunA);
        const nlB = dot(N, uSunB);
        // Sand: a lifted, compressed Lambert (Journey) so grazing faces still read as lit.
        const dA = clamp(nlA.mul(2.6), 0.0, 1.0).mul(visA);
        const dB = clamp(nlB.mul(2.4), 0.0, 1.0).mul(visB);

        // ── Albedo ──
        const sand = vec3(0.8, 0.42, 0.19).mul(mix(0.88, 1.1, nz.w)).toVar();
        sand.assign(mix(sand.mul(vec3(0.84, 0.74, 0.7)), sand, smoothstep(0.0, 0.35, prof)));
        sand.assign(mix(sand, sand.mul(1.08).add(vec3(0.03, 0.02, 0.01)), prof.mul(prof).mul(0.8)));
        const spice = aShade.w.mul(smoothstep(0.35, 0.75, nz.y));
        sand.assign(mix(sand, vec3(0.62, 0.21, 0.07), spice.mul(0.75)));
        // Sand turned up from below is duller and cooler than the wind-polished surface.
        sand.mulAssign(mix(vec3(1.0, 1.0, 1.0), vec3(0.92, 0.94, 1.0).mul(scarTone), scar));

        // ── Light ──
        const ao = mix(0.58, 1.0, smoothstep(0.0, 0.45, prof)).mul(mix(0.85, 1.0, smoothstep(-0.2, 0.5, N.y)));
        // Shadows are lit by the violet-blue sky, so they turn cool against the gold.
        const skyFill = mix(uHorizonCool.mul(0.55), uUpper.mul(1.1).add(uZenith.mul(0.9)), N.y.mul(0.5).add(0.5));
        const bounce = uSunLightA.mul(0.03).mul(float(1.0).sub(N.y).add(0.2));
        // The bright horizon toward the suns lights sun-facing slopes even inside a shadow.
        const sunward = clamp(dot(normalize(vec2(N.x, N.z).add(vec2(1e-4, 0.0))), normalize(uSunA.xz)), 0.0, 1.0)
            .mul(float(1.0).sub(N.y).mul(2.0).add(0.15));
        const horizonFill = uSunLightA.mul(0.085).mul(sunward);
        const direct = uSunLightA.mul(dA).add(uSunLightB.mul(dB));
        const col = sand.mul(direct.add(skyFill.add(bounce).add(horizonFill).mul(ao))).toVar();

        // Backlit forward-scatter sheen: grazing sand toward the suns glows (the Journey look).
        const fresnel = pow(float(1.0).sub(clamp(dot(N, V), 0.0, 1.0)), 4.0);
        const R = reflect(V.negate(), N);
        const specA = pow(clamp(dot(R, uSunA), 0.0, 1.0), 28.0).mul(visA).mul(smoothstep(-0.05, 0.12, nlA));
        const specB = pow(clamp(dot(R, uSunB), 0.0, 1.0), 40.0).mul(visB).mul(smoothstep(-0.05, 0.12, nlB));
        const fwd = pow(clamp(dot(V.negate(), uSunA), 0.0, 1.0), 6.0).mul(fresnel).mul(max(visA, visB.mul(0.6)));
        col.addAssign(uSunLightA.mul(specA.mul(fresnel.mul(0.75).add(0.05)).add(fwd.mul(0.13))));
        col.addAssign(uSunLightB.mul(specB.mul(fresnel.mul(0.7).add(0.05))));
        // Contre-jour crest glow: the brink of every ridge between the camera and the suns burns.
        const brink = exp(p.sub(C).div(w.mul(1.5).add(0.018)).pow(2.0).negate())
            .mul(aDune.w.div(37.0)).mul(detail.mul(0.7).add(0.3));
        const backlit = pow(clamp(dot(V.negate(), uSunA).mul(0.5).add(0.5), 0.0, 1.0), 5.0);
        col.addAssign(uSunLightA.mul(brink.mul(backlit).mul(max(visA, visB.mul(0.5))).mul(0.55)));

        // ── Grain glitter: a sub-pixel dot per world cell with a random facet ──
        if (glitter) {
            const gc = wp.xz.mul(3.0);
            const cell = floor(gc);
            const h2 = ssHash22(cell);
            const fwg = fwidth(gc.x);
            const dotDist = length(fract(gc).sub(h2.mul(0.7).add(0.15)));
            const dotM = float(1.0).sub(smoothstep(fwg.mul(0.5), fwg.mul(1.5), dotDist));
            const facet = normalize(N.add(vec3(h2.x.sub(0.5), 0.15, h2.y.sub(0.5)).mul(1.4)));
            const H = normalize(V.add(uSunA));
            const g = pow(clamp(dot(facet, H), 0.0, 1.0), 420.0);
            const pick = smoothstep(0.55, 0.6, ssHash21(cell.add(17.3)));
            const near = float(1.0).sub(smoothstep(40.0, 320.0, dist)).mul(float(1.0).sub(scar));
            const tint = mix(vec3(1.0, 0.86, 0.62), vec3(1.0, 0.55, 0.2), spice);
            col.addAssign(tint.mul(uSunLightA).mul(g.mul(dotM).mul(pick).mul(near).mul(visA)
                .mul(9.0)));
        }

        // ── Thumper rings: each lock sends a ring of lifted sand across the erg ──
        const ringSum = float(0.0).toVar();
        for (let i = 0; i < PULSES; i++) {
            const P = uPulses.element(i);
            const age = uTime.sub(P.z);
            const front = age.mul(260.0);
            const d = length(wp.xz.sub(P.xy));
            const x = d.sub(front).div(mix(5.0, 16.0, clamp(age.mul(0.6), 0.0, 1.0)));
            const fade = exp(age.mul(-1.15)).mul(smoothstep(0.0, 0.05, age)).mul(P.w);
            // A bright crest of lifted sand and a faint dark trough behind it.
            ringSum.addAssign(exp(x.mul(x).negate()).sub(exp(x.add(1.8).mul(x.add(1.8)).negate()).mul(0.12)).mul(fade));
        }
        // Lifted grains catch the low sun: a golden crest, brightest where the suns can reach.
        const ringLight = uSunLightA.mul(max(visA, 0.45)).mul(0.22).add(vec3(0.12, 0.07, 0.03));
        col.addAssign(mix(vec3(1.0, 0.78, 0.48), vec3(1.0, 0.55, 0.22), spice).mul(ringLight).mul(ringSum));

        // ── Blowing sand: sheets of saltating grains streaming downwind over the surface ──
        const along = dot(wp.xz, uWindDir);
        const across = dot(wp.xz, vec2(uWindDir.y.negate(), uWindDir.x));
        const flow = uTime.mul(uWind.mul(26.0).add(uGust.mul(40.0)).add(6.0));
        const sheet = ssTexNoise(noiseTex, vec2(along.sub(flow).mul(0.018), across.mul(0.09)));
        const sheetMask = smoothstep(0.55, 0.85, sheet.x.mul(0.7).add(sheet.y.mul(0.3)))
            .mul(float(1.0).sub(smoothstep(250.0, 1400.0, dist)))
            .mul(smoothstep(0.1, 0.6, p).mul(float(1.0).sub(crestT.mul(0.6))))
            .mul(uWind.mul(0.6).add(uGust.mul(1.2)));
        const sheetCol = uSunLightA.mul(max(visA, 0.35)).mul(0.08).add(uSunLightA.mul(fwd.mul(0.18)));
        col.addAssign(sheetCol.mul(sheetMask));

        // ── Aerial perspective ──
        return vec4(atmosphere.applyAerial(col, wp), 1.0);
    })();

    return {
        material,
        uniforms: {
            uPulses, uSigns, uSignDirs, uWells, uWellH,
        },
    };
}

/**
 * The terrain object: bake + material + mesh.
 */
export function createTerrain({
    field, shared, tierName = 'High', shadowDir,
}) {
    const tier = TERRAIN_TIERS[tierName] || TERRAIN_TIERS.High;
    const { geometry, stats } = bakeTerrainGeometry(field, { tier, shadowDir });
    const { material, uniforms } = createSandMaterial(shared, {
        glitter: tierName !== 'Minimal',
        ripples: tierName !== 'Minimal',
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-dunes';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return {
        mesh,
        material,
        uniforms,
        stats,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
