/**
 * ODYSSEY ACT II — the REAL world, rendered.
 *
 * The clipmap spike (odyssey-clipmap.effect.js) proved the machinery on a toy landform. This
 * one points the same machinery at src/rendering/odyssey/world/odyssey-world-height.js: the
 * actual Act II height field, with the four shipped canonical peaks at their exact world
 * positions and crown heights, the real sea level, and the real shore profile solved against
 * the altitudes the rail actually flies.
 *
 * The camera rides the REAL Odyssey spline. What you are looking at is chapters 2 through 5 as
 * one continuous surface, with no chapter environments, no crossfade and no seams.
 */

import * as THREE from 'three/webgpu';
import {
    abs, attribute, clamp, dFdx, dFdy, dot, exp, exp2, float, floor, length, max, mix,
    normalize, normalWorld, positionWorld, smoothstep, texture, uniform, varying, vec2, vec3, cameraPosition,
    attribute as tslAttribute, positionGeometry, positionLocal, sin as tslSin,
} from 'three/tsl';
import {
    ODYSSEY_MASSIFS,
    ODYSSEY_SEA_LEVEL,
    odysseyWorldDetailWeight,
    odysseyWorldMacro,
    odysseyWorldRelief,
} from '../../rendering/odyssey/world/odyssey-world-height.js';
import { sampleColourScript } from '../../rendering/odyssey/odyssey-colour-script.js';
import { getActiveOdysseyChapterPositions, getOdysseyPathPointAt } from '../../rendering/odyssey/path-utils.js';

export const meta = {
    id: 'odyssey-world',
    title: 'Odyssey — Act II as one world',
    description: 'The real height field + real spline: ch2-ch5 with no chapters',
};

// Clipmap sized to reach past the far-left flank (x -1893) and the massifs (z -1640).
const GRID_N = 128;
const LEVELS = 9;
const BASE_SPACING = 1.6;
const HOLE_SHRINK = 3;
const HALF = GRID_N / 2;
const MORPH_START = 0.70;
const MORPH_END = 0.86;
const MORPH_CEILING = 1 - ((4 * HOLE_SHRINK) / GRID_N);
if (MORPH_END > MORPH_CEILING) throw new Error('[odyssey-world] clipmap would crack');

const RELIEF_RES = 1024;
const RELIEF_EXTENT = 9000; // world span the relief bake covers, centred on the world origin
const SHADOW_RES = 512;
const SUN_DIR = [-0.46, 0.36, 0.61];

// ── bakes ────────────────────────────────────────────────────────────────────────
function buildBakes() {
    const step = RELIEF_EXTENT / (RELIEF_RES - 1);
    const origin = -RELIEF_EXTENT / 2;

    const relief = new Float32Array(RELIEF_RES * RELIEF_RES);
    for (let j = 0; j < RELIEF_RES; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < RELIEF_RES; i += 1) {
            relief[(j * RELIEF_RES) + i] = odysseyWorldRelief(origin + (i * step), z);
        }
    }
    const at = (arr, i, j) => arr[(Math.max(0, Math.min(RELIEF_RES - 1, j)) * RELIEF_RES)
        + Math.max(0, Math.min(RELIEF_RES - 1, i))];

    const data = new Uint16Array(RELIEF_RES * RELIEF_RES * 4);
    for (let j = 0; j < RELIEF_RES; j += 1) {
        for (let i = 0; i < RELIEF_RES; i += 1) {
            const h = relief[(j * RELIEF_RES) + i];
            const idx = ((j * RELIEF_RES) + i) * 4;
            data[idx] = THREE.DataUtils.toHalfFloat(h);
            data[idx + 1] = THREE.DataUtils.toHalfFloat(
                (at(relief, i + 1, j) - at(relief, i - 1, j)) / (2 * step),
            );
            data[idx + 2] = THREE.DataUtils.toHalfFloat(
                (at(relief, i, j + 1) - at(relief, i, j - 1)) / (2 * step),
            );
            data[idx + 3] = THREE.DataUtils.toHalfFloat(0);
        }
    }
    const heightTex = new THREE.DataTexture(data, RELIEF_RES, RELIEF_RES, THREE.RGBAFormat, THREE.HalfFloatType);
    heightTex.minFilter = THREE.LinearFilter;
    heightTex.magFilter = THREE.LinearFilter;
    heightTex.wrapS = THREE.ClampToEdgeWrapping;
    heightTex.wrapT = THREE.ClampToEdgeWrapping;
    heightTex.generateMipmaps = false;
    heightTex.needsUpdate = true;

    // Total-height mirror, derived (no noise re-evaluation).
    const total = new Float32Array(RELIEF_RES * RELIEF_RES);
    for (let j = 0; j < RELIEF_RES; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < RELIEF_RES; i += 1) {
            const x = origin + (i * step);
            total[(j * RELIEF_RES) + i] = odysseyWorldMacro(x, z)
                + (relief[(j * RELIEF_RES) + i] * odysseyWorldDetailWeight(x, z));
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
        return (((a * (1 - fx)) + (b * fx)) * (1 - fz)) + (((c * (1 - fx)) + (d * fx)) * fz);
    };
    return { heightTex, sample };
}

function bakeSunVisibility(heightAt) {
    const len = Math.hypot(...SUN_DIR);
    const [sx, sy, sz] = SUN_DIR.map((v) => v / len);
    const horiz = Math.hypot(sx, sz) || 1e-4;
    const dirX = sx / horiz;
    const dirZ = sz / horiz;
    const rise = sy / horiz;
    const step = RELIEF_EXTENT / SHADOW_RES;
    const origin = -RELIEF_EXTENT / 2;
    const raw = new Float32Array(SHADOW_RES * SHADOW_RES);
    for (let j = 0; j < SHADOW_RES; j += 1) {
        const z0 = origin + (j * step);
        for (let i = 0; i < SHADOW_RES; i += 1) {
            const x0 = origin + (i * step);
            const h0 = heightAt(x0, z0);
            let shadow = 0;
            let t = step * 1.5;
            for (let k = 0; k < 42; k += 1) {
                const terrain = heightAt(x0 + (dirX * t), z0 + (dirZ * t));
                const ray = h0 + (rise * t);
                if (terrain > ray) {
                    shadow = Math.max(shadow, Math.min(1, ((terrain - ray) / (1 + (t * 0.05))) * 0.5));
                    if (shadow >= 1) break;
                }
                t *= 1.115;
            }
            raw[(j * SHADOW_RES) + i] = 1 - shadow;
        }
    }
    const data = new Uint16Array(SHADOW_RES * SHADOW_RES);
    const at = (i, j) => raw[(Math.max(0, Math.min(SHADOW_RES - 1, j)) * SHADOW_RES)
        + Math.max(0, Math.min(SHADOW_RES - 1, i))];
    for (let j = 0; j < SHADOW_RES; j += 1) {
        for (let i = 0; i < SHADOW_RES; i += 1) {
            let sum = 0;
            for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) sum += at(i + di, j + dj);
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

/**
 * TILEABLE DETAIL NORMAL, baked once at 256².
 *
 * The first version evaluated mx_noise_vec3 two or three times per PIXEL. Measured, that was
 * ~8.6 ms of a 11.6 ms frame — gradient noise is on the order of a hundred ALU per call, and
 * a fragment shader runs it a million times a frame.
 *
 * Re-reading the reference settled it: snowflow's "three tiled detail scales" are TILED
 * TEXTURES, not procedural noise. A filtered fetch costs about one ALU-equivalent. The
 * lattice indices below wrap modulo the period, which is what makes the result seamlessly
 * tileable — sampling a non-tiling noise with RepeatWrapping would show a grid of seams.
 */
function bakeDetailNormal(res = 256) {
    const h = (ix, iy) => {
        const wx = ((ix % res) + res) % res;
        const wy = ((iy % res) + res) % res;
        let v = (wx * 374761393) + (wy * 668265263);
        v = Math.imul(v ^ (v >>> 13), 1274126177);
        return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
    };
    const vn = (x, y, freq) => {
        const fx = x * freq;
        const fy = y * freq;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const ux = tx * tx * (3 - (2 * tx));
        const uy = ty * ty * (3 - (2 * ty));
        const a = h(ix, iy);
        const b = h(ix + 1, iy);
        const c = h(ix, iy + 1);
        const d = h(ix + 1, iy + 1);
        return (((a * (1 - ux)) + (b * ux)) * (1 - uy)) + ((((c * (1 - ux)) + (d * ux)) * uy));
    };
    // Two octaves, both periodic in `res`.
    const field = new Float32Array(res * res);
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            field[(j * res) + i] = (vn(i, j, 1 / 32) * 0.65) + (vn(i, j, 1 / 11) * 0.35);
        }
    }
    const at = (i, j) => field[((((j % res) + res) % res) * res) + (((i % res) + res) % res)];
    const data = new Uint16Array(res * res * 2);
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            const idx = ((j * res) + i) * 2;
            data[idx] = THREE.DataUtils.toHalfFloat((at(i + 1, j) - at(i - 1, j)) * 0.5);
            data[idx + 1] = THREE.DataUtils.toHalfFloat((at(i, j + 1) - at(i, j - 1)) * 0.5);
        }
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RGFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

// ── VEGETATION ───────────────────────────────────────────────────────────────────
//
// Stylised conifers built from stacked cones: no textures, no alpha, no imported assets. That
// last point is not just tidiness — alpha-tested foliage cards alias viciously on a silhouette
// against a bright sky, and this project has MSAA but no TAA, so the cheapest way to win the
// aliasing fight is to not pick it. Solid geometry has a real silhouette that MSAA can resolve.
const TREE_TIERS = 3;
const TREE_SIDES = 6;

function buildTreeGeometry() {
    const positions = [];
    const normals = [];
    const shade = []; // 0 at the base of a tier, 1 at its tip — cheap vertical shading
    const trunkH = 0.9;
    const trunkR = 0.10;

    // Trunk: a prism, so the tree reads as standing rather than floating.
    for (let i = 0; i < TREE_SIDES; i += 1) {
        const a0 = (i / TREE_SIDES) * Math.PI * 2;
        const a1 = ((i + 1) / TREE_SIDES) * Math.PI * 2;
        const p0 = [Math.cos(a0) * trunkR, 0, Math.sin(a0) * trunkR];
        const p1 = [Math.cos(a1) * trunkR, 0, Math.sin(a1) * trunkR];
        const nx = Math.cos((a0 + a1) / 2);
        const nz = Math.sin((a0 + a1) / 2);
        [[p0[0], 0, p0[2], 0], [p1[0], 0, p1[2], 0], [p1[0], trunkH, p1[2], 0.2],
            [p0[0], 0, p0[2], 0], [p1[0], trunkH, p1[2], 0.2], [p0[0], trunkH, p0[2], 0.2]]
            .forEach(([x, y, z, sv]) => {
                positions.push(x, y, z);
                normals.push(nx, 0.1, nz);
                shade.push(sv);
            });
    }

    // Foliage tiers.
    for (let t = 0; t < TREE_TIERS; t += 1) {
        const f = t / TREE_TIERS;
        const base = trunkH + (f * 2.5);
        const top = base + 1.55 - (f * 0.25);
        const radius = 1.0 - (f * 0.27);
        for (let i = 0; i < TREE_SIDES; i += 1) {
            const a0 = (i / TREE_SIDES) * Math.PI * 2;
            const a1 = ((i + 1) / TREE_SIDES) * Math.PI * 2;
            const nx = Math.cos((a0 + a1) / 2);
            const nz = Math.sin((a0 + a1) / 2);
            positions.push(Math.cos(a0) * radius, base, Math.sin(a0) * radius);
            positions.push(Math.cos(a1) * radius, base, Math.sin(a1) * radius);
            positions.push(0, top, 0);
            for (let k = 0; k < 3; k += 1) normals.push(nx, 0.45, nz);
            shade.push(0.15, 0.15, 1.0);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
    return geo;
}

/**
 * Scatter trees on the CPU HEIGHT MIRROR.
 *
 * This is the pillar the shipped build breaks: its Ch4 conifer belt is planted at a constant Y
 * with no heightfield sample at all, sitting a measured mean -4.5u from the surface with 37.7%
 * of cells burying a 6-17u tree by more than 8u. Sampling the same mirror the vertex shader
 * displaces to makes floating and buried trees structurally impossible.
 *
 * Placement is a JITTERED GRID rather than pure random: pure random clumps and leaves holes at
 * exactly the scale the eye reads as a mistake, while a jittered grid gives even coverage with
 * no lattice visible. Density then follows the biome — above the waterline, below the snow,
 * off the steep faces — with a noise mask so the forest has edges instead of a uniform carpet.
 */
function scatterTrees(heightAt, opts) {
    const {
        cx, cz, radius, spacing, seaLevel, snowStart,
    } = opts;
    const out = [];
    const rnd = (i, j, salt) => {
        let h = ((i | 0) * 374761393) + ((j | 0) * 668265263) + (salt * 2654435761);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const steps = Math.ceil((radius * 2) / spacing);
    for (let j = 0; j < steps; j += 1) {
        for (let i = 0; i < steps; i += 1) {
            const gx = cx - radius + (i * spacing);
            const gz = cz - radius + (j * spacing);
            const x = gx + ((rnd(i, j, 1) - 0.5) * spacing * 0.95);
            const z = gz + ((rnd(i, j, 2) - 0.5) * spacing * 0.95);
            if (Math.hypot(x - cx, z - cz) > radius) continue;

            const y = heightAt(x, z);
            if (y < seaLevel + 3) continue; // no trees in the surf
            if (y > snowStart) continue; // tree line

            // Slope from the mirror itself, so the rule matches the drawn surface.
            const e = 4;
            const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
            const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
            const slope = Math.hypot(dx, dz);
            if (slope > 0.62) continue; // conifers do not grow on cliffs

            // Forest EDGES: a low-frequency mask so the canopy thins and clears rather than
            // covering everything uniformly to its altitude limit.
            const mask = rnd(Math.floor(x / 140), Math.floor(z / 140), 3);
            const altitudeFalloff = 1 - Math.max(0, (y - (snowStart - 130)) / 130);
            if (rnd(i, j, 4) > (0.35 + (mask * 0.95)) * Math.max(0.12, altitudeFalloff)) continue;

            out.push({
                x,
                y,
                z,
                scale: 3.2 + (rnd(i, j, 5) * 3.4),
                rot: rnd(i, j, 6) * Math.PI * 2,
                tint: rnd(i, j, 7),
            });
        }
    }
    return out;
}

function buildClipmap(gridN, holeShrink, spacing) {
    const half = gridN / 2;
    const perLevel = (gridN + 1) * (gridN + 1);
    const positions = new Float32Array(LEVELS * perLevel * 3);
    const indices = [];
    const holeHalf = (half / 2) - holeShrink;
    for (let level = 0; level < LEVELS; level += 1) {
        const base = level * perLevel;
        for (let j = 0; j <= gridN; j += 1) {
            for (let i = 0; i <= gridN; i += 1) {
                const v = (base + (j * (gridN + 1)) + i) * 3;
                positions[v] = i - half;
                positions[v + 1] = level;
                positions[v + 2] = j - half;
            }
        }
        for (let j = 0; j < gridN; j += 1) {
            for (let i = 0; i < gridN; i += 1) {
                const gi = i - half;
                const gj = j - half;
                if (level > 0
                    && Math.max(Math.abs(gi), Math.abs(gi + 1), Math.abs(gj), Math.abs(gj + 1)) <= holeHalf) continue;
                const a = base + (j * (gridN + 1)) + i;
                const b = a + 1;
                const c = a + (gridN + 1);
                const d = c + 1;
                if (((i + j) & 1) === 0) indices.push(a, c, b, b, c, d);
                else indices.push(a, c, d, a, d, b);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    const reach = half * spacing * (2 ** (LEVELS - 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), (reach * 1.5) + 1200);
    return { geometry, triangles: indices.length / 3, reach };
}

// ── TSL helpers ──────────────────────────────────────────────────────────────────
function tslSmoothstep01(e0, e1, x) {
    return smoothstep(float(e0), float(e1), x);
}

/** The macro form in TSL — mirrors odysseyWorldMacro() term for term. */
function tslWorldMacro(worldXZ) {
    const shelfT = tslSmoothstep01(60, -260, worldXZ.y);
    const inlandT = tslSmoothstep01(-300, -900, worldXZ.y);
    const lateralN = worldXZ.x.sub(-220).div(2400);
    const lateral = max(float(0), float(1).sub(lateralN.mul(lateralN)));
    const land = float(80).add(shelfT.mul(245).add(inlandT.mul(60)).mul(lateral));

    const bx = worldXZ.x.sub(-150).div(430);
    const bz = worldXZ.y.sub(-520).div(330);
    const basin = exp(bx.mul(bx).add(bz.mul(bz)).negate()).mul(-42);
    const ground = land.add(basin);

    let rise = float(0);
    ODYSSEY_MASSIFS.forEach((m) => {
        const d = length(worldXZ.sub(vec2(m.x, m.z)));
        const cone = max(float(0), float(1).sub(d.div(float(m.radius))));
        const pedestal = tslSmoothstep01(0, 0.35, cone).mul(float(m.footY).sub(ground));
        const peak = pedestal.add(cone.pow(float(m.exponent)).mul(float(m.height)));
        // Magnitude-scaled smooth max, matching the JS: exact when both are zero.
        const kEff = max(float(0), max(rise, peak)).min(float(26));
        const h = clamp(kEff.greaterThan(0.000001)
            .select(float(0.5).add(rise.sub(peak).mul(0.5).div(max(kEff, float(1e-6)))), float(1)), 0, 1);
        rise = peak.add(rise.sub(peak).mul(h)).add(kEff.mul(h).mul(float(1).sub(h)));
    });
    return ground.add(rise);
}

function tslDetailWeight(worldXZ) {
    let strongest = float(0);
    ODYSSEY_MASSIFS.forEach((m) => {
        const d = length(worldXZ.sub(vec2(m.x, m.z)));
        strongest = max(strongest, max(float(0), float(1).sub(d.div(float(m.radius * 1.25)))));
    });
    return strongest.mul(0.84).add(0.16);
}

export function create({ scene, camera }) {
    // DEPTH RANGE. The playground's default camera is near 0.1 / far 20,000, and the clipmap
    // now reaches 26 km — so the sky dome, sized off `reach`, fell entirely BEYOND the far
    // plane and the sky rendered black. Widen the far plane for the world, and pull the near
    // plane out to 1.0 while doing it: 0.1/30000 is a depth ratio of 300,000, which is asking
    // for z-fighting between the ground and a water sheet only metres above it.
    if (camera) {
        camera.near = 1.0;
        camera.far = 30000;
        camera.updateProjectionMatrix();
    }

    const t0 = performance.now();
    const world = buildBakes();
    const t1 = performance.now();
    const sunVisTex = bakeSunVisibility(world.sample);
    const detailTex = bakeDetailNormal();
    const t2 = performance.now();
    const { heightTex } = world;

    const ground = buildClipmap(GRID_N, HOLE_SHRINK, BASE_SPACING);
    const waterSpacing = (BASE_SPACING * GRID_N) / 32;
    const water = buildClipmap(32, 1, waterSpacing);

    const uLodCenter = uniform(new THREE.Vector2(0, 0));
    const uTime = uniform(0);
    const uSunDir = uniform(new THREE.Vector3(...SUN_DIR).normalize());
    const uSkyHorizon = uniform(new THREE.Color(0.72, 0.82, 0.93));
    const uSkyZenith = uniform(new THREE.Color(0.19, 0.40, 0.76));
    const uSunColour = uniform(new THREE.Color(1, 0.95, 0.86));
    const uShadowTint = uniform(new THREE.Color(0.44, 0.58, 0.82));
    const uAerialK = uniform(0.00016);
    const uExposure = uniform(1);

    const skyColourFor = (dirY) => mix(uSkyHorizon, uSkyZenith, clamp(dirY.mul(1.55).add(0.26), 0, 1));
    const applyAerial = (lit, wp) => {
        const to = wp.sub(cameraPosition);
        const d = length(to);
        const t = float(1).sub(exp(d.mul(uAerialK.negate())));
        return mix(lit, skyColourFor(to.div(max(d, float(0.001))).y), clamp(t, 0, 0.82));
    };

    const clipmapXZ = (spacing0, halfN) => {
        const aGrid = attribute('position', 'vec3');
        const spacing = float(spacing0).mul(exp2(aGrid.y));
        const origin = floor(uLodCenter.div(spacing.mul(2))).mul(spacing.mul(2));
        const gridXZ = vec2(aGrid.x, aGrid.z);
        const local = gridXZ.mul(spacing);
        const cheb = max(abs(local.x), abs(local.y)).div(spacing.mul(float(halfN)));
        const morph = clamp(cheb.sub(float(MORPH_START)).div(float(MORPH_END - MORPH_START)), 0, 1);
        const coarse = floor(gridXZ.mul(0.5)).mul(2).mul(spacing);
        return { worldXZ: origin.add(mix(local, coarse, morph)), spacing: spacing.mul(morph.add(1)) };
    };

    // ── GROUND ──
    const g = clipmapXZ(BASE_SPACING, HALF);
    const reliefUv = g.worldXZ.div(float(RELIEF_EXTENT)).add(0.5);
    const vUv = varying(reliefUv, 'vUv');
    const gRelief = texture(heightTex, reliefUv).level(0).r;
    const gWeight = tslDetailWeight(g.worldXZ);
    const gMacro = tslWorldMacro(g.worldXZ);
    const gY = gMacro.add(gRelief.mul(gWeight));
    const vWeight = varying(gWeight, 'vW');
    const vSpacing = varying(g.spacing, 'vS');

    // MACRO GRADIENT IN THE VERTEX STAGE.
    //
    // The first version finite-differenced tslWorldMacro() in the FRAGMENT, which meant three
    // evaluations per pixel, each walking four massifs with a pow() and an exp(). Measured, the
    // whole frame went from 2.95 ms to 19.07 ms. The macro is smooth by construction — its
    // shortest feature is a 405u cone — so a per-vertex gradient is not an approximation worth
    // worrying about, and it costs three evaluations per VERTEX instead of per pixel.
    const MACRO_EPS = 6.0;
    const gMacroDx = tslWorldMacro(g.worldXZ.add(vec2(MACRO_EPS, 0))).sub(gMacro).div(MACRO_EPS);
    const gMacroDz = tslWorldMacro(g.worldXZ.add(vec2(0, MACRO_EPS))).sub(gMacro).div(MACRO_EPS);
    const vMacroDx = varying(gMacroDx, 'vMDx');
    const vMacroDz = varying(gMacroDz, 'vMDz');

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.positionNode = vec3(g.worldXZ.x, gY, g.worldXZ.y);

    const aux = texture(heightTex, vUv);
    const hDx = aux.g.mul(vWeight);
    const hDz = aux.b.mul(vWeight);
    const baseNormal = normalize(vec3(hDx.add(vMacroDx).negate(), 1, hDz.add(vMacroDz).negate()));

    // ── PILLAR 7: three footprint-gated detail scales ───────────────────────────
    //
    // The baked relief resolves 8.8 world units per texel, so at close range the surface is
    // smooth and reads as plastic. Raising the bake resolution is the expensive answer; the
    // cheap one is to add the missing octaves ANALYTICALLY in the fragment and fade each of
    // them out by its own world-space pixel footprint.
    //
    // The fade band per layer is roughly [wavelength/6, wavelength/1.5]. Below that a layer's
    // wavelength has fallen under a couple of pixels: it carries no information, it only
    // aliases, and no amount of MSAA or TAA can recover it because the signal is already wrong
    // BEFORE it is sampled. Gating is not an optimisation here, it is the correctness fix —
    // and it happens to make the shader faster, since most pixels early-out of most layers.
    const detailFootprint = max(length(dFdx(positionWorld.xz)), length(dFdy(positionWorld.xz)));
    const detailScales = [
        { world: 26, amp: 0.34 }, // wavelength in world units — boulders and gully walls
        { world: 7.5, amp: 0.20 }, // surface break-up
    ];
    let bump = vec2(0, 0);
    detailScales.forEach(({ world: wavelength, amp }) => {
        const gate = float(1).sub(smoothstep(float(wavelength / 6), float(wavelength / 1.5), detailFootprint));
        const d = texture(detailTex, positionWorld.xz.div(wavelength));
        bump = bump.add(d.rg.mul(amp).mul(gate));
    });

    // Perturb less on near-vertical faces: world-XZ noise stretches badly there, and a
    // triplanar blend is not worth its cost for a surface this close to a heightfield.
    const flatness = clamp(baseNormal.y, 0.0, 1.0);
    const normal = normalize(baseNormal.add(vec3(bump.x, 0, bump.y).mul(flatness.mul(0.42))));

    const height = positionWorld.y;
    // BIOME follows the LANDFORM, lighting follows the grain. Driving the biome from the
    // detailed normal made grass and rock patches track the surface noise instead of the
    // terrain, which reads as camouflage blotching rather than a mountainside.
    const slope = clamp(float(1).sub(baseNormal.y), 0, 1);
    const footprint = max(length(dFdx(positionWorld.xz)), length(dFdy(positionWorld.xz)));
    const detailGate = float(1).sub(smoothstep(float(1.2), float(9), footprint))
        .mul(float(1).sub(smoothstep(float(2), float(6), vSpacing)));

    // Biome from world state. The snowline is a WORLD ALTITUDE on the real massif.
    const wSand = float(1).sub(smoothstep(float(ODYSSEY_SEA_LEVEL - 2), float(ODYSSEY_SEA_LEVEL + 26), height));
    const wSnow = smoothstep(float(620), float(790), height)
        .mul(float(1).sub(smoothstep(float(0.42), float(0.70), slope)));
    const wRock = max(
        smoothstep(float(0.17), float(0.40), slope),
        smoothstep(float(470), float(640), height).mul(0.75),
    );
    let albedo = vec3(0.30, 0.44, 0.22);
    albedo = mix(albedo, vec3(0.70, 0.64, 0.47), wSand);
    albedo = mix(albedo, vec3(0.36, 0.34, 0.33), wRock);
    albedo = mix(albedo, vec3(0.92, 0.95, 1.0), wSnow);
    const grain = positionWorld.xz.mul(0.036);
    albedo = albedo.mul(grain.x.sin().mul(grain.y.cos()).mul(0.5).add(0.5)
        .mul(0.07)
        .mul(detailGate)
        .add(0.985));

    const sunVis = texture(sunVisTex, vUv).r;
    const ndl = max(dot(normal, uSunDir), 0);
    const lit = albedo.mul(uSunColour.mul(ndl.mul(sunVis).mul(0.92).add(0.06))
        .add(uShadowTint.mul(0.36)));
    mat.colorNode = applyAerial(lit, positionWorld).mul(uExposure);

    const groundMesh = new THREE.Mesh(ground.geometry, mat);
    groundMesh.frustumCulled = false;
    groundMesh.matrixAutoUpdate = false;
    groundMesh.updateMatrix();
    groundMesh.name = 'odyssey-act2-ground';
    scene.add(groundMesh);

    // ── SKY ──
    const skyMat = new THREE.MeshBasicNodeMaterial();
    const skyDir = normalize(positionWorld.sub(cameraPosition));
    skyMat.colorNode = skyColourFor(skyDir.y)
        .add(vec3(1, 0.86, 0.66).mul(smoothstep(float(0.90), float(1), dot(skyDir, uSunDir)).pow(3).mul(0.3)))
        .add(vec3(1, 0.97, 0.9).mul(smoothstep(float(0.9985), float(0.9995), dot(skyDir, uSunDir)).mul(2.2)))
        .mul(uExposure);
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(Math.min(ground.reach * 1.7, 22000), 32, 20), skyMat);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -100;
    scene.add(skyMesh);

    // ── WATER ──
    const w = clipmapXZ(waterSpacing, 16);
    const waterMat = new THREE.MeshBasicNodeMaterial();
    const swell = w.worldXZ.x.mul(0.010).add(uTime.mul(0.55)).sin()
        .mul(w.worldXZ.y.mul(0.013).sub(uTime.mul(0.4)).cos())
        .mul(0.55);
    waterMat.positionNode = vec3(w.worldXZ.x, float(ODYSSEY_SEA_LEVEL).add(swell), w.worldXZ.y);
    const wUv = varying(w.worldXZ.div(float(RELIEF_EXTENT)).add(0.5), 'vWUv');

    // Same again for the sea: the bed's macro term is a vertex-stage varying, not a
    // per-pixel walk over four massifs.
    const vBedMacro = varying(tslWorldMacro(w.worldXZ), 'vBedMacro');
    const vBedWeight = varying(tslDetailWeight(w.worldXZ), 'vBedW');
    const bedY = vBedMacro.add(texture(heightTex, wUv).r.mul(vBedWeight));
    const depth = float(ODYSSEY_SEA_LEVEL).sub(bedY);
    const body = mix(
        mix(vec3(0.34, 0.70, 0.71), vec3(0.12, 0.42, 0.62), clamp(depth.div(18), 0, 1)),
        vec3(0.05, 0.22, 0.44),
        clamp(depth.sub(18).div(85), 0, 1),
    );
    const wN = normalize(vec3(swell.mul(-0.05), 1, swell.mul(0.04)));
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fb = float(1).sub(max(dot(wN, viewDir), 0));
    const fres = fb.mul(fb).mul(fb).mul(fb).mul(0.62);
    const spec = smoothstep(float(0.9955), float(0.9995), dot(normalize(uSunDir.add(viewDir)), wN)).mul(0.9);
    const wVis = texture(sunVisTex, wUv).r;
    let wl = mix(body, skyColourFor(float(0.22)), fres);
    wl = wl.add(vec3(1, 0.96, 0.88).mul(spec).mul(wVis)).mul(wVis.mul(0.18).add(0.82));
    wl = wl.add(vec3(0.92, 0.97, 0.99).mul(
        smoothstep(float(2.6), float(0.15), depth).mul(smoothstep(float(-0.4), float(0.5), depth)).mul(0.55),
    ));
    waterMat.colorNode = applyAerial(wl, positionWorld).mul(uExposure);
    waterMat.opacityNode = clamp(smoothstep(float(-0.6), float(2.2), depth), 0, 1);
    waterMat.transparent = true;
    waterMat.depthWrite = false;
    waterMat.alphaTest = 0.004;
    const waterMesh = new THREE.Mesh(water.geometry, waterMat);
    waterMesh.frustumCulled = false;
    waterMesh.matrixAutoUpdate = false;
    waterMesh.updateMatrix();
    waterMesh.renderOrder = 1;
    scene.add(waterMesh);

    // ── FOREST ──
    //
    // CHUNKED, and the reason is measured. 15,427 trees at ~30 triangles each is 463k
    // triangles — 2.4x the entire ground — and it cost 3.4 ms. Collapsing distant instances to
    // degenerate triangles in the vertex stage changed NOTHING (8.52 -> 8.65 ms, inside the
    // noise), which says the cost is vertex processing, not fill: those vertices are submitted
    // and transformed whether or not they rasterise anything.
    //
    // So the fix is to not submit them. One InstancedMesh per world-space cell, each with real
    // bounds, gives three's frustum culling something to work with for free, and lets a simple
    // distance test drop everything behind and far ahead of a camera that is on a rail anyway.
    // All chunks share ONE material, so this costs draw calls (cheap) and not pipelines
    // (expensive — 40-45 ms of compile each).
    const treeGeo = buildTreeGeometry();
    const trees = scatterTrees(world.sample, {
        cx: -220,
        cz: -620,
        radius: 1750,
        spacing: 15,
        seaLevel: ODYSSEY_SEA_LEVEL,
        snowStart: 640,
    });
    const treeCount = trees.length;

    const CHUNK = 420;
    const chunks = new Map();
    trees.forEach((t) => {
        const key = `${Math.floor(t.x / CHUNK)}|${Math.floor(t.z / CHUNK)}`;
        if (!chunks.has(key)) chunks.set(key, []);
        chunks.get(key).push(t);
    });

    const treeMat = new THREE.MeshBasicNodeMaterial();
    const treeMeshes = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v3 = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);

    chunks.forEach((list) => {
        const n = list.length;
        const geo = treeGeo.clone();
        const aPhase = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
        const aTint = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
        const mesh = new THREE.InstancedMesh(geo, treeMat, n);
        let cx = 0;
        let cz = 0;
        let maxY = -Infinity;
        let minY = Infinity;
        list.forEach((t, i) => {
            q.setFromAxisAngle(axis, t.rot);
            v3.set(t.x, t.y, t.z);
            sc.set(t.scale, t.scale * (0.85 + (t.tint * 0.4)), t.scale);
            mesh.setMatrixAt(i, m4.compose(v3, q, sc));
            aPhase.setX(i, t.rot * 3.7);
            aTint.setX(i, t.tint);
            cx += t.x;
            cz += t.z;
            maxY = Math.max(maxY, t.y + (t.scale * 5));
            minY = Math.min(minY, t.y);
        });
        cx /= n;
        cz /= n;
        geo.setAttribute('aPhase', aPhase);
        geo.setAttribute('aTint', aTint);
        mesh.instanceMatrix.needsUpdate = true;
        // Real bounds, so three can cull the chunk instead of trusting a sphere derived from
        // one un-instanced tree at the origin.
        mesh.boundingSphere = new THREE.Sphere(
            new THREE.Vector3(cx, (minY + maxY) / 2, cz),
            (CHUNK * 0.75) + ((maxY - minY) / 2) + 40,
        );
        mesh.frustumCulled = true;
        mesh.userData.centre = new THREE.Vector2(cx, cz);
        mesh.name = 'odyssey-forest-chunk';
        scene.add(mesh);
        treeMeshes.push(mesh);
    });

    // WIND: one field for the whole world. A single shared motion across every biome is the
    // strongest continuity signal after light direction (Ghost of Tsushima's guiding wind), and
    // it costs one sin() in the vertex stage.
    // THE INSTANCING RULE, and it is subtler than the note this project already carries.
    //
    // r181's NodeMaterial.setupPosition() runs `instancedMesh(object).toStack()` — which does
    // `positionLocal.assign(instanceMatrix * positionLocal)` (InstanceNode.js:166) — and THEN,
    // if positionNode is set, `positionLocal.assign(positionNode)`. So whatever positionNode
    // evaluates to REPLACES the instance transform outright.
    //
    // positionGeometry is the raw `attribute('position')`; positionLocal is the varying the
    // instance matrix was written into (Position.js:11 and :19). Therefore:
    //   - the POSITION must be built from positionLocal, or every instance collapses to origin
    //   - a local-space MASK must read positionGeometry, or it is measured in instance space
    // The existing project note covers the second half; this is the first.
    const gShade = tslAttribute('aShade', 'float');
    const gPhase = tslAttribute('aPhase', 'float');
    const gTint = tslAttribute('aTint', 'float');
    const swayMask = clamp(positionGeometry.y.div(4.5), 0, 1);
    const gust = tslSin(uTime.mul(1.4).add(gPhase).add(positionWorld.x.mul(0.006)))
        .mul(0.10).mul(swayMask.mul(swayMask));
    treeMat.positionNode = positionLocal.add(vec3(gust, 0, gust.mul(0.55)));

    const treeDark = vec3(0.050, 0.105, 0.070);
    const treeLit = vec3(0.235, 0.375, 0.175);
    const treeBase = mix(treeDark, treeLit, gShade.mul(0.75).add(gTint.mul(0.25)));
    const treeNdl = max(dot(normalWorld, uSunDir), 0.0);
    const treeLitCol = treeBase.mul(uSunColour.mul(treeNdl.mul(0.35).add(0.55))
        .add(uShadowTint.mul(0.30)));
    treeMat.colorNode = applyAerial(treeLitCol, positionWorld).mul(uExposure);

    const cp = getActiveOdysseyChapterPositions();
    const ACT_START = cp[1];
    const ACT_END = cp[5];

    const stats = {
        groundTriangles: ground.triangles,
        waterTriangles: water.triangles,
        reach: ground.reach,
        trees: treeCount,
        forestChunks: treeMeshes.length,
        bakeMs: { world: +(t1 - t0).toFixed(1), sunVis: +(t2 - t1).toFixed(1), total: +(t2 - t0).toFixed(1) },
        actRange: [ACT_START, ACT_END],
    };
    if (typeof window !== 'undefined') window.__ODYSSEY_WORLD__ = stats;
    // eslint-disable-next-line no-console
    console.log('[odyssey-world]', JSON.stringify(stats));

    const railAt = (time) => {
        const journey = Math.min(1, Math.max(0, (time % 60) / 60));
        return ACT_START + ((ACT_END - ACT_START) * journey);
    };

    return {
        cameraRadius: 1200,
        update(time) {
            uTime.value = time;
            const p = railAt(time);
            const pt = getOdysseyPathPointAt(p);
            uLodCenter.value.set(pt.x, pt.z);
            const journeyP = (p - ACT_START) / (ACT_END - ACT_START);
            const cs = sampleColourScript(0.05 + (journeyP * 0.9));
            uSkyHorizon.value.setRGB(...cs.skyHorizon);
            uSkyZenith.value.setRGB(...cs.skyZenith);
            uSunColour.value.setRGB(...cs.sun);
            uShadowTint.value.setRGB(...cs.groundShadow);
            uAerialK.value = cs.fogDensity;
            uExposure.value = cs.exposure;

            // Drop chunks the camera cannot plausibly see. Frustum culling handles direction;
            // this handles distance, which on a rail is the bigger win.
            for (let i = 0; i < treeMeshes.length; i += 1) {
                const c = treeMeshes[i].userData.centre;
                treeMeshes[i].visible = Math.hypot(c.x - pt.x, c.y - pt.z) < 1450;
            }
        },
        camera(time, cam) {
            // The REAL Odyssey rail, framed the way the shipped camera frames it: the eye
            // trails the path point along the tangent and sits a little above it, looking well
            // down-path rather than at its own feet. A short lookahead with a downward offset
            // pitches the camera ~60 degrees at the ocean, which is what the first pass did.
            const p = railAt(time);
            const pt = getOdysseyPathPointAt(p);
            const ahead = getOdysseyPathPointAt(Math.min(1, p + 0.055));
            const behind = getOdysseyPathPointAt(Math.max(0, p - 0.012));
            const tx = pt.x - behind.x;
            const ty = pt.y - behind.y;
            const tz = pt.z - behind.z;
            const tl = Math.hypot(tx, ty, tz) || 1;
            cam.position.set(
                pt.x - ((tx / tl) * 30),
                pt.y + 16,
                pt.z - ((tz / tl) * 30),
            );
            // Look ALONG the rail, with the pitch clamped rather than biased. Aiming straight
            // at a point further down the path pitches ~37 degrees up through Ch5's climb (the
            // whole world leaves the frustum); biasing the aim toward the camera's own
            // altitude over-corrects into a top-down view of the ground. A clamp keeps the
            // path direction and only limits how far the horizon may leave frame — which is
            // what the shipped build's per-chapter framing overrides are doing by hand.
            const dx = ahead.x - cam.position.x;
            const dy = ahead.y - cam.position.y;
            const dz = ahead.z - cam.position.z;
            const horiz = Math.hypot(dx, dz) || 1;
            const pitch = Math.max(-0.30, Math.min(0.16, dy / horiz));
            cam.lookAt(
                cam.position.x + dx,
                cam.position.y + (pitch * horiz),
                cam.position.z + dz,
            );
        },
        resize() {},
        dispose() {
            [groundMesh, skyMesh, waterMesh].forEach((m) => scene.remove(m));
            treeMeshes.forEach((m) => { scene.remove(m); m.geometry.dispose(); });
            treeGeo.dispose();
            treeMat.dispose();
            ground.geometry.dispose();
            water.geometry.dispose();
            mat.dispose();
            skyMat.dispose();
            waterMat.dispose();
            skyMesh.geometry.dispose();
            heightTex.dispose();
            detailTex.dispose();
            sunVisTex.dispose();
        },
    };
}
