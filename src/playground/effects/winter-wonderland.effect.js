/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, camelcase */
/**
 * Winter Wonderland — the COMPLETE winter scene in one playground effect, authored
 * the halcyon-apex way (whole scene here; the theme becomes a thin wrapper).
 *
 * A dark winter night: cobalt sky + volumetric aurora, a bright moon with halo,
 * a vast wind-carved snow field (snowflow-rebuild polar twilight: warm horizon
 * band + blue zenith), layered snow peaks on the horizon, arctic foxes leaving
 * real deformation trails, and heavy full-screen falling snow. No trees, no
 * lake — just snow, mountains, sky and foxes. No post-processing here (the
 * theme's WinterPipeline grades in-game; ?grade=1 emulates it).
 *
 * One palette (WINTER_PALETTE): cobalt night / cyan ice / emerald-teal aurora /
 * white moon, so every layer reads as one painting. Composition + framing solved
 * for the FOV-55 playground camera.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, uniform, attribute, uv, positionLocal, positionWorld, positionView, normalWorld,
    normalize, vec2, vec3, vec4, float, mix, clamp, smoothstep, sin, cos, mod, pow,
    length, cameraPosition, texture, dFdx, dFdy, max, toneMapping, If,
} from 'three/tsl';
import {
    TWILIGHT_DIR, TWILIGHT_RADIANCE, MOON_RADIANCE, WARM_HORIZON,
    AMB_ZENITH, AMB_HORIZON, uAuroraAmbient, updateAuroraAmbient,
    SNOW_ALBEDO, SNOW_ALBEDO_COMPRESSED, SNOW_ALBEDO_BERM, DEEP_TINT,
    tslNoised, ridged3, rotN, rotTN,
    wrapDiffuseN, backScatterN, sssTintN, ggxSpecN, glintFieldN,
} from '../../themes/winter/lighting/winter-light-rig.js';
import { createAuroraVolume } from '../../themes/winter/rendering/aurora-volume.js';
import { createArcticFox } from '../../themes/winter/rendering/arctic-fox.js';
import {
    createWinterSnowDetail, disposeWinterSnowDetail, snowLumaPlanar, snowPerturbNormal,
} from '../../themes/winter/rendering/snow-detail.js';
import { createPawTrail } from '../../themes/winter/rendering/paw-trail.js';
import { createPawTrailGpu } from '../../themes/winter/rendering/paw-trail-gpu.js';
import { createSnowPuffs } from '../../themes/winter/rendering/snow-puff.js';
import { SnowSim } from '../../themes/winter/sim/snow-sim.js';
import { createSnowRenderer } from '../../themes/winter/rendering/snow-renderer.js';
import {
    createWinterMoonNodeMaterial,
    createWinterMoonHaloNodeMaterial,
} from '../../themes/winter/winter-materials.js';

export const meta = {
    id: 'winter-wonderland',
    title: 'Winter Wonderland (full scene)',
    description: 'Polar twilight — vast carved snow field, aurora, moon, peaks, foxes.',
};

// ── One four-family palette (single source of truth) ──────────────────────────
const PAL = {
    skyTop: 0x040a1c,
    skyHorizon: 0x0a1c38,
    cobaltDeep: 0x081a30,
    cobaltMid: 0x12325a,
    cobaltLit: 0x2b5a93,
    iceShore: 0x0c4a5e,
    iceCenter: 0x1fb6c4,
    iceCrack: 0x9fe8f4,
    auroraEmerald: 0x39e0a0,
    auroraTeal: 0x2aa890,
    auroraCyanTip: 0x7ff2d6,
    moonWhite: 0xf4f8ff,
    snowLit: 0xbcd2ef,
    snowShadow: 0x4f6f9e,
};

const FEET_Y = -260;
const GROUND_Y = -280;
// Snowflow-rebuild world calibration: ground-shading constants ported from the
// metre-scaled snowlab are multiplied by UPM (world units per metre). Wind held
// ~75° off the twilight azimuth (207°) so the raking key crosses the sastrugi.
// ── Quality tiers ───────────────────────────────────────────────────────────
// Everything the snowflow rebuild added is expensive in a DIFFERENT way to the
// old scene (fragment ALU, not draw calls), so the tiers scale the new costs:
// aurora march depth (measured at ~76% of GPU frame before optimisation),
// ground grid density, falling-snow instances, glint octaves and the trail's
// self-shadow march. `?winterQ=low|medium|high|ultra` overrides for testing.
const QUALITY_TIERS = {
    ultra: {
        snow: 1.0, aurora: 26, seg: [340, 300], nearCell: 6, glintOctaves: 2, shadowTaps: 8,
    },
    high: {
        snow: 0.8, aurora: 22, seg: [300, 264], nearCell: 7, glintOctaves: 2, shadowTaps: 6,
    },
    medium: {
        snow: 0.55, aurora: 16, seg: [240, 212], nearCell: 9, glintOctaves: 1, shadowTaps: 4,
    },
    low: {
        snow: 0.35, aurora: 12, seg: [180, 160], nearCell: 12, glintOctaves: 1, shadowTaps: 3,
    },
};

const UPM = 60;
const WIND_BEARING = (132 * Math.PI) / 180;

// ── Snowlab wind-carved landform (CPU mirror) ────────────────────────────────
// The SAME dune/swell/drift stack the snowlab proved (snowflow terrainMacro
// port, metres × UPM). One JS function feeds BOTH the ground mesh displacement
// and the foxes' analytic grounding, so the two can never disagree.
function snowHash2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
}

function snowVnoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = snowHash2(xi, yi);
    const b = snowHash2(xi + 1, yi);
    const c = snowHash2(xi, yi + 1);
    const d = snowHash2(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function snowFbm(x, y, octaves, lacunarity, gain) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
        sum += (snowVnoise(x * freq, y * freq) * 2 - 1) * amp;
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    return sum / norm;
}

function snowWindWarp(x, z, angle, sx, sz, scale) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [((x * c - z * s) * sx) / scale, ((x * s + z * c) * sz) / scale];
}

/**
 * A graded 1-D axis: cells grow geometrically outward from the centre, so the
 * grid is dense where the camera and the foxes are and coarse at the horizon —
 * snowflow solves the same problem with a nested-ring clipmap (8.5 cm inner
 * spacing). Doing it by grading ONE plane keeps a single seamless mesh and a
 * single draw call, with no z-fighting against a second dense patch.
 * Returns { pos, cell } — vertex coordinates and the local cell size at each.
 */
function gradedAxis(halfExtent, cells, nearCell) {
    const half = cells / 2;
    const total = (r) => (Math.abs(r - 1) < 1e-9
        ? nearCell * half
        : nearCell * ((r ** half) - 1) / (r - 1));
    let lo = 1.0;
    let hi = 1.25;
    for (let i = 0; i < 64; i += 1) {
        const mid = (lo + hi) * 0.5;
        if (total(mid) < halfExtent) lo = mid; else hi = mid;
    }
    const r = (lo + hi) * 0.5;
    const pos = new Float32Array(cells + 1);
    const cell = new Float32Array(cells + 1);
    pos[half] = 0;
    cell[half] = nearCell;
    let acc = 0;
    for (let k = 0; k < half; k += 1) {
        const w = nearCell * (r ** k);
        acc += w;
        pos[half + k + 1] = acc;
        pos[half - k - 1] = -acc;
        cell[half + k + 1] = w;
        cell[half - k - 1] = w;
    }
    return { pos, cell };
}

/** Field height in WORLD UNITS at world (x, z), relative to the ground origin. */
function snowFieldHeight(xu, zu) {
    const x = xu / UPM;
    const z = zu / UPM;
    const [bx, bz] = snowWindWarp(x, z, WIND_BEARING, 2.1, 1.0, 58.0);
    const broad = snowFbm(bx, bz, 5, 2.03, 0.5);
    let h = broad * 4.6;
    const [sx, sz] = snowWindWarp(x, z, WIND_BEARING, 1.35, 1.0, 210.0);
    h += snowFbm(sx + 7.3, sz + 3.1, 3, 2.11, 0.55) * 5.0;
    const [mx, mz] = snowWindWarp(x, z, WIND_BEARING, 1.55, 1.0, 13.5);
    const med = snowFbm(mx + broad * 2.4, mz, 4, 2.07, 0.48);
    const shelter = Math.min(1, Math.max(0.15, 0.5 - broad * 0.75));
    h += med * 1.25 * shelter;
    return h * UPM;
}
const MOON_POS = new THREE.Vector3(1650, 1050, -2400);

// ── AAA falling-snow tiers (camera-relative GPU-compute billboards) ──
// docs/WINTER_SNOW_MASTERPIECE_PLAN.md. `bounds` = half-extents of the wrap box
// centred on the live camera; `boxOffset` shifts it forward(-z)/up so the volume
// sits in front of the eye. Depth comes from STRATIFICATION (far→mid→near→bokeh),
// each tier with its own size / fall speed / colour / blend.
const SNOW_TIERS = [
    {
        name: 'far',
        sim: {
            count: 6000,
            bounds: { x: 2400, y: 1400, z: 1500 },
            boxOffset: new THREE.Vector3(0, 160, -650),
            fallSpeed: 38,
            curlFreq: 0.0035,
            curlStr: 16,
            breeze: new THREE.Vector3(12, 0, 5),
            gustFreq: 0.18,
            gustAmp: 0.7,
            inertia: 0.12,
            spinRate: 0.25,
        },
        render: {
            shape: 'gaussian',
            color: 0xcfe0ff,
            size: 2.6,
            opacity: 0.24,
            glint: 0.0,
            fogNear: 1300,
            fogFar: 3000,
            fogStrength: 0.9,
            additive: false,
            renderOrder: 1,
        },
    },
    {
        name: 'mid',
        sim: {
            count: 4500,
            bounds: { x: 1500, y: 1050, z: 1100 },
            boxOffset: new THREE.Vector3(0, 90, -460),
            fallSpeed: 66,
            curlFreq: 0.006,
            curlStr: 26,
            breeze: new THREE.Vector3(16, 0, 7),
            gustFreq: 0.22,
            gustAmp: 0.85,
            inertia: 0.18,
            spinRate: 0.6,
        },
        render: {
            shape: 'star',
            color: 0xf5f8ff,
            size: 4.4,
            opacity: 0.42,
            glint: 0.35,
            fogNear: 1100,
            fogFar: 2800,
            fogStrength: 0.45,
            additive: false,
            renderOrder: 2,
        },
    },
    {
        name: 'near',
        sim: {
            count: 1000,
            bounds: { x: 820, y: 680, z: 720 },
            boxOffset: new THREE.Vector3(0, 30, -300),
            fallSpeed: 92,
            curlFreq: 0.009,
            curlStr: 42,
            breeze: new THREE.Vector3(22, 0, 10),
            gustFreq: 0.26,
            gustAmp: 1.1,
            inertia: 0.22,
            spinRate: 1.0,
        },
        render: {
            shape: 'star',
            color: 0xd8f0ff,
            size: 12,
            opacity: 0.6,
            glint: 0.9,
            fogNear: 1600,
            fogFar: 3200,
            fogStrength: 0.1,
            additive: false,
            renderOrder: 3,
        },
    },
    {
        name: 'bokeh',
        sim: {
            count: 12,
            bounds: { x: 650, y: 420, z: 150 },
            boxOffset: new THREE.Vector3(0, 70, -170),
            fallSpeed: 22,
            curlFreq: 0.004,
            curlStr: 8,
            breeze: new THREE.Vector3(10, 0, 4),
            gustFreq: 0.15,
            gustAmp: 0.5,
            inertia: 0.10,
            spinRate: 0.25,
        },
        render: {
            shape: 'bokeh',
            color: 0xeaf2ff,
            size: 90,
            opacity: 0.1,
            glint: 0.0,
            fogNear: 1400,
            fogFar: 3000,
            fogStrength: 0.0,
            additive: true,
            renderOrder: 4,
        },
    },
];

// ── Vertex-animated full-screen falling snow (no compute; wraps in a world box) ──
function buildSnow(count, box) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        positions[i * 3] = (Math.random() - 0.5) * box.w + box.cx;
        positions[i * 3 + 1] = (Math.random() - 0.5) * box.h + box.cy;
        positions[i * 3 + 2] = (Math.random() - 0.5) * box.d + box.cz;
        seeds[i] = Math.random();
        sizes[i] = 0.6 + Math.random() * 1.8;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const uTime = uniform(0);
    const aSeed = attribute('aSeed');
    const aSize = attribute('aSize');
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;

    const tau = float(Math.PI * 2);
    const fallSpeed = float(70).add(aSeed.mul(70));
    const bottom = float(box.cy - box.h * 0.5);
    const y0 = positionLocal.y.sub(bottom);
    const yWrapped = mod(y0.sub(uTime.mul(fallSpeed)), float(box.h)).add(bottom);
    const swayX = sin(uTime.mul(0.5).add(aSeed.mul(tau))).mul(float(30).add(aSeed.mul(40)));
    const swayZ = cos(uTime.mul(0.4).add(aSeed.mul(tau))).mul(22);
    material.positionNode = vec3(positionLocal.x.add(swayX), yWrapped, positionLocal.z.add(swayZ));
    material.sizeNode = aSize.mul(float(820).div(positionView.z.negate()));
    material.colorNode = vec3(0.74, 0.82, 0.96);
    material.opacityNode = clamp(aSize.mul(0.28).add(0.18), 0.0, 0.7);

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return {
        points, geometry, material, uTime,
    };
}

function buildFacetedSnowDrifts({
    width = 20000, depth = 16000, segX = 340, segZ = 300, nearCell = 6, reliefScale = 0.85,
    posY = -280, posZ = -500, moonDir = new THREE.Vector3(1500, 820, -2400),
    // PolyHaven snow detail: smooth normals + perturb the lighting normal with a snow nor_gl
    // map + a luminance tooth. Tooth/normal DIMMED (the photoreal grain fought the soft-pillow
    // target — fluffy comes from form + soft light, not gritty detail).
    smooth = true, detailDiff = null, detailNor = null,
    toothScale = 0.0042, toothLo = 0.94, toothHi = 1.05,
    // nor_gl tiled every 1/norScale units: a small scale + strong tilt reads as a repeating
    // lighting GRID ("dark squares") once the cold grade boosts contrast. Bigger + softer.
    norScale = 0.006, norStrength = 0.2,
    trail = null, // { texture, uOrigin, uInvSize } → fox paw-trail map
    tier = QUALITY_TIERS.ultra,
    gradePreview = false, // playground-only: emulate the WinterPipeline grade in-material
} = {}) {
    const geometry = new THREE.PlaneGeometry(width, depth, segX, segZ);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position;
    const hArr = new Float32Array(pos.count); // per-vertex heights → baked AO + crest attrs
    // Remap the uniform lattice onto a GRADED one: ~`nearCell` units per cell in
    // the fox/camera zone at the centre, growing to hundreds at the horizon. The
    // near field is now dense enough for the trail to be REAL DISPLACED GEOMETRY
    // (see positionNode below) rather than only a normal-map illusion.
    const axX = gradedAxis(width / 2, segX, nearCell);
    const axZ = gradedAxis(depth / 2, segZ, nearCell);
    const colsG = segX + 1;
    // Snowlab wind-carved landform: anisotropic dunes + long swell + sheltered
    // drifts (snowflow terrainMacro port). The field runs unbroken to the
    // horizon haze the sky's mountain chain rises out of.
    for (let i = 0; i < pos.count; i += 1) {
        const ix = i % colsG;
        const iz = (i / colsG) | 0;
        const wx = axX.pos[ix];
        const lz = axZ.pos[iz];
        pos.setX(i, wx);
        pos.setZ(i, lz);
        const h = snowFieldHeight(wx, lz + posZ) * reliefScale;
        hArr[i] = h;
        pos.setY(i, h);
    }
    // Bake per-vertex depth cues (vertex-time, free on the fragment path):
    //   aHeight    → crest highlight (brighten the wind-dusted mound tops)
    //   aOcclusion → valley AO (darken troughs so the existing displacement reads as DEPTH)
    let minH = Infinity;
    let maxH = -Infinity;
    for (let i = 0; i < pos.count; i += 1) {
        if (hArr[i] < minH) minH = hArr[i];
        if (hArr[i] > maxH) maxH = hArr[i];
    }
    const span = Math.max(1e-3, maxH - minH);
    const cols = segX + 1;
    const rows = segZ + 1;
    const aHeight = new Float32Array(pos.count);
    const aOcc = new Float32Array(pos.count);
    const aoWin = 34; // concavity window (world units): >0 crest, <0 valley (wider = gentler)
    for (let iy = 0; iy < rows; iy += 1) {
        for (let ix = 0; ix < cols; ix += 1) {
            const i = iy * cols + ix;
            aHeight[i] = (hArr[i] - minH) / span;
            let sum = 0;
            let n = 0;
            if (ix > 0) { sum += hArr[i - 1]; n += 1; }
            if (ix < cols - 1) { sum += hArr[i + 1]; n += 1; }
            if (iy > 0) { sum += hArr[i - cols]; n += 1; }
            if (iy < rows - 1) { sum += hArr[i + cols]; n += 1; }
            // Curvature ≈ concavity / cell², so on the GRADED grid the raw
            // difference shrinks quadratically toward the dense centre. Normalise
            // against a reference cell or the near field loses its valley AO
            // entirely while the horizon keeps all of it.
            const cl = Math.max(1, (axX.cell[ix] + axZ.cell[iy]) * 0.5);
            const concavity = (hArr[i] - (n ? sum / n : hArr[i])) * ((56 * 56) / (cl * cl));
            const t = Math.max(0, Math.min(1, (concavity + aoWin) / (2 * aoWin)));
            aOcc[i] = t * t * (3.0 - 2.0 * t); // smoothstep: valley→0, crest→1
        }
    }
    // Blur the AO across the grid (3× 3×3 box) so it reads as SOFT shading rather than the
    // blocky per-vertex / per-triangle dark patches the coarse 120×70 grid otherwise produces.
    const aoTmp = new Float32Array(pos.count);
    let aoSrc = aOcc;
    let aoDst = aoTmp;
    for (let pass = 0; pass < 3; pass += 1) {
        for (let iy = 0; iy < rows; iy += 1) {
            for (let ix = 0; ix < cols; ix += 1) {
                let sum = 0;
                let n = 0;
                for (let dy = -1; dy <= 1; dy += 1) {
                    for (let dx = -1; dx <= 1; dx += 1) {
                        const jx = ix + dx;
                        const jy = iy + dy;
                        if (jx >= 0 && jx < cols && jy >= 0 && jy < rows) { sum += aoSrc[jy * cols + jx]; n += 1; }
                    }
                }
                aoDst[iy * cols + ix] = sum / n;
            }
        }
        const swap = aoSrc; aoSrc = aoDst; aoDst = swap;
    }
    geometry.setAttribute('aHeight', new THREE.BufferAttribute(aHeight, 1));
    geometry.setAttribute('aOcclusion', new THREE.BufferAttribute(aoSrc, 1));
    // SMOOTH shading (indexed vertex normals) removes the hard facet edges that read as
    // "squares"; the snow normal map below re-adds fine micro-relief. flatGeo path kept for
    // the original angular low-poly look (smooth:false).
    let snowGeo;
    if (smooth) {
        geometry.computeVertexNormals();
        snowGeo = geometry;
    } else {
        snowGeo = geometry.toNonIndexed();
        snowGeo.computeVertexNormals();
        geometry.dispose();
    }

    // ── Polar-twilight rig (snowflow rebuild — winter-light-rig.js) ──────────
    // The old hand-tuned moonlit palette (uLit/uShadow/uSky/uGround/uSssTint/
    // uCrest) is replaced by a radiometric snow BRDF; the WinterPipeline post
    // grade (ACES 0.82 + cold tint) tone-maps the result in-game.
    const uMoonDir = uniform(moonDir.clone().normalize());
    const uSunDirW = uniform(TWILIGHT_DIR.clone());
    const uKeyGain = uniform(1.15); // twilight-band key strength
    const uAmbGain = uniform(1.55); // night-sky ambient strength
    const uAuroraAmb = uniform(0.8); // LIVE aurora ambient (storm-driven per frame)
    const uGlintGain = uniform(1.0);
    // Linear output scale into the post grade. The snowlab operated at AgX
    // exposure 2.4; the theme grades at ACES 0.82, so the material must carry
    // ~3× the radiance to land at the same display luminance.
    const uOutGain = uniform(2.6);
    const uFog = uniform(new THREE.Color(0x12233a));
    const uTime = uniform(0);
    // Tuned against a playground capture (see the plan doc). The first pass at 0.9/13/0.5/0.8
    // read as a hard black-and-white caterpillar: arctic paws are round and FUR-COVERED, so
    // real prints are soft round dents, and the in-game WinterPipeline grade (exposure 0.82 +
    // ACES + cold tint) crushes the dark end further. Softer here, bright side overshot.
    const uTrailDarken = uniform(0.55); // compaction: packed snow cools + darkens toward periwinkle
    const uTrailNormal = uniform(0.55); // how hard the height gradient tilts the LIGHTING normal
    const uTrailHeight = uniform(15.0); // world units of relief at |h| = 1 (gradient + parallax)
    const uTrailAO = uniform(0.34); // contact AO — a pit floor sees less sky
    const uTrailShadow = uniform(0.9); // strength of the raking self-shadow march
    // Near zero now that the relief is REAL GEOMETRY (positionNode below) —
    // kept as a hair of sub-cell detail rather than the load-bearing illusion.
    const uTrailParallax = uniform(0.15);
    // Baked depth attributes → valley AO (darken troughs) + crest mask (brighten tops).
    // The whole ground shade lives inside one Fn. That is not cosmetic: TSL's
    // If() / .toVar() need a shader-function scope, and without it the GPU
    // cannot BRANCH — every pixel had to pay for the trail sampling and the
    // glint field even where both provably resolve to zero.
    const shaded = Fn(() => {
        const aOccN = mix(float(0.86), float(1.0), attribute('aOcclusion'));
        const crestN = smoothstep(0.52, 0.95, attribute('aHeight'));
        const worldXZ = positionWorld.xz;
        // World-space pixel footprint — computed once here, used by the trail's
        // footprint-widened gradients below AND every fine-layer fade further down.
        const ddxW = dFdx(worldXZ);
        const ddyW = dFdy(worldXZ);
        const fpLx = ddxW.length();
        const fpLz = ddyW.length();
        const fpG = max(vec2(fpLx, fpLz).length(), 1e-4);
        const fpMin = max(fpLx.min(fpLz), 1e-4);
        // Normal composition is deferred: macro (mesh) + fine (sastrugi) + trail
        // slopes ADD below, become ONE normal, and only then take the detail map.
        const trailGradX = float(0.0).toVar();
        const trailGradZ = float(0.0).toVar();
        // ── Fox snow DEFORMATION ──────────────────────────────────────────────────
        // docs/WINTER_FOX_PAW_TRAILS_AAA_PLAN_2026-07.md. The trail map is a SIGNED height field
        // (<0 pit, >0 the berm displaced out of it). The load-bearing step — and the whole
        // difference between a deformation and a decal — is that we reconstruct a normal from it by
        // finite differences and fold that into `nLit` *here*, BEFORE the moon dot below, so every
        // downstream term (wrap lambert, SSS, facet rim, sparkle gate) reacts to the print.
        const trailPit = float(0.0).toVar(); // 0..1 depth of the depression
        const trailLip = float(0.0).toVar(); // 0..1 height of the displaced snow
        const trailHard = float(0.0).toVar(); // 0..1 compaction (a lane walked many times)
        const trailAge = float(0.0).toVar(); // 0 fresh .. 1 old (re-frosted)
        const trailAO = float(1.0).toVar();
        const trailShade = float(1.0).toVar();
        if (trail) {
        // GPU sim (paw-trail-gpu.js): separate dep/lip/hard/age fp16 channels
        // sampled through a repointable ping-pong node. CPU fallback: legacy
        // signed-R RGBA8. One flag, two read paths, identical downstream.
            const gpuTrail = !!trail.textureNode;
            const sampleT = (u) => (gpuTrail ? trail.textureNode.sample(u) : texture(trail.texture, u));
            const NEUTRAL_F = float(128.0 / 255.0);
            const readH = (t4) => (gpuTrail ? t4.g.sub(t4.r) : t4.r.sub(NEUTRAL_F).mul(2.0));
            const rawUv = worldXZ.sub(trail.uOrigin).mul(trail.uInvSize);
            // Border fade — edge-clamped samples must never smear a print across the whole ground.
            const border = smoothstep(0.0, 0.03, rawUv.x).mul(smoothstep(1.0, 0.97, rawUv.x))
                .mul(smoothstep(0.0, 0.03, rawUv.y)).mul(smoothstep(1.0, 0.97, rawUv.y));
            const uvC = clamp(rawUv, 0.0, 1.0);
            const sampleH = (u) => readH(sampleT(u));

            // TRAIL GATE. Everything below costs ~13 texture fetches (parallax +
            // gradient taps + the 8-tap shadow march), but the deformation map
            // covers a small rect of a 20000x16000 field — every pixel outside it
            // was paying full price to sample clamped-edge zeros. `border` is pure
            // math on worldXZ, so the test itself is nearly free, and it is screen-
            // coherent (whole warps take the same branch).
            If(border.greaterThan(0.002), () => {
                // (1) PARALLAX. Batman: Arkham Origins shipped relief mapping on console precisely
                // because it is "independent of triangle density" — our exact situation, since the
                // ground grid is 100 units/cell and a paw is ~32. At this near-horizontal camera the
                // offset earns its keep; one iteration is plenty (a full POM loop is not worth it).
                const hPre = sampleH(uvC);
                // TRUE height-parallax: offset ∝ h · view.xz / |view.y|, CLAMPED to a
                // few texels. The old flat `viewXZ · h · height` approximation ignored
                // how shallow the view ray is — harmless from the old high camera, but
                // at the new grazing snow-level eye it over-shifted samples by up to
                // ~10 world units, visibly sliding every print away from the paw that
                // made it ("the trail feels behind the footsteps").
                const viewW = normalize(positionWorld.sub(cameraPosition));
                const parVec = viewW.xz.div(viewW.y.abs().max(0.35))
                    .mul(hPre).mul(uTrailHeight).mul(uTrailParallax)
                    .mul(0.5);
                const parLen = parVec.length().max(1e-5);
                const parMax = trail.uTexel.x.mul(2.5);
                const pUv = clamp(
                    uvC.add(parVec.mul(parLen.min(parMax).div(parLen)).mul(trail.uInvSize)),
                    0.0,
                    1.0,
                );

                // (2) HEIGHT + forward-difference GRADIENT, with the snowflow fix: the
                // step WIDENS with the pixel's narrow footprint axis instead of being
                // pinned to two texels. A fixed step aliases at distance and the fade
                // that "fixes" it makes the trail stop existing ~15 m out; widening the
                // baseline is the low-pass filter that fade was standing in for — the
                // trail survives as a tonal line clear across the field, and it stops
                // changing shape when only the CAMERA moves.
                const t0 = sampleT(pUv);
                const hC = readH(t0).mul(border);
                const stepW = fpMin.mul(1.4).max(trail.uTexel.x);
                const eUv = vec2(stepW.mul(trail.uInvSize.x), stepW.mul(trail.uInvSize.y));
                const hX = sampleH(clamp(pUv.add(vec2(eUv.x, 0.0)), 0.0, 1.0)).mul(border);
                const hZ = sampleH(clamp(pUv.add(vec2(0.0, eUv.y)), 0.0, 1.0)).mul(border);
                const dhx = hX.sub(hC).mul(uTrailHeight).div(stepW);
                const dhz = hZ.sub(hC).mul(uTrailHeight).div(stepW);
                // Slope-space accumulation — the trail gradient joins the macro + fine
                // slopes below and they become one normal (slopes add; never normals).
                trailGradX.assign(dhx.mul(uTrailNormal));
                trailGradZ.assign(dhz.mul(uTrailNormal));

                // Distant texels blend toward their neighbourhood so a far trail reads
                // as a continuous line, never a dotted one (their four-fetch trick,
                // approximated with the taps we already paid for).
                const wide = clamp(fpMin.div(trail.uTexel.x.mul(4.0)), 0.0, 1.0).mul(0.8);
                const hCw = mix(hC, hC.add(hX).add(hZ).div(3.0), wide);
                trailPit.assign(gpuTrail
                    ? t0.r.mul(border)
                    : clamp(hCw.negate(), 0.0, 1.0));
                trailLip.assign(gpuTrail
                    ? t0.g.mul(border)
                    : clamp(hCw, 0.0, 1.0));
                trailHard.assign((gpuTrail ? t0.b : t0.g).mul(border));
                trailAge.assign(gpuTrail ? t0.a : t0.b);

                // (3) CONTACT AO — the pit floor sees less sky, so it darkens because of its shape
                // rather than because we painted it darker.
                trailAO.assign(float(1.0).sub(trailPit.mul(uTrailAO)));

                // (4) SELF-SHADOW MARCH — the single biggest reason snowflow's trails
                // read so hard. There the displacement is REAL GEOMETRY inside three
                // shadow cascades, so every berm throws a true shadow; here we march
                // the height field along the light's ground-projected direction and ask
                // whether anything pokes above the ray. Same physics, ~8 taps.
                //
                // Two fixes over the old single tap: it marched toward the MOON (the
                // fill), not the twilight KEY, and one tap 3 texels out can only ever
                // find a shadow ~7 cm long. The key sits at 5.5°, where a 25 cm berm
                // throws over TWO METRES of shadow — long blue streaks raking away from
                // every print, which is exactly the read in the reference.
                const keyXZ = normalize(vec2(uSunDirW.x, uSunDirW.z));
                const tanEl = uSunDirW.y.abs()
                    .div(vec2(uSunDirW.x, uSunDirW.z).length().max(1e-4));
                // Reach held at ~72 world units on every tier; only the SAMPLE
                // COUNT drops, so a low tier gets a coarser shadow, never a
                // shorter one.
                const MARCH_TAPS = tier.shadowTaps;
                const MARCH_STEP = 72 / MARCH_TAPS;
                let occl = float(0.0);
                for (let s = 1; s <= MARCH_TAPS; s += 1) {
                    const d = MARCH_STEP * s;
                    const sUv = clamp(pUv.add(keyXZ.mul(d).mul(trail.uInvSize)), 0.0, 1.0);
                    const hs = sampleH(sUv).mul(border);
                    // Ray height above this receiver at distance d, in height-field units.
                    const rayH = hC.add(tanEl.mul(d).div(uTrailHeight));
                    occl = max(occl, smoothstep(0.0, 0.22, hs.sub(rayH))
                .mul(1.0 - ((s - 1) / MARCH_TAPS) * 0.56));
                }
                trailShade.assign(float(1.0).sub(occl.mul(uTrailShadow)));
            }); // end trail gate
        }
        // ── Polar-twilight snow BRDF (snowflow port; helpers in winter-light-rig) ─
        // Surface state from the trail channels. Packed snow darkens, tightens and
        // stops scattering; fresh berm powder is looser, brighter and slightly
        // BLUER (never less blue); a refrosted old print re-earns its sparkle.
        const fresh = float(1.0).sub(trailAge);
        const compression = clamp(trailPit.mul(0.75).add(trailHard.mul(0.6)), 0.0, 1.0)
            .mul(clamp(uTrailDarken.mul(1.8), 0.0, 1.0));
        const berm = clamp(trailLip.mul(fresh.mul(0.6).add(0.4)), 0.0, 1.0);

        // Wind-carved fine layers: sastrugi λ2.3 m + ripples λ0.42 m (× UPM), each
        // footprint-faded (fpG computed above the trail block), crossfaded HARD by
        // exposure (soft crossfade = corduroy).
        const veer = tslNoised(worldXZ.mul(0.0083 / UPM).add(vec2(31.7, 12.3))).x.mul(0.42);
        const stretch = tslNoised(worldXZ.mul(0.0126 / UPM).add(vec2(7.1, 41.9))).x
            .mul(0.5).add(0.5).mul(2.4).add(2.3);
        const patch = tslNoised(worldXZ.mul(0.0055 / UPM).add(vec2(5.7, 2.9))).x
            .mul(0.5).add(0.5);
        const exposureF = smoothstep(0.3, 0.7, crestN.mul(0.55).add(patch.mul(0.45)));
        const scour = smoothstep(-0.15, 0.45, tslNoised(worldXZ.mul(0.021 / UPM)).x)
            .mul(0.7).add(0.3);
        const LAM_S = 2.3 * UPM;
        const angS = veer.add(WIND_BEARING);
        const cSa = angS.cos();
        const sSa = angS.sin();
        const fadeS = smoothstep(0.35 * UPM, 1.6 * UPM, fpG).oneMinus();
        const prS = rotN(worldXZ, cSa, sSa);
        const sas = ridged3(vec2(prS.x.mul(1 / LAM_S), prS.y.mul(stretch.div(LAM_S))));
        const ampS = float(0.085 * UPM).mul(mix(0.15, 1.0, exposureF)).mul(scour).mul(fadeS);
        const gradS = rotTN(
            vec2(sas.g.x.mul(1 / LAM_S), sas.g.y.mul(stretch.div(LAM_S))),
            cSa,
            sSa,
        ).mul(ampS);
        const LAM_R = 0.42 * UPM;
        const angR = veer.mul(0.5).add(WIND_BEARING);
        const cRa = angR.cos();
        const sRa = angR.sin();
        const fadeR = smoothstep(0.06 * UPM, 0.3 * UPM, fpG).oneMinus();
        const prR = rotN(worldXZ, cRa, sRa);
        const rip = tslNoised(vec2(prR.x.mul(2.9 / LAM_R), prR.y.mul(1 / LAM_R)));
        const ampR = float(0.018 * UPM).mul(mix(1.0, 0.1, exposureF)).mul(fadeR);
        const gradR = rotTN(
            vec2(rip.yz.x.mul(2.9 / LAM_R), rip.yz.y.mul(1 / LAM_R)),
            cRa,
            sRa,
        ).mul(ampR);

        // Slopes ADD (macro from the mesh + fine + trail), then ONE normal, then
        // the tiled detail map folds in last.
        const fineMask = mix(1.0, 0.3, compression);
        const fineGrad = gradS.add(gradR).mul(fineMask)
            .clamp(vec2(-1.5, -1.5), vec2(1.5, 1.5));
        const macroGx = normalWorld.x.div(normalWorld.y.max(0.2)).negate();
        const macroGz = normalWorld.z.div(normalWorld.y.max(0.2)).negate();
        const gxT = macroGx.add(fineGrad.x).add(trailGradX);
        const gzT = macroGz.add(fineGrad.y).add(trailGradZ);
        const nGeo = normalize(vec3(gxT.negate(), 1.0, gzT.negate()));
        const nLit = detailNor
            ? snowPerturbNormal(detailNor, worldXZ, norScale, nGeo, norStrength * 2.2)
            : nGeo;

        // ── Lighting ─────────────────────────────────────────────────────────────
        const V = normalize(cameraPosition.sub(positionWorld));
        const Lsun = uSunDirW;
        const Lmoon = uMoonDir;
        const keyRad = vec3(TWILIGHT_RADIANCE.r, TWILIGHT_RADIANCE.g, TWILIGHT_RADIANCE.b)
            .mul(uKeyGain);
        const moonRad = vec3(MOON_RADIANCE.r, MOON_RADIANCE.g, MOON_RADIANCE.b);
        const INV_PI = float(0.3183098862);

        // Lee-slope self-shadow on the sastrugi-inclusive GEOMETRIC normal — every
        // ridge carries a lit flank and a shaded flank under the raking twilight.
        // The berm's contact shadow rides the same lane.
        const geoShadow = mix(
            float(0.26),
            float(1.0),
            smoothstep(0.0, 0.11, nGeo.dot(Lsun)),
        ).mul(trailShade);

        // Albedo discipline: high, narrow, slightly blue, never 1.0. Crests keep a
        // faint warm dust (the theme's identity), carved snow keeps its blue.
        const albedoSnow = vec3(SNOW_ALBEDO.r, SNOW_ALBEDO.g, SNOW_ALBEDO.b);
        const albWarm = mix(albedoSnow, albedoSnow.mul(vec3(1.07, 1.005, 0.92)), crestN.mul(0.38));
        const albedo = mix(
            mix(
                albWarm,
                vec3(SNOW_ALBEDO_COMPRESSED.r, SNOW_ALBEDO_COMPRESSED.g, SNOW_ALBEDO_COMPRESSED.b),
                compression.mul(0.85),
            ),
            vec3(SNOW_ALBEDO_BERM.r, SNOW_ALBEDO_BERM.g, SNOW_ALBEDO_BERM.b),
            berm.mul(0.55),
        );
        const roughness = mix(mix(float(0.62), float(0.34), compression), float(0.78), berm.mul(0.7));
        const thickness = mix(mix(float(1.0), float(0.35), compression), float(1.0), berm.mul(0.6));
        const wrapW = mix(float(0.62), float(0.15), compression);

        const direct = albedo.mul(INV_PI).mul(keyRad)
            .mul(wrapDiffuseN(nLit.dot(Lsun), wrapW)).mul(geoShadow)
            .add(albedo.mul(INV_PI).mul(moonRad).mul(wrapDiffuseN(nLit.dot(Lmoon), float(0.5))));

        // Back-scatter subsurface — the term that makes it read as SNOW. Only
        // partly shadowed: scattered light arrives through the drift.
        const tintS = sssTintN(thickness);
        const sss = keyRad.mul(tintS).mul(backScatterN(nLit, Lsun, V, thickness))
            .mul(geoShadow.mul(0.58).add(0.42))
            .add(moonRad.mul(tintS).mul(backScatterN(nLit, Lmoon, V, thickness)).mul(0.6))
            .mul(albedo);

        // Damped GGX — full strength on ridged normals reads as WET snow.
        const spec = ggxSpecN(nLit, V, Lmoon, roughness, moonRad).mul(0.7)
            .add(ggxSpecN(nLit, V, Lsun, roughness, keyRad).mul(0.3));

        // Ambient: night hemisphere + warm horizon term + LIVE aurora (uAuroraAmb
        // is storm-driven per frame — the snow breathes with the curtain).
        const nUp = nLit.y.mul(0.5).add(0.5);
        const sunXZg = vec2(Lsun.x, Lsun.z);
        const nXZ = vec2(nLit.x, nLit.z);
        const alongN = clamp(
            nXZ.dot(sunXZg).div(nXZ.length().mul(sunXZg.length()).max(1e-4)),
            0.0,
            1.0,
        );
        const hemi = mix(
            vec3(AMB_HORIZON.r, AMB_HORIZON.g, AMB_HORIZON.b),
            vec3(AMB_ZENITH.r, AMB_ZENITH.g, AMB_ZENITH.b),
            nUp,
        )
            .add(vec3(WARM_HORIZON.r, WARM_HORIZON.g, WARM_HORIZON.b).mul(pow(alongN, 2.0)).mul(0.10))
        // LIVE aurora colour (shared uniform, re-solved each frame) — the snow
        // blushes when the display energises into its red-crown state.
            .add(uAuroraAmbient.mul(uAuroraAmb).mul(nUp))
            .mul(uAmbGain);
        const bounce = vec3(AMB_ZENITH.r, AMB_ZENITH.g, AMB_ZENITH.b).mul(0.28)
            .mul(clamp(nLit.y.negate().mul(0.5).add(0.5), 0.0, 1.0)).mul(albedo);
        const Fr = float(0.028).add(
            max(roughness.oneMinus(), 0.028).sub(0.028)
                .mul(pow(clamp(nLit.dot(V), 1e-4, 1.0).oneMinus(), 5.0)),
        );
        const skySpec = vec3(AMB_ZENITH.r, AMB_ZENITH.g, AMB_ZENITH.b).mul(Fr).mul(uAmbGain).mul(0.8);
        const ambient = albedo.mul(INV_PI).mul(hemi.add(bounce)).add(skySpec);

        // Glints: world-anchored crystal facets off the moon. Packed snow stops
        // sparkling, a refrosted print re-earns it (age), loose berm powder
        // sparkles HARDER — the trail keeps its readable timeline.
        // GLINT GATE: both octaves fade out by fp ~= cellB * 2.2 world units, yet
        // the hashing, tangent frame and two pow(x, 780..1500) still ran on every
        // pixel past that point. Skip the whole field once it can only yield zero.
        const glintFade = clamp(fpG.div(0.185 * UPM * 2.2).oneMinus(), 0.0, 1.0);
        const glintRaw = float(0.0).toVar();
        If(glintFade.greaterThan(0.001), () => {
            glintRaw.assign(glintFieldN({
                worldXZ,
                N: nLit,
                V,
                L: Lmoon,
                fp: fpG,
                cellA: 0.052 * UPM,
                cellB: 0.185 * UPM,
                octaves: tier.glintOctaves,
            }));
        });
        const glints = moonRad.mul(9.0).mul(glintRaw).mul(uGlintGain)
            .mul(mix(float(1.0), float(0.35), compression.mul(fresh)))
            .mul(float(1.0).add(berm.mul(fresh).mul(0.9)));

        // Occlusion scales the FINISHED radiance and darkens toward BLUE — light
        // reaching a snow hollow scattered through snow to get there (cave rule).
        const ao = aOccN.mul(trailAO);
        const caveTint = mix(
            vec3(1.0, 1.0, 1.0),
            vec3(DEEP_TINT.r, DEEP_TINT.g, DEEP_TINT.b),
            ao.oneMinus().mul(0.95),
        );
        let outCol = direct.add(sss).add(spec).add(ambient).add(glints)
            .mul(ao)
            .mul(caveTint);

        // Luminance tooth (gentle grain), then aerial fog whose tint warms toward
        // the twilight band — ground and sky meet at one colour.
        if (detailDiff) {
            outCol = outCol.mul(snowLumaPlanar(detailDiff, worldXZ, toothScale, toothLo, toothHi));
        }
        const dist = length(positionWorld.sub(cameraPosition));
        const fogT = smoothstep(float(300.0), float(3400.0), dist);
        const vXZ = positionWorld.sub(cameraPosition).xz;
        const alongV = clamp(
            vXZ.dot(sunXZg).div(vXZ.length().mul(sunXZg.length()).max(1e-4)),
            0.0,
            1.0,
        );
        const fogTint = uFog.add(
            vec3(WARM_HORIZON.r, WARM_HORIZON.g, WARM_HORIZON.b).mul(pow(alongV, 3.0)).mul(0.10),
        );
        const fogged = mix(outCol, fogTint, fogT.mul(0.92)).mul(uOutGain);
        return fogged;
    })();

    const material = new THREE.MeshBasicNodeMaterial();

    // ── REAL GEOMETRIC DISPLACEMENT ─────────────────────────────────────────
    // The last structural gap against snowflow, which displaces its clipmap
    // from the deformation buffer in the vertex shader. With the graded grid
    // above putting ~`nearCell` units per cell under the foxes, a print is now
    // an actual dent in the mesh: it breaks the silhouette, occludes correctly,
    // and — the real prize — the parallax hack that faked all this (and that
    // caused the "trails feel behind the footsteps" bug) is no longer carrying
    // the effect, so it is dialled right down.
    if (trail) {
        const wxzV = vec2(positionLocal.x, positionLocal.z.add(posZ));
        const tuvV = wxzV.sub(trail.uOrigin).mul(trail.uInvSize);
        // Fade the DISPLACEMENT out at the map border; geometry cannot be
        // clamped like a sample, and a hard edge would tear the mesh.
        const bfadeV = smoothstep(0.0, 0.06, tuvV.x).mul(smoothstep(1.0, 0.94, tuvV.x))
            .mul(smoothstep(0.0, 0.06, tuvV.y)).mul(smoothstep(1.0, 0.94, tuvV.y));
        const uvV = clamp(tuvV, 0.0, 1.0);
        // The vertex stage needs its OWN sampling node — the GPU sim repoints
        // every registered node after each ping-pong swap.
        const tvNode = trail.makeNode ? trail.makeNode() : null;
        const tv = tvNode ? tvNode.sample(uvV) : texture(trail.texture, uvV);
        const hV = trail.textureNode
            ? tv.g.sub(tv.r) // GPU: berm − depression
            : tv.r.sub(float(128.0 / 255.0)).mul(2.0); // CPU: signed height
        material.positionNode = positionLocal.add(
            vec3(0.0, hV.mul(uTrailHeight).mul(bfadeV), 0.0),
        );
    }

    // In-game the WinterPipeline post applies ACES 0.82 + the cold grade; the
    // playground has no post, so ?grade=1 emulates it for colour judgment
    // (NEVER tune colours through the flat NoToneMapping view).
    material.colorNode = gradePreview
        ? toneMapping(THREE.ACESFilmicToneMapping, 0.82, shaded).mul(vec3(0.92, 0.97, 1.06))
        : clamp(shaded, 0.0, 6.0);
    material.emissiveNode = vec3(0.0);
    const mesh = new THREE.Mesh(snowGeo, material);
    mesh.position.set(0, posY, posZ);
    mesh.renderOrder = -30;
    mesh.frustumCulled = false;
    return {
        mesh,
        geometry: snowGeo,
        material,
        uTime,
        // Analytic ground height (world x/z → world y). Exact same math as the
        // mesh displacement — fox grounding without any raycast.
        heightAt: (x, z) => posY + snowFieldHeight(x, z) * reliefScale,
        // Exposed so the trail look can be tuned live from the console during a capture.
        trailUniforms: {
            uTrailDarken, uTrailNormal, uTrailHeight, uTrailAO, uTrailShadow, uTrailParallax,
        },
        // Polar-twilight rig knobs (uAuroraAmb is storm-driven every frame).
        rigUniforms: {
            uKeyGain, uAmbGain, uAuroraAmb, uGlintGain, uOutGain,
        },
    };
}

// Whiteout flash — the climax of the "Whiteout" act (Tetris / Perfect Clear).
// useMRT:false in this pipeline ⇒ no emissive bloom, so the flash is a FULLSCREEN
// white wash: an NDC quad whose vertexNode outputs clip space directly (always fills
// the screen, ignores the camera) with depthTest off so it sits on top of everything.
// Opacity follows the director's decaying `whiteout` transient; a soft center vignette
// makes it read as light flooding in rather than a flat fill. Capped < 1 so it never
// fully blanks a frame, and zeroed under reduced-motion (photosensitivity safety).
function buildWhiteoutWash() {
    const geo = new THREE.PlaneGeometry(2, 2);
    const uOpacity = uniform(0);
    const uColor = uniform(new THREE.Color(0xeef4ff));
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
    });
    // Fullscreen NDC quad — bypass the view/projection entirely.
    material.vertexNode = vec4(positionLocal.xy, 0.0, 1.0);
    const d = length(uv().sub(vec2(0.5, 0.5)));
    const bloom = smoothstep(0.95, 0.12, d); // brightest at center, falls to the corners
    const alpha = clamp(uOpacity.mul(float(0.5).add(bloom.mul(0.6))), 0.0, 0.92);
    material.colorNode = vec4(uColor, alpha);
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 100000; // draw last, over the entire scene
    return {
        mesh, material, uOpacity, dispose() { geo.dispose(); material.dispose(); },
    };
}

export function create({
    scene, renderer, camera, params, quality,
}) {
    const disposables = [];
    const track = (obj) => { disposables.push(obj); return obj; };
    let prevTime = 0;

    // Resolved BEFORE anything that reads it — the aurora dome is built early
    // and takes its march depth from the tier.
    const gradeOn = params?.get?.('grade') === '1';
    const tier = QUALITY_TIERS[params?.get?.('winterQ') ?? quality] ?? QUALITY_TIERS.ultra;

    // --- Pointer parallax + idle "breathing" camera state ---
    let pointerX = 0;
    let pointerY = 0;
    let smoothPointerX = 0;
    let smoothPointerY = 0;
    let prevCamTime = 0;
    let lastPX = 0; // for idle (cursor-still) detection → camera breathing
    let lastPY = 0;
    let camIdle = 0;
    const onPointerMove = (e) => {
        pointerX = (e.clientX / window.innerWidth) * 2 - 1;
        pointerY = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (typeof window !== 'undefined') window.addEventListener('pointermove', onPointerMove);

    // --- Sky + volumetric aurora dome (APPROVED) ---
    const aurora = createAuroraVolume({
        radius: 6000,
        steps: tier.aurora,
        accent: new THREE.Color(PAL.auroraEmerald),
        moonDir: MOON_POS.clone(),
    });
    aurora.uniforms.uIntensity.value = 0.62;
    scene.add(aurora.mesh);
    disposables.push(aurora);

    // --- Moon + halo (upper-right) ---
    const { material: moonMat } = createWinterMoonNodeMaterial({ color: new THREE.Color(PAL.moonWhite) });
    const moon = new THREE.Mesh(track(new THREE.SphereGeometry(190, 32, 24)), moonMat);
    moon.position.copy(MOON_POS);
    scene.add(moon);
    const { material: haloMat, uniforms: haloU } = createWinterMoonHaloNodeMaterial({
        intensity: 0.5, color: new THREE.Color(PAL.auroraCyanTip),
    });
    moon.add(new THREE.Mesh(track(new THREE.SphereGeometry(360, 24, 16)), haloMat));

    // (Moon clouds removed 2026-08-13 per user direction — a clean polar sky.)

    // --- Layered mountains (APPROVED look; placement reworked to reference) ---
    // Pushed FAR back + LOWERED to a distant, atmospheric (fog-blued) backdrop —
    // in the reference the peaks are a low, hazy-blue range sitting BELOW the aurora,
    // with the conifer treeline reading clearly in front. Tighter fog blues them out.
    // Nearest feet ≈ z-3200, well behind the treeline (z-1880…-2360).
    // Mountain GEOMETRY removed (user direction 2026-08-13): the chain now
    // lives on the distant horizon as a layered silhouette painted directly
    // into the aurora dome's sky shader (aurora-volume.js §far mountain chain)
    // — infinitely far by construction, hazed into the same colour band the
    // ground fog resolves to. `buildWinterPeak` above is retired dead code.

    // --- Fox SNOW DEFORMATION: a persistent signed height field stamped by the foxes' footfalls
    // and behaviours, sampled by the snow ground for real shading (gradient normal, contact AO,
    // contact shadow, parallax). See docs/WINTER_FOX_PAW_TRAILS_AAA_PLAN_2026-07.md.
    // GPU deformation sim (snowflow deformSim port: diffusion + berm slump +
    // wind infill on fp16 ping-pong) with the CPU original as an instant
    // fallback: WebGPU-compute unavailable, or ?trailCpu=1 to A/B the two.
    const useGpuTrail = !!(renderer && typeof renderer.compute === 'function')
        && params?.get?.('trailCpu') !== '1';
    const trailOpts = {
        origin: [-1200, -1880],
        size: [2400, 2320],
        // 1024² → 2.34 world units/texel. The foxes are `scale: 80`, so a paw is ~8 units: at
        // 512² that is 1.7 texels and the displaced berm ring lands BELOW one texel — i.e.
        // unrepresentable. 1024² puts the paw at ~3.4 texels and the berm at ~1.9, which is the
        // minimum that resolves.
        res: 1024,
        // Seconds to completely refill a full-depth mark. The StormDirector idles at 0.12, so a
        // calm night buries a fresh print in ~40 s and a well-trodden lane in ~112 s; a combo
        // blizzard erases everything in a few seconds.
        tauCalm: 45.0,
        tauStorm: 3.5,
    };
    const pawTrail = useGpuTrail
        ? createPawTrailGpu({ ...trailOpts, renderer })
        : createPawTrail(trailOpts);

    // Debug framing override, honoured by camera() below. Null in normal play.
    let camOverride = null;

    // --- Snow drift field — smooth + PolyHaven snow detail (no more "built from squares") ---
    // snow_01 (or snow_02): diffuse → painterly luminance tooth, nor_gl → lighting micro-relief.
    const snowDetail = createWinterSnowDetail('snow_01');
    const drifts = buildFacetedSnowDrifts({
        // Centred on the fox/camera zone (world z ≈ −500) so the GRADED grid's
        // dense middle lands exactly where prints must displace real geometry;
        // it still reaches world z ≈ −8500 for the horizon haze.
        width: 20000,
        depth: 16000,
        segX: tier.seg[0],
        segZ: tier.seg[1],
        nearCell: tier.nearCell, // ultra ≈10 cm per cell under the foxes (snowflow: 8.5 cm)
        reliefScale: 0.85,
        posY: GROUND_Y,
        posZ: -500,
        moonDir: MOON_POS.clone(),
        tier,
        smooth: true,
        detailDiff: snowDetail.diff,
        detailNor: snowDetail.nor,
        trail: {
            texture: pawTrail.texture,
            textureNode: pawTrail.textureNode, // present → GPU dep/lip/hard/age semantics
            uOrigin: pawTrail.uOrigin,
            uInvSize: pawTrail.uInvSize,
            uTexel: pawTrail.uTexel,
        },
        // Playground-only grade emulation (?grade=1); the theme wrapper passes
        // no params and gets the linear output for the real post pipeline.
        gradePreview: gradeOn,
    });
    scene.add(drifts.mesh);
    disposables.push(drifts);

    // Low, snowlab-like eye: pinned to the ACTUAL snow surface. Sample the near
    // field's crests so the lowered camera never sits inside a dune; ~140 units
    // ≈ 2.3 m at UPM 60 — the grazing height that makes sastrugi + trails read.
    let camGround = -Infinity;
    for (let sx = -420; sx <= 420; sx += 140) {
        for (let sz = 820; sz >= -260; sz -= 120) {
            camGround = Math.max(camGround, drifts.heightAt(sx, sz));
        }
    }
    const camRestY = camGround + 140;

    // Footfall powder — the moment of contact. Without it the deformation appears out of thin
    // air, which reads as a decal switching on rather than a paw pressing into snow.
    const snowPuffs = createSnowPuffs({ pool: 96 });
    scene.add(snowPuffs.mesh);
    disposables.push(snowPuffs);

    // --- Arctic foxes trotting across the open snow field (TRELLIS.2 low-poly,
    // rigged "Run" clip). Unlit like the rest of the scene; grounded ANALYTICALLY
    // on the same snowFieldHeight() the mesh is displaced with (no raycast). ---
    const arcticFox = createArcticFox(scene, {
        // Small foxes so the landscape reads vast/majestic; they fade into the
        // haze with distance (see arctic-fox.js).
        heightAt: drifts.heightAt,
        gradePreview: gradeOn,
        footIk: params?.get?.('foxIk') !== '0',
        fallbackY: FEET_Y,
        count: 3,
        scale: 80,
        trail: pawTrail, // footfalls, pounce craters, dig fans and sleeping hollows
        puffs: snowPuffs, // …and the powder each of those kicks up
    });
    arcticFox.load();

    // Debug handle (harmless, same spirit as `group.userData.foxes`): lets a capture session
    // inspect the deformation field, tune its shading, stage a behaviour, and fly in close
    // enough to actually judge ground detail — the shipping camera is ~1 km from the treeline.
    if (typeof window !== 'undefined') {
        window.__winterDebug = {
            trail: pawTrail,
            puffs: snowPuffs,
            trailUniforms: drifts.trailUniforms,
            foxes: () => arcticFox.group.userData.foxes ?? [],
            // Dial the model's own baked head tilt out by eye, in DEGREES, then
            // tell me the numbers and I'll bake them in as the default.
            headTrim: (yaw = 0, pitch = 0, roll = 0) => arcticFox.setHeadTrim(yaw, pitch, roll),
            setFoxState: (i, s) => arcticFox.group.userData.setFoxState?.(arcticFox.group.userData.foxes[i], s),
            setCamera(pos, look, fov = 40) {
                camOverride = pos ? { pos, look, fov } : null;
            },
        };
    }

    // --- Falling snow: AAA multi-tier, camera-relative GPU-compute system ---
    // (docs/WINTER_SNOW_MASTERPIECE_PLAN.md). Far→mid→near→bokeh tiers wrap around
    // the live camera. Graceful fallback to the legacy vertex-animated Points cloud
    // when WebGPU compute is unavailable.
    const uSnowCamPos = uniform(new THREE.Vector3(0, 78, 760));
    const uSnowAurora = uniform(0);
    const snowTiers = [];
    let snowFallback = null;
    let snowComputeErr = false;
    const snowComputeOk = renderer && typeof renderer.compute === 'function';
    if (snowComputeOk) {
        SNOW_TIERS.forEach((st) => {
            const count = Math.max(64, Math.round(st.sim.count * tier.snow));
            const sim = new SnowSim({ ...st.sim, count, camPosUniform: uSnowCamPos });
            sim.createComputeNode();
            const rend = createSnowRenderer(sim, { ...st.render, auroraTintUniform: uSnowAurora });
            scene.add(rend.mesh);
            snowTiers.push({ sim, rend });
        });
    } else {
        snowFallback = buildSnow(4200, {
            w: 4600, h: 2800, d: 3800, cx: 0, cy: 560, cz: -1000,
        });
        scene.add(snowFallback.points);
        disposables.push(snowFallback);
    }

    // ── Storm reactivity (combo "Living Blizzard", quick-win #1) ─────────────────
    // Capture each snow tier's baseline wind, then drive them as multipliers of a
    // single master intensity S∈[0,1]: snow leans + blasts SIDEWAYS and the curl
    // SWIRL deepens as S climbs. S is set by the theme via setReactive(directorState),
    // or by a ?winterStorm=1 debug slider here in the playground. Pure uniform writes
    // (zero recompile). See docs/WINTER_BLIZZARD_COMBO_PLAN.md.
    const snowBase = snowTiers.map(({ sim, rend }) => ({
        bx: sim.uBreeze.value.x,
        bz: sim.uBreeze.value.z,
        curlStr: sim.uCurlStr.value,
        curlFreq: sim.uCurlFreq.value,
        fall: sim.uFall.value,
        gustAmp: sim.uGustAmp.value,
        gustFreq: sim.uGustFreq.value,
        fog: rend.uniforms.uFogStr.value,
    }));
    let stormReact = null; // last director getState() pushed via setReactive()
    let stormDebugS = 0; // ?winterStorm debug-slider value (playground only)
    let stormSlider = null;
    const stormDebug = typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).has('winterStorm');
    if (stormDebug) {
        window.__winterStorm = (v) => {
            if (v && typeof v === 'object') {
                // synthetic director state for testing transients (trauma/kick/vortex/…)
                stormReact = {
                    intensity: 0, gust: 0, gustDir: 1, flare: 0, whiteout: 0, kick: 0, trauma: 0, vortex: 0, ...v,
                };
            } else {
                stormReact = null;
                stormDebugS = THREE.MathUtils.clamp(+v || 0, 0, 1);
            }
        };
        if (typeof document !== 'undefined') {
            stormSlider = document.createElement('input');
            stormSlider.type = 'range';
            stormSlider.min = '0';
            stormSlider.max = '1';
            stormSlider.step = '0.01';
            stormSlider.value = '0';
            stormSlider.title = 'winter storm intensity S';
            stormSlider.style.cssText = 'position:fixed;left:16px;bottom:16px;width:300px;z-index:99999';
            stormSlider.addEventListener('input', () => { stormDebugS = parseFloat(stormSlider.value); });
            document.body.appendChild(stormSlider);
        }
    }

    // (Snow-mist banks removed 2026-08-13 — the user rejected the fog lying in
    // front of the mountains; distance haze comes from the materials' own
    // aerial fog now.)

    // Whiteout flash overlay (driven by the director's `whiteout` transient in update()).
    const reduceMotion = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const whiteoutWash = buildWhiteoutWash();
    scene.add(whiteoutWash.mesh);
    disposables.push(whiteoutWash);

    return {
        cameraRadius: 0.001,
        camera(time, camera) {
            // Debug framing hook (see window.__winterDebug.setCamera) — the shipping camera is
            // ~1 km from the far treeline, so ground detail like the fox trails can only be
            // judged up close. Inert unless a capture session sets it.
            if (camOverride) {
                if (camera.fov !== undefined) {
                    camera.fov = camOverride.fov;
                    camera.updateProjectionMatrix();
                }
                camera.position.set(...camOverride.pos);
                camera.lookAt(...camOverride.look);
                return;
            }
            // Wide eye-level framing: big snow-pines frame both corners, the cracked
            // ice fills the lower third, treeline + peaks recede.
            if (camera.fov !== undefined && Math.abs(camera.fov - 55) > 0.01) {
                camera.fov = 55;
                camera.updateProjectionMatrix();
            }
            // The far range sits ~10 km out — the theme camera ships with
            // far=8000, which would clip it to nothing.
            if (camera.far < 15000) {
                camera.far = 15000;
                camera.updateProjectionMatrix();
            }

            // Ease the raw pointer so the look-around glides (no per-frame jitter).
            const dt = Math.min(0.05, Math.max(0, time - prevCamTime));
            prevCamTime = time;
            smoothPointerX = THREE.MathUtils.lerp(smoothPointerX, pointerX, dt * 2.4);
            smoothPointerY = THREE.MathUtils.lerp(smoothPointerY, pointerY, dt * 2.4);
            // Softer parallax so moving the cursor never swings a framing tree into the
            // centre of the view (keeps the back clear at any pointer position).
            const parallaxX = smoothPointerX * 55.0;
            const parallaxY = -smoothPointerY * 28.0;

            // When the cursor is STILL, ramp in a gentle BREATHING motion — a slow
            // inhale/exhale where the eye rises + eases forward, then settles back. Moving
            // the mouse resets it instantly so the parallax look-around takes over.
            const moved = Math.abs(pointerX - lastPX) + Math.abs(pointerY - lastPY) > 0.0008;
            lastPX = pointerX;
            lastPY = pointerY;
            camIdle = moved ? 0 : camIdle + dt;
            const breatheAmt = THREE.MathUtils.smoothstep(camIdle, 0.4, 1.8); // 0 active → 1 still
            const breath = time * 1.15; // ~5.5s inhale/exhale cycle
            const breathY = Math.sin(breath) * 3.4 * breatheAmt;
            const breathZ = Math.sin(breath + 0.5) * 7.5 * breatheAmt;
            const breathLook = Math.sin(breath - 0.3) * 3.0 * breatheAmt;

            // A tiny ever-present drift so the view is never frozen; breathing rides on top.
            const swayX = Math.sin(time * 0.15) * 9 + Math.sin(time * 0.33 + 1.1) * 4;
            const bobY = Math.sin(time * 0.40) * 2.0 + Math.cos(time * 0.26) * 1.3;
            const dollyZ = Math.sin(time * 0.12) * 5;

            // Combo juice: a tasteful, DECAYING camera punch on big moments. `trauma`
            // (Tetris/T-spin/Perfect-Clear) → a rotational wobble (layered sine, NOT
            // per-frame jitter); `kick` → a brief forward dolly push. Rotation-only (no
            // translation) so it never clips the camera through the framing spruces.
            // Reduced-motion zeroes the shake — the #1 motion-sickness lever.
            const shakeGain = reduceMotion ? 0 : 1;
            const trauma = ((stormReact?.trauma ?? 0) * shakeGain) ** 1.7;
            const kickZ = (stormReact?.kick ?? 0) * 26 * shakeGain;
            camera.position.set(
                swayX + parallaxX,
                Math.max(camRestY - 32, camRestY + bobY + breathY + parallaxY),
                760 + dollyZ + breathZ - kickZ,
            );
            // Look target wanders subtly + leans toward the cursor for a parallax
            // feel. Aimed slightly ABOVE the eye so the horizon sits high and the
            // mountains + sky keep the upper half of the frame.
            const lookX = Math.sin(time * 0.16 + 0.7) * 14 + parallaxX * 0.4;
            const lookY = camRestY + 42 + Math.cos(time * 0.21) * 5 + breathLook + parallaxY * 0.35;
            camera.lookAt(lookX, lookY, -1900);
            if (trauma > 0.0001) {
                camera.rotateZ((Math.sin(time * 23.0) + Math.sin(time * 14.3 + 1.7) * 0.6) * 0.07 * trauma);
                camera.rotateX(Math.sin(time * 19.0 + 1.3) * 0.045 * trauma);
            }
        },
        update(time) {
            // Derive dt locally so the GLB wind-sway mixers work whether the host
            // calls update(time) (playground) or update(time, delta) (theme).
            const dt = Math.min(0.05, Math.max(0, time - prevTime));
            prevTime = time;
            aurora.uniforms.uTime.value = time;
            if (haloU?.uTime) haloU.uTime.value = time;
            // Falling snow: dispatch each tier's GPU compute + advance render uniforms.
            if (camera) uSnowCamPos.value.copy(camera.position);
            // Master storm intensity S drives the whole scene's escalation: the snow
            // blows sideways + swirls (below) AND the aurora SURGES (brighter + a flare
            // bloom on big clears) — so combos visibly light up the sky.
            const stormS = THREE.MathUtils.clamp(stormReact?.intensity ?? stormDebugS, 0, 1);
            const gustDir = stormReact?.gustDir ?? 1;
            const gustT = stormReact?.gust ?? 0;
            const blast = 1 + 1.8 * gustT;
            aurora.uniforms.uIntensity.value = 0.62 + 0.6 * stormS + (stormReact?.flare ?? 0) * 0.5;
            uSnowAurora.value = aurora.uniforms.uIntensity.value;
            if (drifts?.uTime) drifts.uTime.value = time;
            // The snow breathes with the aurora — and now takes its COLOUR from
            // it too. One shared solve per frame feeds every lit surface, using
            // the same activity curve the dome's shader runs on.
            updateAuroraAmbient(
                time,
                aurora.uniforms.uIntensity.value,
                stormReact?.flare ?? 0,
            );
            // The snow the foxes disturb is part of the Living Blizzard: a calm night keeps
            // their tracks legible for ~20 s, a full whiteout fills them back in within ~2 s
            // (Batman's "subtract a little each frame, since it's snowing", storm-coupled).
            // The prevailing wind also drifts the field downwind as it fades, so tracks fill
            // in from the windward side instead of dissolving uniformly.
            pawTrail.setStorm(stormS);
            pawTrail.setWind(
                (snowBase[0]?.bx ?? 14) * gustDir * blast,
                snowBase[0]?.bz ?? 6,
            );
            // Whiteout flash: the decaying `whiteout` transient (Tetris / Perfect Clear)
            // floods the screen white. Reduced-motion suppresses the strobe entirely.
            whiteoutWash.uOpacity.value = reduceMotion ? 0 : THREE.MathUtils.clamp(stormReact?.whiteout ?? 0, 0, 1.2) * 0.85;
            for (let s = 0; s < snowTiers.length; s += 1) {
                const { sim, rend } = snowTiers[s];
                const b = snowBase[s];
                // Sideways DRIVE: base×0.6 calm → a strong horizontal blast at S=1. The
                // additive (+44·S) makes even the gentle baseline winds really blow; the
                // fall eases DOWN with S so flakes go near-horizontal (driving sheets),
                // while the curl swirl deepens so they tumble in eddies, not on rails.
                sim.uBreeze.value.set(
                    (b.bx * (0.6 + 2.4 * stormS) + 44 * stormS) * gustDir * blast,
                    0,
                    (b.bz * (0.6 + 1.0 * stormS) + 12 * stormS),
                );
                sim.uCurlStr.value = b.curlStr * (1 + 1.8 * stormS) + 22 * gustT + 50 * (stormReact?.vortex ?? 0);
                sim.uCurlFreq.value = b.curlFreq * (1 + 0.5 * stormS);
                sim.uFall.value = b.fall * (1 - 0.30 * stormS);
                sim.uGustAmp.value = b.gustAmp * (0.7 + 1.0 * stormS);
                sim.uGustFreq.value = b.gustFreq * (1 + 0.4 * stormS);
                // Wind streaks ramp in with the storm; a touch more snow-haze at the climax.
                rend.uniforms.uStretch.value = stormS * 2.4;
                rend.uniforms.uFogStr.value = b.fog + THREE.MathUtils.smoothstep(stormS, 0.45, 1.0) * 0.3;
                sim.update(dt, time);
                try {
                    renderer.compute(sim.computeNode);
                } catch (e) {
                    // eslint-disable-next-line no-console
                    if (!snowComputeErr) { snowComputeErr = true; console.error('[winter snow] compute failed:', e); }
                }
                rend.update(time);
            }
            if (stormDebug && typeof window !== 'undefined' && snowBase.length) {
                const nb = snowTiers[snowTiers.length - 1].sim.uBreeze.value;
                window.__winterStormDbg = { S: +stormS.toFixed(2), nearBreezeX: +nb.x.toFixed(1) };
            }
            if (snowFallback) snowFallback.uTime.value = time;
            arcticFox.update(dt);
            pawTrail.update(dt);
            snowPuffs.update(dt);
        },
        // Theme pushes the StormDirector state here each frame (intensity + transients).
        setReactive(state) { stormReact = state; },
        dispose() {
            if (typeof window !== 'undefined') window.removeEventListener('pointermove', onPointerMove);
            if (stormSlider) stormSlider.remove();
            if (stormDebug && typeof window !== 'undefined') delete window.__winterStorm;
            scene.remove(aurora.mesh, moon);
            scene.remove(drifts.mesh);
            snowTiers.forEach(({ sim, rend }) => { scene.remove(rend.mesh); rend.dispose(); sim.dispose(); });
            if (snowFallback) scene.remove(snowFallback.points);
            arcticFox.dispose?.();
            pawTrail.dispose();
            disposeWinterSnowDetail(snowDetail);
            disposables.forEach((d) => { try { d.dispose?.(); } catch (e) { /* noop */ } });
        },
    };
}
