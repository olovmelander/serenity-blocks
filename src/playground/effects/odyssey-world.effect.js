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
    normalize, positionWorld, smoothstep, texture, uniform, varying, vec2, vec3, cameraPosition,
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
const LEVELS = 7;
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

export function create({ scene }) {
    const t0 = performance.now();
    const world = buildBakes();
    const t1 = performance.now();
    const sunVisTex = bakeSunVisibility(world.sample);
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
    const gY = tslWorldMacro(g.worldXZ).add(gRelief.mul(gWeight));
    const vWeight = varying(gWeight, 'vW');
    const vSpacing = varying(g.spacing, 'vS');

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.positionNode = vec3(g.worldXZ.x, gY, g.worldXZ.y);

    const aux = texture(heightTex, vUv);
    const hDx = aux.g.mul(vWeight);
    const hDz = aux.b.mul(vWeight);
    // Macro gradient by finite difference of the analytic macro at fragment scale.
    const eps = float(6.0);
    const mHere = tslWorldMacro(positionWorld.xz);
    const mDx = tslWorldMacro(positionWorld.xz.add(vec2(6, 0))).sub(mHere).div(eps);
    const mDz = tslWorldMacro(positionWorld.xz.add(vec2(0, 6))).sub(mHere).div(eps);
    const normal = normalize(vec3(hDx.add(mDx).negate(), 1, hDz.add(mDz).negate()));

    const height = positionWorld.y;
    const slope = clamp(float(1).sub(normal.y), 0, 1);
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
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(ground.reach * 1.7, 32, 20), skyMat);
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

    const bedY = tslWorldMacro(positionWorld.xz)
        .add(texture(heightTex, wUv).r.mul(tslDetailWeight(positionWorld.xz)));
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

    const cp = getActiveOdysseyChapterPositions();
    const ACT_START = cp[1];
    const ACT_END = cp[5];

    const stats = {
        groundTriangles: ground.triangles,
        waterTriangles: water.triangles,
        reach: ground.reach,
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
            cam.lookAt(ahead.x, ahead.y + 10, ahead.z);
        },
        resize() {},
        dispose() {
            [groundMesh, skyMesh, waterMesh].forEach((m) => scene.remove(m));
            ground.geometry.dispose();
            water.geometry.dispose();
            mat.dispose();
            skyMat.dispose();
            waterMat.dispose();
            skyMesh.geometry.dispose();
            heightTex.dispose();
            sunVisTex.dispose();
        },
    };
}
