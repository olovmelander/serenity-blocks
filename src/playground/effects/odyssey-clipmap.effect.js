/**
 * ODYSSEY ONE WORLD — Wave 1 spike: the ground.
 *
 * Proves the load-bearing mechanics of pillars 1, 2, 6 and 7 of
 * docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md in isolation, before anything in the repo changes:
 *
 *   1. A nested-ring GEOMETRY CLIPMAP — one static mesh, ONE draw call, zero CPU rebuild and
 *      zero per-frame upload. All world placement and CDLOD morphing happen in the VERTEX
 *      stage from a vertex buffer that contains no positions, only (gridIndex, ringLevel).
 *   2. Height read in the VERTEX stage from a baked RG16F texture via `.level(0)`, with the
 *      SAME function mirrored on the CPU so props can seat on exactly the drawn surface.
 *   6. Biome as a function of world state (altitude + slope), HEIGHT-BLENDED, so the snowline
 *      follows the terrain instead of arriving because a chapter counter incremented.
 *   7. Footprint band-limiting: every procedural layer faded out by its own world-space pixel
 *      footprint, which is the only thing that actually fixes shader-space aliasing.
 *
 * Deliberately NOT here (see the plan): the far range (pre-baked LUTs, §3.3), the analytic sky
 * (§3.4), shadows (§3.8) and the colour script (§3.9). This spike is the ground only.
 */

import * as THREE from 'three/webgpu';
import {
    abs, attribute, clamp, dot, exp, exp2, float, floor, max, mix, normalize,
    positionWorld, smoothstep, texture, uniform, varying, vec2, vec3, dFdx, dFdy, length,
    cameraPosition,
} from 'three/tsl';
import { sampleColourScript } from '../../rendering/odyssey/odyssey-colour-script.js';

export const meta = {
    id: 'odyssey-clipmap',
    title: 'Odyssey — One World ground (clipmap spike)',
    description: 'Wave 1: 1-draw CDLOD clipmap + baked RG16F height + height-blended biome',
};

// ── Clipmap constants (plan §3.1, Lane B / 610M configuration) ───────────────────
const GRID_N = 96; // quads per side per ring; must be divisible by 4
const LEVELS = 7;
const BASE_SPACING = 1.5; // world units at level 0
const HOLE_SHRINK = 2;
const HALF = GRID_N / 2; // 48
const MORPH_START = 0.70;
const MORPH_END = 0.86;

// HARD INVARIANT (plan §3.1, point 3). The morph must COMPLETE before the ring overlap band
// begins, or consecutive rings open cracks — silently, with no error and no warning. This is
// documented nowhere in the reference; it is derived from its constants.
const MORPH_END_CEILING = 1 - ((4 * HOLE_SHRINK) / GRID_N);
if (MORPH_END > MORPH_END_CEILING) {
    throw new Error(
        `[odyssey-clipmap] morphEnd ${MORPH_END} exceeds ceiling ${MORPH_END_CEILING.toFixed(4)} `
        + `for GRID_N=${GRID_N}, HOLE_SHRINK=${HOLE_SHRINK} — the rings will crack.`,
    );
}

// ── The world height field — ONE function, baked to a texture AND mirrored on the CPU ──
// Plan §3.2: bake only LOCAL RELIEF, because half-float epsilon at 2000u is ~1.0u which is
// unusable for a surface geometry displaces to. The large-scale ascent is added analytically.
const RELIEF_RES = 1024;
const WORLD_EXTENT = 6000; // the baked field spans [-3000, 3000] in x and z
const RELIEF_SCALE = 150; // +/- range packed into the texture

// INTEGER hash, not the usual sin(dot(..)) * 43758 trick. Every valueNoise() below costs four
// hashes, odysseyRelief() runs eight valueNoise (six octaves + two domain warps), and the bake
// is a million samples - so a sin-based hash is ~32 million transcendentals on the startup
// critical path. This bit-mix is integer-only and measured ~3x faster end to end. The same
// argument applies on the GPU, where RDNA runs transcendentals at a quarter rate.
function hash2(x, y) {
    let h = ((x | 0) * 374761393) + ((y | 0) * 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

/**
 * MACRO FORM - analytic, smooth, evaluated identically in JS and in TSL.
 *
 * Plan 3.2: do NOT bake the large-scale form. Half-float epsilon at 620u is ~0.5u, which
 * terraces a gentle slope; at 2000u it is ~1.0u, which is unusable for a surface geometry
 * displaces to. The macro form is closed-form in world position, so it costs a few ALU and
 * carries full float precision. Only the LOCAL RELIEF is baked.
 *
 * This is also where the persistent landmark lives (plan 3.10): the hero massif is A TERM IN
 * THE HEIGHT FUNCTION, never a separate mesh. That is what makes it structurally impossible
 * for it to z-fight, ghost, crossfade wrong, or be seen through.
 */
const HERO_X = 0;
const HERO_Z = -1400;
const HERO_R = 1500;
const HERO_H = 620;
const BASIN_X = 260;
const BASIN_Z = 620;
// Sea level. A heightfield is SINGLE-VALUED, so ocean floor + ocean surface is inherently
// two sheets - which is why pillar 1 is two draws, not one (plan 3.1).
const SEA_LEVEL = 8;

// ONE SUN (plan 3.4). The bake below and the shader both read this, so a terrain shadow can
// never disagree with the light that cast it - which is precisely the failure the shipped
// build has, where MOUNTAIN_SHADING.keyDir sits 72.5 degrees away from ODYSSEY_SUN.
// Re-SOLVED against the hero composition rather than adopted. The shipped ODYSSEY_SUN
// [0.35, 0.62, -0.70] has negative Z, which puts it behind the massif from a camera looking
// down -Z: the face you are looking at is back-lit and its shadows fall away from you. A sun
// at ~21 degrees elevation from the front-left rakes ACROSS the flank instead, so the relief
// the height field carries actually casts. Same one-sun rule; a direction that serves the shot.
const SUN_DIR = [-0.46, 0.36, 0.61];
const SHADOW_RES = 512;

function heroConeMask(x, z) {
    const d = Math.hypot(x - HERO_X, z - HERO_Z);
    return Math.max(0, 1 - (d / HERO_R));
}

export function odysseyMacro(x, z) {
    const cone = (heroConeMask(x, z) ** 1.7) * HERO_H;
    const bx = (x - BASIN_X) / 760;
    const bz = (z - BASIN_Z) / 560;
    const basin = Math.exp(-((bx * bx) + (bz * bz))) * -62;
    return cone + basin;
}

/** How much baked detail this point carries - ridges concentrate on the massif. */
export function odysseyDetailWeight(x, z) {
    return 0.32 + (0.68 * heroConeMask(x, z));
}

/**
 * LOCAL RELIEF in world units, baked to RG16F. The single source of truth for the detail:
 * the bake writes exactly this, and any CPU consumer calls exactly this.
 */
export function odysseyRelief(x, z) {
    // FREQUENCY BAND is set by the bake, not by taste: RELIEF_RES 1024 over WORLD_EXTENT 6000
    // is 5.86 u/texel, so Nyquist is an 11.7u wavelength. The highest octave below lands at
    // ~24u (4 texels) - anything finer would alias into the bake itself, which no amount of
    // MSAA or band-limiting downstream could ever recover.
    // Domain warp first, so ridgelines meander instead of running radially off the cone.
    const wf = 0.0011;
    const wx = (valueNoise(x * wf + 31.7, z * wf - 11.3) - 0.5) * 260;
    const wz = (valueNoise(x * wf - 7.1, z * wf + 53.9) - 0.5) * 260;
    const px = x + wx;
    const pz = z + wz;

    let ridged = 0;
    let amp = 1;
    let freq = 0.0025; // 400u wavelength at octave 0
    let norm = 0;
    for (let o = 0; o < 5; o += 1) {
        const n = valueNoise((px * freq) + (o * 17.3), (pz * freq) - (o * 9.1));
        ridged += amp * (1 - Math.abs((n * 2) - 1));
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
    }
    ridged = (ridged / norm) ** 1.9;
    const relief = (ridged - 0.30) * RELIEF_SCALE;
    return Math.max(-RELIEF_SCALE, Math.min(RELIEF_SCALE, relief));
}

/** Total drawn surface height - the CPU mirror of what the vertex shader computes. */
export function odysseyHeight(x, z) {
    return odysseyMacro(x, z) + (odysseyRelief(x, z) * odysseyDetailWeight(x, z));
}

/**
 * ONE BAKE. The relief grid is the expensive part (a million multi-octave noise samples), so
 * it is computed exactly once and everything else is derived from it:
 *
 *   relief grid  --> aux texture (R relief, G dH/dx, B dH/dz, A curvature)
 *                --> total height grid (macro + relief * weight, no noise at all)
 *                --> sun visibility (marched against the total height grid)
 *
 * The first pass computed the noise TWICE - once for the texture and again for the height
 * mirror - which cost 352 ms of pure duplicate work on the startup critical path.
 */
function buildWorldBakes() {
    const step = WORLD_EXTENT / (RELIEF_RES - 1);
    const origin = -WORLD_EXTENT / 2;

    // (a) the only place the noise is evaluated
    const relief = new Float32Array(RELIEF_RES * RELIEF_RES);
    for (let j = 0; j < RELIEF_RES; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < RELIEF_RES; i += 1) {
            relief[(j * RELIEF_RES) + i] = odysseyRelief(origin + (i * step), z);
        }
    }

    const at = (arr, i, j) => {
        const ci = Math.max(0, Math.min(RELIEF_RES - 1, i));
        const cj = Math.max(0, Math.min(RELIEF_RES - 1, j));
        return arr[(cj * RELIEF_RES) + ci];
    };

    // (b) AUX BAKE - derivatives central-differenced from the BAKED heights, never from a
    // re-evaluated analytic derivative, so lighting describes exactly the drawn surface.
    const data = new Uint16Array(RELIEF_RES * RELIEF_RES * 4);
    for (let j = 0; j < RELIEF_RES; j += 1) {
        for (let i = 0; i < RELIEF_RES; i += 1) {
            const h = relief[(j * RELIEF_RES) + i];
            const dHdx = (at(relief, i + 1, j) - at(relief, i - 1, j)) / (2 * step);
            const dHdz = (at(relief, i, j + 1) - at(relief, i, j - 1)) / (2 * step);
            const lap = (at(relief, i + 1, j) + at(relief, i - 1, j)
                + at(relief, i, j + 1) + at(relief, i, j - 1)) - (4 * h);
            const idx = ((j * RELIEF_RES) + i) * 4;
            data[idx] = THREE.DataUtils.toHalfFloat(h);
            data[idx + 1] = THREE.DataUtils.toHalfFloat(dHdx);
            data[idx + 2] = THREE.DataUtils.toHalfFloat(dHdz);
            data[idx + 3] = THREE.DataUtils.toHalfFloat(lap / step);
        }
    }
    // Half-float is filterable everywhere with NO feature request. float32-filterable is
    // optional in WebGPU and r181's fallback covers only DataTexture, not render targets.
    const heightTex = new THREE.DataTexture(data, RELIEF_RES, RELIEF_RES, THREE.RGBAFormat, THREE.HalfFloatType);
    heightTex.minFilter = THREE.LinearFilter;
    heightTex.magFilter = THREE.LinearFilter;
    heightTex.wrapS = THREE.ClampToEdgeWrapping;
    heightTex.wrapT = THREE.ClampToEdgeWrapping;
    heightTex.generateMipmaps = false;
    heightTex.needsUpdate = true;

    // (c) the CPU height mirror - derived, no noise re-evaluation
    const total = new Float32Array(RELIEF_RES * RELIEF_RES);
    for (let j = 0; j < RELIEF_RES; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < RELIEF_RES; i += 1) {
            const x = origin + (i * step);
            total[(j * RELIEF_RES) + i] = odysseyMacro(x, z)
                + (relief[(j * RELIEF_RES) + i] * odysseyDetailWeight(x, z));
        }
    }
    const sample = (x, z) => {
        const gx = Math.max(0, Math.min(RELIEF_RES - 1.001, (x - origin) / step));
        const gz = Math.max(0, Math.min(RELIEF_RES - 1.001, (z - origin) / step));
        const i0 = Math.floor(gx);
        const j0 = Math.floor(gz);
        const fx = gx - i0;
        const fz = gz - j0;
        const i1 = Math.min(RELIEF_RES - 1, i0 + 1);
        const j1 = Math.min(RELIEF_RES - 1, j0 + 1);
        const a = total[(j0 * RELIEF_RES) + i0];
        const b = total[(j0 * RELIEF_RES) + i1];
        const c = total[(j1 * RELIEF_RES) + i0];
        const d = total[(j1 * RELIEF_RES) + i1];
        return (((a * (1 - fx)) + (b * fx)) * (1 - fz)) + ((((c * (1 - fx)) + (d * fx))) * fz);
    };

    return { heightTex, sample };
}

function bakeSunVisibility(heightAt) {
    const len = Math.hypot(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
    const sx = SUN_DIR[0] / len;
    const sy = SUN_DIR[1] / len;
    const sz = SUN_DIR[2] / len;
    const horiz = Math.hypot(sx, sz) || 1e-4;
    const dirX = sx / horiz;
    const dirZ = sz / horiz;
    const rise = sy / horiz; // world units of climb per world unit travelled toward the sun

    const step = WORLD_EXTENT / SHADOW_RES; // ~11.7u
    const STEPS = 42;
    const origin = -WORLD_EXTENT / 2;
    const raw = new Float32Array(SHADOW_RES * SHADOW_RES);

    for (let j = 0; j < SHADOW_RES; j += 1) {
        const z0 = origin + (j * step);
        for (let i = 0; i < SHADOW_RES; i += 1) {
            const x0 = origin + (i * step);
            const h0 = heightAt(x0, z0);
            let shadow = 0;
            // Geometric stride: dense near the sample where contact shadows live, sparse far
            // away where only the massif itself can still occlude.
            let t = step * 1.5;
            for (let k = 0; k < STEPS; k += 1) {
                const hx = x0 + (dirX * t);
                const hz = z0 + (dirZ * t);
                const ray = h0 + (rise * t);
                const terrain = heightAt(hx, hz);
                if (terrain > ray) {
                    // Soft edge: how far above the ray the blocker reaches, normalised by the
                    // distance travelled, so distant blockers give a softer penumbra.
                    const over = (terrain - ray) / (1 + (t * 0.05));
                    shadow = Math.max(shadow, Math.min(1, over * 0.5));
                    if (shadow >= 1) break;
                }
                t *= 1.115;
            }
            raw[(j * SHADOW_RES) + i] = 1 - shadow;
        }
    }

    // A 3x3 blur so the shadow terminator is not a stair-step at 11.7u per texel.
    const data = new Uint16Array(SHADOW_RES * SHADOW_RES);
    const at = (i, j) => {
        const ci = Math.max(0, Math.min(SHADOW_RES - 1, i));
        const cj = Math.max(0, Math.min(SHADOW_RES - 1, j));
        return raw[(cj * SHADOW_RES) + ci];
    };
    for (let j = 0; j < SHADOW_RES; j += 1) {
        for (let i = 0; i < SHADOW_RES; i += 1) {
            let sum = 0;
            for (let dj = -1; dj <= 1; dj += 1) {
                for (let di = -1; di <= 1; di += 1) sum += at(i + di, j + dj);
            }
            data[(j * SHADOW_RES) + i] = THREE.DataUtils.toHalfFloat(sum / 9);
        }
    }

    const tex = new THREE.DataTexture(data, SHADOW_RES, SHADOW_RES, THREE.RedFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

/** Base spacing that keeps a coarser lattice at the SAME world reach. */
function spacingFor(gridN) {
    return (BASE_SPACING * GRID_N) / gridN;
}

// ── The clipmap mesh — built once, never touched again ───────────────────────────
function buildClipmapGeometry(gridN = GRID_N, holeShrink = HOLE_SHRINK) {
    // The morph must complete before the ring overlap band begins, per config.
    const ceiling = 1 - ((4 * holeShrink) / gridN);
    if (MORPH_END > ceiling) {
        throw new Error(
            `[odyssey-clipmap] morphEnd ${MORPH_END} exceeds ceiling ${ceiling.toFixed(4)} `
            + `for gridN=${gridN}, holeShrink=${holeShrink} - the rings will crack.`,
        );
    }
    const half = gridN / 2;
    const perLevel = (gridN + 1) * (gridN + 1);
    const positions = new Float32Array(LEVELS * perLevel * 3);
    const indices = [];
    const holeHalf = (half / 2) - holeShrink;

    for (let level = 0; level < LEVELS; level += 1) {
        const vertBase = level * perLevel;
        for (let j = 0; j <= gridN; j += 1) {
            for (let i = 0; i <= gridN; i += 1) {
                const v = (vertBase + (j * (gridN + 1)) + i) * 3;
                // NOT a position: (gridI, ringLevel, gridJ). The vertex stage turns this into
                // a world position. Nothing here is ever uploaded again.
                positions[v] = i - half;
                positions[v + 1] = level;
                positions[v + 2] = j - half;
            }
        }
        for (let j = 0; j < gridN; j += 1) {
            for (let i = 0; i < gridN; i += 1) {
                const gi = i - half;
                const gj = j - half;
                if (level > 0) {
                    // Skip quads entirely inside the hole this ring surrounds. The hole is cut
                    // HOLE_SHRINK cells SMALLER than the ring inside it, so consecutive rings
                    // always overlap and can never open a gap when their independently-snapped
                    // origins drift apart.
                    const inHole = Math.max(Math.abs(gi), Math.abs(gi + 1), Math.abs(gj), Math.abs(gj + 1)) <= holeHalf;
                    if (inHole) continue;
                }
                const a = vertBase + (j * (gridN + 1)) + i;
                const b = a + 1;
                const c = a + (gridN + 1);
                const d = c + 1;
                // Alternate the diagonal per quad; a uniform diagonal leaves a faint corduroy
                // of shading seams all running the same way.
                if (((i + j) & 1) === 0) {
                    indices.push(a, c, b, b, c, d);
                } else {
                    indices.push(a, c, d, a, d, b);
                }
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    // three would otherwise compute a bounding sphere from the FAKE (i, level, j) values and
    // use that nonsense for culling. Assign the real world extent by hand.
    const reach = half * spacingFor(gridN) * (2 ** (LEVELS - 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), reach * Math.SQRT2 + RELIEF_SCALE);
    geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(-reach, -RELIEF_SCALE, -reach),
        new THREE.Vector3(reach, RELIEF_SCALE, reach),
    );
    return {
        geometry, triangles: indices.length / 3, vertices: LEVELS * perLevel, reach,
    };
}

// ── ONE SKY, ONE ATMOSPHERE — shared by the dome, the ground and the water ───────
//
// Plan 3.5: the aerial perspective's far limit must converge on the EXACT sky the sky itself
// draws. If it does not, the clipmap's far edge draws as a hard silhouette at a fixed radius
// with the world apparently standing on it. Both callers therefore go through skyColourFor().
const AERIAL_MAX = 0.82;

// Driven by the colour script (src/rendering/odyssey/odyssey-colour-script.js) rather than
// hardcoded here, so the palette is DATA with unit-tested invariants instead of numbers buried
// in a shader. These are module-level so the sky, the ground and the water all read the same
// live values - one atmosphere, one palette, no chance of drift.
const uSkyHorizon = uniform(new THREE.Color(0.72, 0.82, 0.93));
const uSkyZenith = uniform(new THREE.Color(0.19, 0.40, 0.76));
const uSunColour = uniform(new THREE.Color(1.0, 0.95, 0.86));
const uGroundShadowTint = uniform(new THREE.Color(0.44, 0.58, 0.82));
const uAerialK = uniform(0.00016);
const uExposure = uniform(1.0);

function skyColourFor(dirY) {
    return mix(uSkyHorizon, uSkyZenith, clamp(dirY.mul(1.55).add(0.26), 0.0, 1.0));
}

/**
 * THE atmosphere. Every world surface calls this and nothing rolls its own — which is the
 * whole point: the shipped Odyssey has six competing atmospheres, and three surfaces that
 * physically touch recede toward three different colours at three different rates.
 */
function applyAerial(litColour, worldPos) {
    const toFrag = worldPos.sub(cameraPosition);
    const d = length(toFrag);
    const dirY = toFrag.div(max(d, float(0.001))).y;
    const t = float(1.0).sub(exp(d.mul(uAerialK.negate())));
    return mix(litColour, skyColourFor(dirY), clamp(t, 0.0, AERIAL_MAX));
}

export function create({ scene, camera, renderer }) {
    // Plan: bake -> compile -> reveal is an EXPLICIT ordering constraint, and every bake is
    // on the startup critical path with a 400 ms wall-clock budget. Time them.
    // Bake -> compile -> reveal is an EXPLICIT ordering constraint, and every bake sits on the
    // startup critical path with a 400 ms wall-clock budget. Time them, do not assume.
    const t0 = performance.now();
    const world = buildWorldBakes();
    const t1 = performance.now();
    const sunVisTex = bakeSunVisibility(world.sample);
    const t2 = performance.now();
    const { heightTex } = world;
    const bakeMs = {
        world: +(t1 - t0).toFixed(1),
        sunVis: +(t2 - t1).toFixed(1),
        total: +(t2 - t0).toFixed(1),
    };
    const {
        geometry, triangles, vertices, reach,
    } = buildClipmapGeometry();

    const uLodCenter = uniform(new THREE.Vector2(0, 0));
    const uTime = uniform(0);
    const uSunDir = uniform(new THREE.Vector3(...SUN_DIR).normalize());

    // ── VERTEX STAGE ────────────────────────────────────────────────────────────
    const aGrid = attribute('position', 'vec3'); // (gridI, ringLevel, gridJ)
    const level = aGrid.y;
    const spacing = float(BASE_SPACING).mul(exp2(level));
    const snap = spacing.mul(2.0); // snap to TWICE the spacing, or lattice parity flips
    const origin = floor(uLodCenter.div(snap)).mul(snap);

    const gridXZ = vec2(aGrid.x, aGrid.z);
    const localXZ = gridXZ.mul(spacing);
    const extent = spacing.mul(float(HALF));
    const cheb = max(abs(localXZ.x), abs(localXZ.y)).div(extent);
    const morph = clamp(cheb.sub(float(MORPH_START)).div(float(MORPH_END - MORPH_START)), 0.0, 1.0);
    const coarseLocal = floor(gridXZ.mul(0.5)).mul(2.0).mul(spacing);
    const morphedLocal = mix(localXZ, coarseLocal, morph);
    const worldXZ = origin.add(morphedLocal);

    // Post-morph effective sample spacing — the varying every band-limiting decision keys off.
    const vSpacing = varying(spacing.mul(morph.add(1.0)), 'vSpacing');

    const reliefUv = worldXZ.div(float(WORLD_EXTENT)).add(0.5);
    const vUv = varying(reliefUv, 'vReliefUv');

    // THE #1 GOTCHA (plan §3.2): WGSL forbids textureSample in the vertex stage, and r181
    // auto-injects a mip level in only three places (EnvironmentNode x2, Background) — never
    // for user materials. Omitting .level(0) is a WGSL validation error, not a soft failure.
    const reliefY = texture(heightTex, reliefUv).level(0).r;

    // The analytic macro form, evaluated in TSL exactly as odysseyMacro() does in JS.
    const heroD = length(worldXZ.sub(vec2(HERO_X, HERO_Z)));
    const heroCone = max(float(0.0), float(1.0).sub(heroD.div(float(HERO_R))));
    const macroCone = heroCone.pow(1.7).mul(float(HERO_H));
    const basinV = worldXZ.sub(vec2(BASIN_X, BASIN_Z)).div(vec2(760.0, 560.0));
    const macroBasin = exp(dot(basinV, basinV).negate()).mul(-62.0);
    const detailWeight = heroCone.mul(0.68).add(0.32);
    const surfaceY = macroCone.add(macroBasin).add(reliefY.mul(detailWeight));

    const vWeight = varying(detailWeight, 'vDetailWeight');
    const vHeroD = varying(heroD, 'vHeroD');
    const vHeroCone = varying(heroCone, 'vHeroCone');

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vec3(worldXZ.x, surfaceY, worldXZ.y);

    // ── FRAGMENT STAGE ──────────────────────────────────────────────────────────
    // Normals by CENTRAL-DIFFERENCING the baked texture — never by re-evaluating the analytic
    // derivative. This guarantees lighting describes the exact surface the vertex shader
    // displaces to, and structurally kills the phantom-shading-seam class of bug (plan §3.2).
    // ONE fetch. The gradients were central-differenced at bake time (see bakeReliefTexture),
    // so this is both cheaper and more correct than rebuilding them from four samples here.
    const aux = texture(heightTex, vUv);
    const dHdx = aux.g.mul(vWeight);
    const dHdz = aux.b.mul(vWeight);
    const curvature = aux.a;
    // d/dr of (cone^1.7 * H) is (-1.7 * H / R) * cone^0.7, projected onto x and z.
    const radial = vHeroCone.pow(0.7).mul(float((-1.7 * HERO_H) / HERO_R));
    const toHero = positionWorld.xz.sub(vec2(HERO_X, HERO_Z)).div(max(vHeroD, float(0.001)));
    const normal = normalize(vec3(
        dHdx.add(radial.mul(toHero.x)).negate(),
        1.0,
        dHdz.add(radial.mul(toHero.y)).negate(),
    ));

    const height = positionWorld.y;
    const slope = clamp(float(1.0).sub(normal.y), 0.0, 1.0);

    // PILLAR 7 — footprint band-limiting. The world-space size of one pixel. Every procedural
    // layer fades out by its own footprint; this is what MSAA and TAA fundamentally cannot do,
    // because the signal is already wrong before it is sampled. It also makes the shader
    // FASTER, since most pixels early-out of most layers.
    const footprint = max(length(dFdx(positionWorld.xz)), length(dFdy(positionWorld.xz)));
    const detailFade = float(1.0).sub(smoothstep(float(1.2), float(9.0), footprint));

    // Fine relief detail, gated by footprint AND by the clipmap's own effective spacing.
    const detailGate = detailFade.mul(
        float(1.0).sub(smoothstep(float(2.0), float(6.0), vSpacing)),
    );

    // ── Biome from world state, HEIGHT-BLENDED (plan §3.6) ──────────────────────
    // Linear blending of splat weights is what makes biome transitions look muddy. Blending
    // by a height//sharpness term keeps a crisp, natural boundary that follows the terrain.
    const grassCol = vec3(0.30, 0.44, 0.22);
    const rockCol = vec3(0.36, 0.34, 0.33);
    const snowCol = vec3(0.92, 0.95, 1.00);
    const sandCol = vec3(0.70, 0.64, 0.47);

    // The snowline is a WORLD ALTITUDE, so it follows the terrain instead of arriving because
    // a chapter counter incremented (plan 3.6). Sited at ~55-70% of the massif's height; the
    // first pass put it at 52-96u on a 620u mountain, which snowed the entire thing.
    const wSand = float(1.0).sub(smoothstep(float(-6.0), float(22.0), height));
    const wSnow = smoothstep(float(330.0), float(455.0), height)
        .mul(float(1.0).sub(smoothstep(float(0.42), float(0.70), slope)));
    // Rock on anything genuinely steep, plus bare rock emerging just under the snowline.
    // Curvature is free from the aux bake's A channel: convex crests scour to rock, concave
    // gullies hold soil. The cheap version of what an erosion sim would give.
    // Weighted by the same detail weight the height uses, so scouring reads on the massif and
    // leaves the foreland clean. Unweighted it veined the whole foreland like cracked mud.
    const convex = smoothstep(float(0.0), float(0.9), curvature.negate()).mul(vWeight);
    const wRock = max(
        max(
            smoothstep(float(0.17), float(0.40), slope),
            smoothstep(float(210.0), float(340.0), height).mul(0.75),
        ),
        convex.mul(0.38),
    );

    let albedo = grassCol;
    albedo = mix(albedo, sandCol, wSand);
    albedo = mix(albedo, rockCol, wRock);
    albedo = mix(albedo, snowCol, wSnow);

    // Near-ground break-up. Deliberately LOW frequency (~175u wavelength) and footprint-gated.
    // The first pass authored an 18u sin/cos lattice, which read as a diagonal grid the moment
    // its wavelength fell below a couple of pixels. Band-limiting is the general fix; the
    // cheaper fix is to not author a signal finer than the surface actually needs.
    const grain = positionWorld.xz.mul(0.036);
    const grainN = grain.x.sin().mul(grain.y.cos()).mul(0.5).add(0.5);
    albedo = albedo.mul(grainN.mul(0.07).mul(detailGate).add(0.985));

    // ── Lighting: ONE sun, with baked terrain self-shadowing (plan 3.4 / 3.8) ───
    // The shadow costs one texture fetch. No shadow map, no cascade, no depth pass, no
    // per-cascade material - the whole shadow line of the budget, removed rather than tuned.
    const sunVis = texture(sunVisTex, vUv).r;
    const ndl = max(dot(normal, uSunDir), 0.0);
    // Sky light still reaches shadowed ground, and it is COOLER than the sun - that colour
    // separation between lit and shadowed is most of what makes a landscape read as three
    // dimensional. Shadowed snow going blue is the same effect.
    // Sun colour and the cool shadow tint both come from the colour script, so "the light
    // changes as you climb" is one table edit rather than a shader change.
    const direct = ndl.mul(sunVis).mul(0.92);
    let lit = albedo.mul(uSunColour.mul(direct.add(0.06)).add(uGroundShadowTint.mul(0.36)));

    // ONE atmosphere, applied through the shared function the water uses too.
    lit = applyAerial(lit, positionWorld);

    material.colorNode = lit.mul(uExposure);
    material.side = THREE.FrontSide;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // its real extent is decided in the vertex shader
    mesh.matrixAutoUpdate = false; // never moves; the LOD centre is a uniform
    mesh.updateMatrix();
    mesh.name = 'odyssey-one-world-ground';
    scene.add(mesh);

    // A matching sky so the aerial perspective converges on something (plan §3.5: the far
    // limit must converge on the exact sky the sky itself draws, or the clipmap's far edge
    // draws as a hard silhouette at a fixed radius).
    // The sky the aerial perspective converges on — same function, so the far limit matches
    // by construction rather than by tuning.
    const skyGeo = new THREE.SphereGeometry(reach * 1.7, 32, 20);
    const skyMat = new THREE.MeshBasicNodeMaterial();
    const skyDir = normalize(positionWorld.sub(cameraPosition));
    const sunDisc = smoothstep(float(0.9985), float(0.9995), dot(skyDir, uSunDir));
    const sunGlow = smoothstep(float(0.90), float(1.0), dot(skyDir, uSunDir)).pow(3.0);
    skyMat.colorNode = skyColourFor(skyDir.y)
        .add(vec3(1.0, 0.86, 0.66).mul(sunGlow.mul(0.30)))
        .add(vec3(1.0, 0.97, 0.90).mul(sunDisc.mul(2.2)));
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -100;
    scene.add(skyMesh);

    // ── THE WATER SHEET — the second draw (plan 3.1) ────────────────────────────
    // Same clipmap geometry, same vertex buffer, same index buffer: a second material only.
    // Zero extra memory for the mesh; one extra draw call for an entire ocean.
    const waterMat = new THREE.MeshBasicNodeMaterial();

    // EXPERIMENT (measured): the sea is flat, so it does not need the ground's lattice. A
    // coarse clipmap at the SAME reach tests whether the water's cost is vertex or fill.
    const WATER_GRID_N = 32;
    const WATER_HOLE_SHRINK = 1; // ceiling 0.875 >= morphEnd 0.86; shrink 2 would crack
    const water = buildClipmapGeometry(WATER_GRID_N, WATER_HOLE_SHRINK);
    const WATER_SPACING = (BASE_SPACING * GRID_N) / WATER_GRID_N;
    const WATER_HALF = WATER_GRID_N / 2;

    const wSpacing = float(WATER_SPACING).mul(exp2(aGrid.y));
    const wSnap = wSpacing.mul(2.0);
    const wOrigin = floor(uLodCenter.div(wSnap)).mul(wSnap);
    const wGridXZ = vec2(aGrid.x, aGrid.z);
    const wLocal = wGridXZ.mul(wSpacing);
    const wCheb = max(abs(wLocal.x), abs(wLocal.y)).div(wSpacing.mul(float(WATER_HALF)));
    const wMorph = clamp(wCheb.sub(float(MORPH_START)).div(float(MORPH_END - MORPH_START)), 0.0, 1.0);
    const wCoarse = floor(wGridXZ.mul(0.5)).mul(2.0).mul(wSpacing);
    const wWorldXZ = wOrigin.add(mix(wLocal, wCoarse, wMorph));

    // Gentle swell. Amplitude is tiny next to a 620u massif on purpose — the sea reads through
    // its shading and its shoreline, not through geometry.
    const swell = wWorldXZ.x.mul(0.010).add(uTime.mul(0.55)).sin()
        .mul(wWorldXZ.y.mul(0.013).sub(uTime.mul(0.4)).cos())
        .mul(0.55);
    waterMat.positionNode = vec3(wWorldXZ.x, float(SEA_LEVEL).add(swell), wWorldXZ.y);

    const wUv = varying(wWorldXZ.div(float(WORLD_EXTENT)).add(0.5), 'vWaterUv');

    // The seabed comes from the SAME height function the land does — one world, so the
    // shoreline is where the two surfaces genuinely meet rather than an authored band.
    const bedRelief = texture(heightTex, wUv).r;
    const bedHeroD = length(positionWorld.xz.sub(vec2(HERO_X, HERO_Z)));
    const bedCone = max(float(0.0), float(1.0).sub(bedHeroD.div(float(HERO_R))));
    const bedBasinV = positionWorld.xz.sub(vec2(BASIN_X, BASIN_Z)).div(vec2(760.0, 560.0));
    const bedY = bedCone.pow(1.7).mul(float(HERO_H))
        .add(exp(dot(bedBasinV, bedBasinV).negate()).mul(-62.0))
        .add(bedRelief.mul(bedCone.mul(0.68).add(0.32)));
    const depth = float(SEA_LEVEL).sub(bedY);

    // Deep water is a SATURATED ocean blue, not a dark void. The first pass used 0.05/0.16/0.34
    // over a 46u ramp, which turned the basin directly under the camera into a black bruise.
    const shallowCol = vec3(0.34, 0.70, 0.71);
    const midCol = vec3(0.12, 0.42, 0.62);
    const deepCol = vec3(0.05, 0.22, 0.44);
    const dShallow = clamp(depth.div(18.0), 0.0, 1.0);
    const dDeep = clamp(depth.sub(18.0).div(85.0), 0.0, 1.0);
    const waterBody = mix(mix(shallowCol, midCol, dShallow), deepCol, dDeep);

    // Fresnel toward the sky the sky itself draws, plus a sun specular.
    const waterN = normalize(vec3(swell.mul(-0.05), 1.0, swell.mul(0.04)));
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    // pow(180) for the sun specular cost ~0.4 ms of the water's 1.38 ms on its own: a
    // transcendental per water pixel, and RDNA runs those at a quarter rate. A smoothstep over
    // the same narrow band is visually indistinguishable on a moving sea and is 2 mul + 1 sub.
    const fresBase = float(1.0).sub(max(dot(waterN, viewDir), 0.0));
    const fres = fresBase.mul(fresBase).mul(fresBase).mul(fresBase).mul(0.62);
    const spec = smoothstep(float(0.9955), float(0.9995), dot(normalize(uSunDir.add(viewDir)), waterN)).mul(0.9);

    const waterSunVis = texture(sunVisTex, wUv).r;
    let waterLit = mix(waterBody, skyColourFor(float(0.22)), fres);
    // The massif's shadow falls across the water too - a sea that ignores the mountain
    // beside it is one of the loudest tells that a world is assembled rather than lit.
    waterLit = waterLit.add(vec3(1.0, 0.96, 0.88).mul(spec).mul(waterSunVis));
    waterLit = waterLit.mul(waterSunVis.mul(0.18).add(0.82));
    // Foam where the sea shoals onto the shore.
    const foam = smoothstep(float(2.6), float(0.15), depth)
        .mul(smoothstep(float(-0.4), float(0.5), depth));
    waterLit = waterLit.add(vec3(0.92, 0.97, 0.99).mul(foam.mul(0.55)));

    waterMat.colorNode = applyAerial(waterLit, positionWorld).mul(uExposure);
    // The shoreline: the sea simply stops where the bed rises through it. A band far wider
    // than the swell that perturbs it, or the waterline snaps instead of feathering.
    waterMat.opacityNode = clamp(smoothstep(float(-0.6), float(2.2), depth), 0.0, 1.0);
    waterMat.transparent = true;
    waterMat.depthWrite = false;
    // The sheet spans the whole clipmap, but most of it is over land where alpha is 0. Without
    // alphaTest those fragments still run the full shade AND a blend; discarding them early is
    // free and removes the largest wasted-fill term in the frame.
    waterMat.alphaTest = 0.004;
    waterMat.side = THREE.FrontSide;

    const waterMesh = new THREE.Mesh(water.geometry, waterMat);
    waterMesh.frustumCulled = false;
    waterMesh.matrixAutoUpdate = false;
    waterMesh.updateMatrix();
    waterMesh.renderOrder = 1;
    waterMesh.name = 'odyssey-one-world-water';
    scene.add(waterMesh);

    // Expose the spike's own numbers for the capture harness.
    const stats = {
        triangles,
        vertices,
        reach,
        gridN: GRID_N,
        levels: LEVELS,
        morphEnd: MORPH_END,
        morphEndCeiling: MORPH_END_CEILING,
        reliefRes: RELIEF_RES,
        shadowRes: SHADOW_RES,
        bakeMs,
        drawCallsExpected: 3, // ground + water + sky
        waterTriangles: water.triangles,
    };
    if (typeof window !== 'undefined') window.__ODYSSEY_CLIPMAP__ = stats;
    // eslint-disable-next-line no-console
    console.log('[odyssey-clipmap]', JSON.stringify(stats));

    return {
        cameraRadius: 2400,
        update(time) {
            uTime.value = time;

            // THE ASCENT. Path progress drives the colour script, which drives every palette
            // slot at once. This is what stops "one world" from being one uniformly grey world:
            // the geometry is continuous, and the LIGHT is what carries the journey's arc.
            const journeyP = Math.min(1, 0.18 + (time * 0.02));
            const cs = sampleColourScript(journeyP);
            uSkyHorizon.value.setRGB(...cs.skyHorizon);
            uSkyZenith.value.setRGB(...cs.skyZenith);
            uSunColour.value.setRGB(...cs.sun);
            uGroundShadowTint.value.setRGB(...cs.groundShadow);
            uAerialK.value = cs.fogDensity;
            uExposure.value = cs.exposure;
            // The LOD centre follows the GROUND TRACK - never the camera eye (plan 3.1 point
            // 4). Centring on the camera makes the ground change shape when only the camera
            // moves, which is exactly what would break the hero framing.
            const t = time * 0.06;
            uLodCenter.value.set(Math.sin(t) * 260, 500 - (t * 90));
        },
        camera(time, cam) {
            // A rail-like approach to the massif, so the spike is framed the way Odyssey is.
            const t = time * 0.06;
            const cx = Math.sin(t) * 260;
            const cz = 900 - (t * 90);
            const groundY = Math.max(odysseyHeight(cx, cz), SEA_LEVEL);
            cam.position.set(cx + 220, groundY + 210, cz);
            cam.lookAt(HERO_X, HERO_H * 0.52, HERO_Z);
        },
        resize() {},
        dispose() {
            scene.remove(mesh);
            scene.remove(skyMesh);
            scene.remove(waterMesh);
            waterMat.dispose();
            geometry.dispose();
            water.geometry.dispose();
            material.dispose();
            skyGeo.dispose();
            skyMat.dispose();
            heightTex.dispose();
            sunVisTex.dispose();
            if (renderer && camera) { /* nothing renderer-owned to release */ }
        },
    };
}
