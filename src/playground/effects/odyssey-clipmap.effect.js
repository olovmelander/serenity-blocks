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

function hash2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
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

function bakeReliefTexture() {
    // AUX BAKE (plan 3.2). R = local relief, G = dH/dx, B = dH/dz, A = curvature.
    //
    // The derivatives are produced by CENTRAL-DIFFERENCING THE BAKED HEIGHTS - never by
    // re-evaluating an analytic derivative - so lighting describes exactly the surface the
    // vertex shader displaces to. That is what structurally kills the phantom-shading-seam
    // class of bug, and it is also the biggest fragment-cost lever here: the fragment shader
    // was doing FOUR dependent texture fetches per pixel to rebuild these; now it does one.
    // Curvature (a Laplacian) rides along in A as a free biome selector.
    //
    // Half-float is filterable everywhere with NO feature request. float32-filterable is
    // optional in WebGPU, and r181's defensive fallback covers only DataTexture, not render
    // targets - so half-float is the correct choice here, not a compromise.
    const data = new Uint16Array(RELIEF_RES * RELIEF_RES * 4);
    const step = WORLD_EXTENT / (RELIEF_RES - 1);
    const origin = -WORLD_EXTENT / 2;

    const heights = new Float32Array(RELIEF_RES * RELIEF_RES);
    for (let j = 0; j < RELIEF_RES; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < RELIEF_RES; i += 1) {
            heights[(j * RELIEF_RES) + i] = odysseyRelief(origin + (i * step), z);
        }
    }

    const at = (i, j) => {
        const ci = Math.max(0, Math.min(RELIEF_RES - 1, i));
        const cj = Math.max(0, Math.min(RELIEF_RES - 1, j));
        return heights[(cj * RELIEF_RES) + ci];
    };
    for (let j = 0; j < RELIEF_RES; j += 1) {
        for (let i = 0; i < RELIEF_RES; i += 1) {
            const h = heights[(j * RELIEF_RES) + i];
            const dHdx = (at(i + 1, j) - at(i - 1, j)) / (2 * step);
            const dHdz = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
            const lap = (at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1)) - (4 * h);
            const idx = ((j * RELIEF_RES) + i) * 4;
            data[idx] = THREE.DataUtils.toHalfFloat(h);
            data[idx + 1] = THREE.DataUtils.toHalfFloat(dHdx);
            data[idx + 2] = THREE.DataUtils.toHalfFloat(dHdz);
            data[idx + 3] = THREE.DataUtils.toHalfFloat(lap / step);
        }
    }

    const tex = new THREE.DataTexture(data, RELIEF_RES, RELIEF_RES, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

// ── The clipmap mesh — built once, never touched again ───────────────────────────
function buildClipmapGeometry() {
    const perLevel = (GRID_N + 1) * (GRID_N + 1);
    const positions = new Float32Array(LEVELS * perLevel * 3);
    const indices = [];
    const holeHalf = (HALF / 2) - HOLE_SHRINK;

    for (let level = 0; level < LEVELS; level += 1) {
        const vertBase = level * perLevel;
        for (let j = 0; j <= GRID_N; j += 1) {
            for (let i = 0; i <= GRID_N; i += 1) {
                const v = (vertBase + j * (GRID_N + 1) + i) * 3;
                // NOT a position: (gridI, ringLevel, gridJ). The vertex stage turns this into
                // a world position. Nothing here is ever uploaded again.
                positions[v] = i - HALF;
                positions[v + 1] = level;
                positions[v + 2] = j - HALF;
            }
        }
        for (let j = 0; j < GRID_N; j += 1) {
            for (let i = 0; i < GRID_N; i += 1) {
                const gi = i - HALF;
                const gj = j - HALF;
                if (level > 0) {
                    // Skip quads entirely inside the hole this ring surrounds. The hole is cut
                    // HOLE_SHRINK cells SMALLER than the ring inside it, so consecutive rings
                    // always overlap and can never open a gap when their independently-snapped
                    // origins drift apart.
                    const inHole = Math.max(Math.abs(gi), Math.abs(gi + 1), Math.abs(gj), Math.abs(gj + 1)) <= holeHalf;
                    if (inHole) continue;
                }
                const a = vertBase + j * (GRID_N + 1) + i;
                const b = a + 1;
                const c = a + (GRID_N + 1);
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
    const reach = HALF * BASE_SPACING * (2 ** (LEVELS - 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), reach * Math.SQRT2 + RELIEF_SCALE);
    geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(-reach, -RELIEF_SCALE, -reach),
        new THREE.Vector3(reach, RELIEF_SCALE, reach),
    );
    return {
        geometry, triangles: indices.length / 3, vertices: LEVELS * perLevel, reach,
    };
}

export function create({ scene, camera, renderer }) {
    const heightTex = bakeReliefTexture();
    const {
        geometry, triangles, vertices, reach,
    } = buildClipmapGeometry();

    const uLodCenter = uniform(new THREE.Vector2(0, 0));
    const uSunDir = uniform(new THREE.Vector3(0.35, 0.62, -0.70).normalize());

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

    // ── Lighting: ONE sun (plan §3.4) ───────────────────────────────────────────
    const ndl = max(dot(normal, uSunDir), 0.0);
    const sky = vec3(0.42, 0.56, 0.78);
    const sun = vec3(1.00, 0.94, 0.84);
    let lit = albedo.mul(sun.mul(ndl.mul(0.86).add(0.10)).add(sky.mul(0.34)));

    // ── One aerial-perspective function, applied here and by everything else ────
    // Distance from the EYE, not from the world origin. The first pass hazed by absolute
    // world position, so ground 2000u from origin was 57% washed even when it was near.
    const dist = length(positionWorld.sub(cameraPosition));
    const horizonCol = vec3(0.70, 0.80, 0.92);
    const aerial = float(1.0).sub(exp(dist.mul(-0.00016)));
    lit = mix(lit, horizonCol, clamp(aerial, 0.0, 0.80));

    material.colorNode = lit;
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
    const skyGeo = new THREE.SphereGeometry(reach * 1.6, 24, 16);
    const skyMat = new THREE.MeshBasicNodeMaterial();
    const up = clamp(positionWorld.y.div(reach).mul(2.2).add(0.12), 0.0, 1.0);
    skyMat.colorNode = mix(vec3(0.70, 0.80, 0.92), vec3(0.24, 0.44, 0.78), up);
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -100;
    scene.add(skyMesh);

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
        drawCallsExpected: 2,
    };
    if (typeof window !== 'undefined') window.__ODYSSEY_CLIPMAP__ = stats;
    // eslint-disable-next-line no-console
    console.log('[odyssey-clipmap]', JSON.stringify(stats));

    return {
        cameraRadius: 2400,
        update(time) {
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
            cam.position.set(cx + 220, odysseyHeight(cx, cz) + 230, cz);
            cam.lookAt(HERO_X, HERO_H * 0.62, HERO_Z);
        },
        resize() {},
        dispose() {
            scene.remove(mesh);
            scene.remove(skyMesh);
            geometry.dispose();
            material.dispose();
            skyGeo.dispose();
            skyMat.dispose();
            heightTex.dispose();
            if (renderer && camera) { /* nothing renderer-owned to release */ }
        },
    };
}
