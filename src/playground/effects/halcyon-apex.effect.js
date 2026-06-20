/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Halcyon Apex — a windless golden dawn over turquoise water, where a
 * crystal-crowned terraced pyramid waits at the end of a stone causeway and the
 * magic simply floats.
 *
 * Performance-pragmatic backdrop+hero (NO raymarch loops — iGPU-safe):
 *   - ONE BackSide sky-dome: dawn gradient + directional sun glow + soft halo +
 *     a couple of low-poly cloud bands + a horizon haze lift. Pure analytic
 *     shader on the view ray (positionWorld - cameraPosition), like winter-aurora.
 *   - A faceted low-poly PYRAMID (ConeGeometry, 4 radial segments, flatShading)
 *     with an emissive cyan apex crystal + a glowing teal triangular portal.
 *   - A large turquoise WATER plane (MeshStandardNodeMaterial, low roughness)
 *     with a calm faceted ripple (vertex positionNode) + fresnel bright/deep
 *     teal split + a cheap reflected-sky tint.
 *   - A stone CAUSEWAY strip on the symmetry spine + cyan crystal SHARD cones
 *     lining it as waypoint breadcrumbs (gentle emissive pulse).
 *   - Two floating diamond OCTAHEDRA (the weightless "magic is real" signature)
 *     with slow levitation + rotation.
 *
 * Pre-graded unlit surfaces (sky, clouds) set material.toneMapped = false so the
 * pastel dawn previews correctly under the playground's NoToneMapping pipeline.
 * Emissive is routed ONLY from the genuinely glowing elements (sun, apex,
 * portal, shards, diamond rims) so a real theme's bloom stays jewel-like.
 *
 * Port target once proven: src/themes/halcyon-apex/halcyon-apex-theme.js
 */
import * as THREE from 'three/webgpu';
import {
    Fn, float, vec3, uniform,
    mix, clamp, abs, sin, smoothstep, max, pow, dot, atan2,
    normalize, positionLocal, normalWorld, positionWorld, cameraPosition,
    texture, normalMap, uv, reflector,
} from 'three/tsl';

export const meta = {
    id: 'halcyon-apex',
    title: 'Halcyon Apex',
    description: 'Tranquil crystalline dawn: turquoise causeway to a crystal-crowned pyramid; diamonds float.',
};

// ---- palette (sRGB hex; THREE.Color → linear handled by node materials) ----
const PAL = {
    skyWarmHorizon: 0xf6e6c4,
    skyMid: 0xe4ddc9,
    skyZenith: 0xa9c9da,
    skyZenithDeep: 0x92b7ce,
    sunCore: 0xfffbf2,
    sunHalo: 0xfbefcb,
    cloud: 0xf2ebdd,
    haze: 0xbfd2da,
    pyramidLight: 0xd8cba8,
    pyramidShadow: 0x9f9678,
    causewayTop: 0xd4c7aa,
    causewayShadow: 0xa99d82,
    waterBright: 0x76e6dd,
    waterDeep: 0x2aa6ad,
    crystalCyan: 0x8ff5ee,
    crystalGlow: 0xcffcf8,
    portalTeal: 0x3fd6cf,
    diamondBody: 0xb8aa87,
    spireGlow: 0xbfe6e6,
    rockLight: 0x9a9a8e,
    rockShadow: 0x687277,
    moss: 0x9baa45,
    mossLight: 0xc4c457,
    trunk: 0x4f3424,
};

const c = (hex) => new THREE.Color(hex);

export function create({ scene, params }) {
    const uTime = uniform(0);

    // Sun direction (upper-LEFT key light), normalized. Shared by sky + lights + water.
    const sunDir = new THREE.Vector3(-0.76, 0.24, -0.60).normalize();
    const uSunDir = uniform(vec3(sunDir.x, sunDir.y, sunDir.z));
    // Tangent basis around the sun for analytic crepuscular ray streaks.
    const sunRight = new THREE.Vector3().crossVectors(sunDir, new THREE.Vector3(0, 1, 0)).normalize();
    const sunUp = new THREE.Vector3().crossVectors(sunRight, sunDir).normalize();
    const uSunRight = uniform(vec3(sunRight.x, sunRight.y, sunRight.z));
    const uSunUp = uniform(vec3(sunUp.x, sunUp.y, sunUp.z));

    // ── "Ley-Light Resonance" reactive state: combo + lock-piece energy ──
    // A single decaying `energy` scalar + per-anchor charges, all driven from the
    // controller's pulse(kind,payload) and written into the existing emissive nodes
    // below as pure multiply-adds (the TSL graph compiles once; all are 0 at rest).
    const uEnergy = uniform(0);
    const uShardCharge = uniform(0);
    const uShardBandZ = uniform(0);
    const uApexCharge = uniform(0);
    const uPortalCharge = uniform(0);
    const uDiamondCharge = uniform(0);
    const uShaftBoost = uniform(0);
    const uColumnLife = uniform(0);
    const uCrownLife = uniform(0);
    const uEdgeLife = uniform(0);
    const uWorldCharge = uniform(0);
    const uWorldPulse = uniform(0);
    const uSkyHue = uniform(0);
    // Concurrent water shockwave rings: vec4(emitX, emitZ, ageSec, amp).
    // These are intentionally pooled so combo chains leave old ripples alive
    // while the next burst starts, like Starlight's shockwave stack.
    const uRing0 = uniform(new THREE.Vector4());
    const uRing1 = uniform(new THREE.Vector4());
    const uRing2 = uniform(new THREE.Vector4());
    const uRing3 = uniform(new THREE.Vector4());
    const uRing4 = uniform(new THREE.Vector4());
    const uRing5 = uniform(new THREE.Vector4());
    const uRing6 = uniform(new THREE.Vector4());
    const uRing7 = uniform(new THREE.Vector4());
    const uRing8 = uniform(new THREE.Vector4());
    const uRing9 = uniform(new THREE.Vector4());
    const uRing10 = uniform(new THREE.Vector4());
    const uRing11 = uniform(new THREE.Vector4());
    const uRing12 = uniform(new THREE.Vector4());
    const uRing13 = uniform(new THREE.Vector4());
    const uRing14 = uniform(new THREE.Vector4());
    const uRing15 = uniform(new THREE.Vector4());
    const ringUniforms = [
        uRing0, uRing1, uRing2, uRing3,
        uRing4, uRing5, uRing6, uRing7,
        uRing8, uRing9, uRing10, uRing11,
        uRing12, uRing13, uRing14, uRing15,
    ];

    // Atmospheric perspective: linear haze so the hero stays crisp while the
    // distant mountains / spires / pyramids dissolve into a pale blue recession.
    // This is the single biggest "reads as deep, not a stage set" win.
    const baseFogColor = new THREE.Color(0xc8d7d4);
    const worldTintRose = new THREE.Color(0xff74c8);
    const worldTintViolet = new THREE.Color(0x8f7cff);
    const worldTintCyan = new THREE.Color(0x48f1ff);
    const worldTintGold = new THREE.Color(0xffc96b);
    const _worldTint = new THREE.Color();
    const _worldTint2 = new THREE.Color();
    scene.fog = new THREE.Fog(baseFogColor.clone(), 450, 1650);

    const disposables = [];
    let reflectionNode = null; // optional planar water reflector (see water section)
    const track = (obj) => { disposables.push(obj); return obj; };
    const sceneObjects = [];
    const addSceneObject = (obj) => {
        scene.add(obj);
        sceneObjects.push(obj);
        return obj;
    };

    // =====================================================================
    // LAYER 0/1/2/3 — SKY DOME (dawn gradient + sun + halo + clouds + haze)
    // =====================================================================
    const rd = normalize(positionWorld.sub(cameraPosition)); // view ray

    // Vertical dawn gradient: warm cream low → cool blue zenith.
    const h = clamp(rd.y.mul(0.5).add(0.5), 0.0, 1.0);
    const warm = vec3(c(PAL.skyWarmHorizon).r, c(PAL.skyWarmHorizon).g, c(PAL.skyWarmHorizon).b);
    const mid = vec3(c(PAL.skyMid).r, c(PAL.skyMid).g, c(PAL.skyMid).b);
    const zenith = vec3(c(PAL.skyZenith).r, c(PAL.skyZenith).g, c(PAL.skyZenith).b);
    const zenithDeep = vec3(c(PAL.skyZenithDeep).r, c(PAL.skyZenithDeep).g, c(PAL.skyZenithDeep).b);
    const skyEnergyRose = vec3(c(0xff74c8).r, c(0xff74c8).g, c(0xff74c8).b);
    const skyEnergyViolet = vec3(c(0x8f7cff).r, c(0x8f7cff).g, c(0x8f7cff).b);
    const skyEnergyCyan = vec3(c(0x48f1ff).r, c(0x48f1ff).g, c(0x48f1ff).b);
    const skyEnergyGold = vec3(c(0xffc96b).r, c(0xffc96b).g, c(0xffc96b).b);
    // pow eases the warm band so peach pools near the horizon.
    const lowMix = mix(warm, mid, smoothstep(0.0, 0.42, pow(h, float(0.7))));
    let skyCol = mix(lowMix, zenith, smoothstep(0.35, 0.78, h));
    skyCol = mix(skyCol, zenithDeep, smoothstep(0.8, 1.0, h));

    // Accumulated combo energy regrades the whole world, not just the hero
    // crystal. The hue drifts so stacked combos feel like a living sky instead
    // of repeated flashes of the same color.
    const skyHueA = sin(uSkyHue.mul(6.283).add(uTime.mul(0.08))).mul(0.5).add(0.5);
    const skyHueB = sin(uSkyHue.mul(4.71).sub(uTime.mul(0.045)).add(1.9)).mul(0.5).add(0.5);
    const skyLowEnergy = mix(skyEnergyRose, skyEnergyGold, skyHueA);
    const skyHighEnergy = mix(skyEnergyViolet, skyEnergyCyan, skyHueB);
    const skyEnergyCol = mix(skyLowEnergy, skyHighEnergy, smoothstep(0.24, 0.86, h));
    const worldDrive = clamp(uWorldCharge.mul(0.82).add(uWorldPulse.mul(0.42)), 0.0, 1.35);
    const worldSkyMask = worldDrive.mul(float(0.2).add(smoothstep(0.02, 0.92, h).mul(0.56)));
    skyCol = mix(skyCol, skyEnergyCol, clamp(worldSkyMask, 0.0, 0.82));

    // Directional warm bleed toward the sun (not a flat horizon band).
    const sunAlign = clamp(dot(rd, uSunDir), 0.0, 1.0);
    skyCol = mix(skyCol, warm, pow(sunAlign, float(2.6)).mul(float(0.26).add(uEnergy.mul(0.12))));

    // Sun core + soft halo (the primary bloom seed).
    const sd = float(1.0).sub(sunAlign); // 0 at the sun, →1 away
    const core = smoothstep(0.008, 0.0, sd);
    const halo = pow(smoothstep(0.13, 0.0, sd), float(2.2));
    const sunCore = vec3(c(PAL.sunCore).r, c(PAL.sunCore).g, c(PAL.sunCore).b);
    const sunHalo = vec3(c(PAL.sunHalo).r, c(PAL.sunHalo).g, c(PAL.sunHalo).b);
    // Gentle breathing on the halo so the dawn feels alive.
    const haloBreath = sin(uTime.mul(0.5)).mul(0.06).add(1.0);
    const sunGlow = sunHalo.mul(halo.mul(0.32).mul(haloBreath).mul(float(1.0).add(uWorldCharge.mul(0.28))))
        .add(sunCore.mul(core.mul(float(0.9).add(uWorldPulse.mul(0.22)))));

    // A couple of flat low-poly cloud bands drifting slowly near the horizon.
    const cloudCol = vec3(c(PAL.cloud).r, c(PAL.cloud).g, c(PAL.cloud).b);
    // cheap hash-banded value across azimuth, gated to a low altitude band.
    const az = rd.x.div(max(abs(rd.y).add(0.12), 0.12)); // pseudo-azimuth coordinate
    const cloudPhase = az.mul(1.4).add(uTime.mul(0.015));
    const cloudWave = sin(cloudPhase).mul(0.5).add(sin(cloudPhase.mul(2.3).add(1.7)).mul(0.25));
    const cloudBand = smoothstep(0.12, 0.30, rd.y).mul(smoothstep(0.55, 0.20, rd.y));
    const cloudMask = smoothstep(0.18, 0.42, cloudWave.add(0.5)).mul(cloudBand);
    skyCol = mix(skyCol, cloudCol, cloudMask.mul(0.55));

    // Horizon haze lift (atmospheric perspective seed at the skyline).
    const hazeCol = vec3(c(PAL.haze).r, c(PAL.haze).g, c(PAL.haze).b);
    const hazeBand = smoothstep(0.18, -0.05, rd.y); // strongest at/below the horizon
    skyCol = mix(skyCol, hazeCol, hazeBand.mul(0.55));

    // Crepuscular sun-shafts: analytic angular streaks radiating from the sun,
    // brightest near it, slowly turning — dawn light breaking over the ridges.
    const perp = rd.sub(uSunDir.mul(dot(rd, uSunDir)));
    const rayAngle = atan2(dot(perp, uSunUp), dot(perp, uSunRight));
    const rayA = pow(sin(rayAngle.mul(22.0).add(uTime.mul(0.03))).mul(0.5).add(0.5), float(2.6));
    const rayB = pow(sin(rayAngle.mul(13.0).sub(uTime.mul(0.021)).add(1.7)).mul(0.5).add(0.5), float(2.0));
    const rays = rayA.mul(0.65).add(rayB.mul(0.35));
    const shaftMask = pow(sunAlign, float(1.7)).mul(smoothstep(-0.08, 0.12, rd.y));
    const sunShafts = sunHalo.mul(rays).mul(shaftMask).mul(float(0.22).add(uShaftBoost.mul(0.55)));
    const worldRibbon = pow(
        sin(rayAngle.mul(3.0).add(uSkyHue.mul(6.283)).add(uTime.mul(0.055))).mul(0.5).add(0.5),
        float(1.65),
    );
    const worldRibbonMask = smoothstep(0.08, 0.92, h)
        .mul(float(1.0).sub(pow(sunAlign, float(1.6)).mul(0.34)));
    const worldRibbonGlow = mix(skyEnergyRose, skyEnergyViolet, skyHueB)
        .mul(worldRibbon)
        .mul(worldDrive)
        .mul(worldRibbonMask)
        .mul(0.18);

    const worldAirGlow = mix(skyEnergyCyan, skyEnergyGold, skyHueA)
        .mul(worldDrive)
        .mul(smoothstep(-0.04, 0.62, rd.y))
        .mul(0.14);
    const skyFinal = skyCol.add(sunGlow).add(sunShafts).add(worldAirGlow).add(worldRibbonGlow);

    const skyMat = track(new THREE.MeshBasicNodeMaterial());
    skyMat.colorNode = clamp(skyFinal, 0.0, 4.0);
    // Only the sun/halo + shafts feed bloom — not the flat pastel gradient.
    skyMat.emissiveNode = sunGlow.mul(0.9).add(sunShafts.mul(0.6));
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    skyMat.fog = false;
    skyMat.toneMapped = false;

    const skyGeo = track(new THREE.SphereGeometry(8000, 48, 24));
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.frustumCulled = false;
    scene.add(skyMesh);

    // =====================================================================
    // LIGHTS — single warm key from upper-left + cool ambient fill
    // =====================================================================
    const keyBaseColor = new THREE.Color(0xffeccf);
    const fillBaseColor = new THREE.Color(0xbac8cf);
    const hemiSkyBaseColor = new THREE.Color(0xf4dfbd);
    const hemiGroundBaseColor = new THREE.Color(0x6e8c95);
    const key = new THREE.DirectionalLight(keyBaseColor, 2.8);
    key.position.copy(sunDir.clone().multiplyScalar(100));
    const fill = new THREE.AmbientLight(fillBaseColor, 1.55);
    const hemi = new THREE.HemisphereLight(hemiSkyBaseColor, hemiGroundBaseColor, 0.9);
    scene.add(key);
    scene.add(fill);
    scene.add(hemi);

    // Shared toon-ish banded ramp on N·sun for flat-shaded faceting.
    const bandedRamp = Fn(([nrm]) => {
        const ndl = clamp(dot(nrm, uSunDir), 0.0, 1.0);
        return float(0.56)
            .add(smoothstep(0.03, 0.09, ndl).mul(0.22))
            .add(smoothstep(0.30, 0.42, ndl).mul(0.22));
    });

    const colorVec = (hex) => {
        const col = c(hex);
        return vec3(col.r, col.g, col.b);
    };

    // The sky can swing into rose/violet/cyan during combo chains; this applies
    // a capped version of that same grade to scenic materials so the whole
    // biome participates without turning into a flat color wash.
    const surfaceGradeDrive = clamp(uWorldCharge.mul(0.36).add(uWorldPulse.mul(0.18)), 0.0, 1.0);
    const surfaceGradeLow = mix(skyEnergyRose, skyEnergyViolet, skyHueB);
    const surfaceGradeHigh = mix(skyEnergyCyan, skyEnergyGold, skyHueA);
    const surfaceGradeHeight = smoothstep(-20.0, 300.0, positionWorld.y);
    const surfaceGradeTint = mix(surfaceGradeLow, surfaceGradeHigh, surfaceGradeHeight);
    const worldGrade = (base, amount = 1.0, cap = 0.24) => mix(
        base,
        surfaceGradeTint,
        clamp(surfaceGradeDrive.mul(amount), 0.0, cap),
    );

    const lerpColor = (a, b, t) => ({
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t),
    });

    const colorParts = (hex) => ({
        r: Math.floor(hex / 65536) % 256,
        g: Math.floor(hex / 256) % 256,
        b: hex % 256,
    });

    const hash2 = (x, y, seed) => {
        const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
        return value - Math.floor(value);
    };

    const createCanvas = (size) => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        return canvas;
    };

    const wrapTexture = (tex, repeatX, repeatY, isColor = false) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
        return track(tex);
    };

    const createSurfaceTextures = ({
        size = 256,
        baseHex,
        lightHex,
        darkHex,
        seed = 1,
        repeat = [2, 2],
        cellScale = 8,
        crackWidth = 0.035,
        fleckStrength = 0.2,
        roughness = 0.82,
        normalStrength = 7.0,
    }) => {
        const base = colorParts(baseHex);
        const light = colorParts(lightHex);
        const dark = colorParts(darkHex);
        const colorCanvas = createCanvas(size);
        const normalCanvas = createCanvas(size);
        const roughnessCanvas = createCanvas(size);
        const colorCtx = colorCanvas.getContext('2d');
        const normalCtx = normalCanvas.getContext('2d');
        const roughnessCtx = roughnessCanvas.getContext('2d');
        const colorData = colorCtx.createImageData(size, size);
        const normalData = normalCtx.createImageData(size, size);
        const roughnessData = roughnessCtx.createImageData(size, size);
        const heights = new Float32Array(size * size);

        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const nx = x / size;
                const ny = y / size;
                const cellX = Math.floor(nx * cellScale);
                const cellY = Math.floor(ny * cellScale);
                const grain = hash2(Math.floor(x / 3), Math.floor(y / 3), seed) - 0.5;
                const broad = hash2(Math.floor(x / 17), Math.floor(y / 17), seed + 9) - 0.5;
                const seamA = Math.abs((((nx * cellScale) + hash2(0, cellY, seed + 2)) % 1) - 0.5);
                const seamB = Math.abs((((ny * cellScale * 0.82) + hash2(cellX, 0, seed + 3)) % 1) - 0.5);
                const crack = Math.max(0, 1 - Math.min(seamA, seamB) / crackWidth);
                let height = 0.56 + broad * 0.16 + grain * fleckStrength - crack * 0.38;
                height = Math.max(0, Math.min(1, height));
                heights[y * size + x] = height;
            }
        }

        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const i = y * size + x;
                const px = ((x + 1) % size) + y * size;
                const mx = ((x + size - 1) % size) + y * size;
                const py = x + ((y + 1) % size) * size;
                const my = x + ((y + size - 1) % size) * size;
                const heightValue = heights[i];
                const dx = (heights[px] - heights[mx]) * normalStrength;
                const dy = (heights[py] - heights[my]) * normalStrength;
                const invLen = 1 / Math.hypot(dx, dy, 1);
                const nx = -dx * invLen;
                const ny = -dy * invLen;
                const nz = 1 * invLen;
                const fleck = hash2(x, y, seed + 21) > 0.965 ? 0.22 : 0;
                const col = lerpColor(dark, light, Math.max(0, Math.min(1, heightValue + fleck)));
                const tint = lerpColor(base, col, 0.72);
                const idx = i * 4;
                colorData.data[idx] = tint.r;
                colorData.data[idx + 1] = tint.g;
                colorData.data[idx + 2] = tint.b;
                colorData.data[idx + 3] = 255;
                normalData.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
                normalData.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
                normalData.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
                normalData.data[idx + 3] = 255;
                const r = Math.max(0, Math.min(1, roughness + (1 - heightValue) * 0.12));
                roughnessData.data[idx] = Math.round(r * 255);
                roughnessData.data[idx + 1] = Math.round(r * 255);
                roughnessData.data[idx + 2] = Math.round(r * 255);
                roughnessData.data[idx + 3] = 255;
            }
        }

        colorCtx.putImageData(colorData, 0, 0);
        normalCtx.putImageData(normalData, 0, 0);
        roughnessCtx.putImageData(roughnessData, 0, 0);

        return {
            colorMap: wrapTexture(new THREE.CanvasTexture(colorCanvas), repeat[0], repeat[1], true),
            normalMap: wrapTexture(new THREE.CanvasTexture(normalCanvas), repeat[0], repeat[1]),
            roughnessMap: wrapTexture(new THREE.CanvasTexture(roughnessCanvas), repeat[0], repeat[1]),
        };
    };

    const createWaterTextures = ({
        size = 256,
        seed = 37,
        repeat = [4.0, 4.0],
    } = {}) => {
        const deep = colorParts(PAL.waterDeep);
        const bright = colorParts(PAL.waterBright);
        const glow = colorParts(0xb9fff7);
        const colorCanvas = createCanvas(size);
        const normalCanvas = createCanvas(size);
        const roughnessCanvas = createCanvas(size);
        const colorCtx = colorCanvas.getContext('2d');
        const normalCtx = normalCanvas.getContext('2d');
        const roughnessCtx = roughnessCanvas.getContext('2d');
        const colorData = colorCtx.createImageData(size, size);
        const normalData = normalCtx.createImageData(size, size);
        const roughnessData = roughnessCtx.createImageData(size, size);
        const heights = new Float32Array(size * size);

        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const nx = x / size;
                const ny = y / size;
                const waveA = Math.sin((nx * 22 + ny * 7.5 + seed) * Math.PI * 2);
                const waveB = Math.sin((nx * -9 + ny * 18 + seed * 0.7) * Math.PI * 2);
                const waveC = Math.sin((nx * 36 + ny * -15 + seed * 0.31) * Math.PI * 2);
                const noise = hash2(Math.floor(x / 5), Math.floor(y / 5), seed) - 0.5;
                const caustic = Math.max(0, waveA * 0.42 + waveB * 0.35 + waveC * 0.18);
                heights[y * size + x] = Math.max(0, Math.min(1, 0.52 + caustic * 0.22 + noise * 0.04));
            }
        }

        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const i = y * size + x;
                const px = ((x + 1) % size) + y * size;
                const mx = ((x + size - 1) % size) + y * size;
                const py = x + ((y + 1) % size) * size;
                const my = x + ((y + size - 1) % size) * size;
                const heightValue = heights[i];
                const dx = (heights[px] - heights[mx]) * 2.6;
                const dy = (heights[py] - heights[my]) * 2.6;
                const invLen = 1 / Math.hypot(dx, dy, 1);
                const nx = -dx * invLen;
                const ny = -dy * invLen;
                const nz = invLen;
                const causticBoost = Math.max(0, heightValue - 0.58) * 2.2;
                const baseCol = lerpColor(deep, bright, 0.58 + causticBoost * 0.18);
                const col = lerpColor(baseCol, glow, Math.min(0.42, causticBoost));
                const idx = i * 4;
                colorData.data[idx] = col.r;
                colorData.data[idx + 1] = col.g;
                colorData.data[idx + 2] = col.b;
                colorData.data[idx + 3] = 255;
                normalData.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
                normalData.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
                normalData.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
                normalData.data[idx + 3] = 255;
                const rough = Math.max(0.06, Math.min(0.22, 0.16 - causticBoost * 0.04));
                roughnessData.data[idx] = Math.round(rough * 255);
                roughnessData.data[idx + 1] = Math.round(rough * 255);
                roughnessData.data[idx + 2] = Math.round(rough * 255);
                roughnessData.data[idx + 3] = 255;
            }
        }

        colorCtx.putImageData(colorData, 0, 0);
        normalCtx.putImageData(normalData, 0, 0);
        roughnessCtx.putImageData(roughnessData, 0, 0);

        return {
            colorMap: wrapTexture(new THREE.CanvasTexture(colorCanvas), repeat[0], repeat[1], true),
            normalMap: wrapTexture(new THREE.CanvasTexture(normalCanvas), repeat[0], repeat[1]),
            roughnessMap: wrapTexture(new THREE.CanvasTexture(roughnessCanvas), repeat[0], repeat[1]),
        };
    };

    const createBandedMaterial = (
        lightHex,
        shadowHex,
        roughness = 0.8,
        maps = null,
        blend = 0.34,
        normalStrength = 0.35,
    ) => {
        const material = track(new THREE.MeshStandardNodeMaterial({ roughness }));
        material.flatShading = true;
        const shadedColor = mix(
            colorVec(shadowHex),
            colorVec(lightHex),
            bandedRamp(normalize(normalWorld)),
        );
        const baseColor = maps
            ? mix(shadedColor, texture(maps.colorMap).rgb, float(blend))
            : shadedColor;
        material.colorNode = worldGrade(baseColor, 0.8, 0.26);
        if (maps) {
            material.normalNode = normalMap(texture(maps.normalMap), float(normalStrength));
            material.roughnessNode = mix(float(roughness), texture(maps.roughnessMap).r, float(0.62));
        }
        material.emissiveNode = colorVec(lightHex).mul(0.055);
        return material;
    };

    const createSolidMaterial = (hex, roughness = 0.7) => {
        const material = track(new THREE.MeshStandardNodeMaterial({ roughness }));
        material.flatShading = true;
        material.colorNode = worldGrade(colorVec(hex), 0.75, 0.22);
        return material;
    };

    const crystalCyan = colorVec(PAL.crystalCyan);
    const crystalGlow = colorVec(PAL.crystalGlow);
    const rockTextures = createSurfaceTextures({
        baseHex: PAL.rockLight,
        lightHex: 0xb8b7a8,
        darkHex: PAL.rockShadow,
        seed: 7,
        repeat: [2.5, 2.5],
        cellScale: 7,
        fleckStrength: 0.18,
        roughness: 0.9,
    });
    const limestoneTextures = createSurfaceTextures({
        baseHex: PAL.pyramidLight,
        lightHex: 0xf0dfbd,
        darkHex: PAL.pyramidShadow,
        seed: 13,
        repeat: [3.2, 3.2],
        cellScale: 9,
        fleckStrength: 0.13,
        roughness: 0.84,
    });
    const mossTextures = createSurfaceTextures({
        baseHex: PAL.moss,
        lightHex: PAL.mossLight,
        darkHex: 0x5f6d2f,
        seed: 19,
        repeat: [3.5, 3.5],
        cellScale: 14,
        crackWidth: 0.055,
        fleckStrength: 0.34,
        roughness: 0.96,
        normalStrength: 5.0,
    });
    const slabTextures = createSurfaceTextures({
        baseHex: PAL.causewayTop,
        lightHex: 0xead8b8,
        darkHex: PAL.causewayShadow,
        seed: 23,
        repeat: [2.2, 8.0],
        cellScale: 11,
        fleckStrength: 0.14,
        roughness: 0.88,
    });
    const darkEdgeTextures = createSurfaceTextures({
        baseHex: 0x656a61,
        lightHex: 0x87887a,
        darkHex: 0x3f494d,
        seed: 29,
        repeat: [2.0, 3.0],
        cellScale: 8,
        fleckStrength: 0.16,
        roughness: 0.94,
    });
    const crystalTextures = createSurfaceTextures({
        baseHex: PAL.crystalCyan,
        lightHex: PAL.crystalGlow,
        darkHex: 0x31aaa8,
        seed: 31,
        repeat: [1.0, 2.0],
        cellScale: 5,
        crackWidth: 0.07,
        fleckStrength: 0.28,
        roughness: 0.18,
        normalStrength: 10.0,
    });
    const waterTextures = createWaterTextures({ repeat: [3.2, 3.2] });
    const rockMat = createBandedMaterial(PAL.rockLight, PAL.rockShadow, 0.9, rockTextures, 0.46, 0.28);
    const farRockMat = createBandedMaterial(PAL.haze, 0x8ea7b4, 0.95, rockTextures, 0.18, 0.12);
    const mossMat = createBandedMaterial(PAL.mossLight, PAL.moss, 0.85, mossTextures, 0.5, 0.3);
    const trunkMat = createSolidMaterial(PAL.trunk, 0.9);

    const createUnlitMaterial = (hex, opacity = 1.0) => {
        const material = track(new THREE.MeshBasicNodeMaterial());
        material.colorNode = worldGrade(colorVec(hex), opacity < 1.0 ? 0.55 : 0.36, 0.18);
        material.toneMapped = false;
        material.fog = false; // sky elements (sun/halo/clouds) must not be hazed
        if (opacity < 1.0) {
            material.opacityNode = float(opacity);
            material.transparent = true;
            material.depthWrite = false;
        }
        return material;
    };

    const sunGroup = new THREE.Group();
    addSceneObject(sunGroup);
    const haloGeo = track(new THREE.CircleGeometry(92, 48));
    const haloMesh = new THREE.Mesh(haloGeo, createUnlitMaterial(PAL.sunHalo, 0.26));
    haloMesh.position.set(-540, 240, -760);
    haloMesh.lookAt(0, 80, 330);
    sunGroup.add(haloMesh);
    const sunDisk = new THREE.Mesh(track(new THREE.CircleGeometry(42, 48)), createUnlitMaterial(PAL.sunCore, 1.0));
    sunDisk.position.set(-540, 240, -758);
    sunDisk.lookAt(0, 80, 330);
    sunGroup.add(sunDisk);

    const cloudMat = createUnlitMaterial(PAL.cloud, 0.72);
    const addCloud = (x, y, z, scale = 1, flip = 1) => {
        const shape = new THREE.Shape();
        const pts = [
            [-58, -7], [-30, 10], [-12, 8], [10, 22], [38, 10], [68, 13],
            [94, -2], [45, -14], [10, -11], [-22, -18],
        ];
        pts.forEach(([px, py], index) => {
            const xx = px * scale * flip;
            const yy = py * scale;
            if (index === 0) shape.moveTo(xx, yy);
            else shape.lineTo(xx, yy);
        });
        shape.closePath();
        const mesh = new THREE.Mesh(track(new THREE.ShapeGeometry(shape)), cloudMat);
        mesh.position.set(x, y, z);
        mesh.lookAt(0, 82, 330);
        scene.add(mesh);
        sceneObjects.push(mesh);
        return mesh;
    };
    addCloud(-320, 255, -850, 0.95, 1);
    addCloud(-82, 294, -910, 0.58, -1);
    addCloud(250, 270, -865, 0.82, 1);
    addCloud(420, 328, -940, 1.15, -1);

    const addBox = (parent, mat, x, y, z, sx, sy, sz) => {
        const geo = track(new THREE.BoxGeometry(sx, sy, sz));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
    };

    // Faceted rock plateau: a low-radial tapered prism (pentagon/hex) reads as a
    // stylized cliff far better than a cube, and a matching mossy crown caps it.
    const addRockColumn = (parent, mat, x, y, z, radius, height, sides, taper, rot) => {
        const geo = track(new THREE.CylinderGeometry(radius * taper, radius, height, sides, 1));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.rotation.y = rot;
        parent.add(mesh);
        return mesh;
    };

    const addMossRock = (parent, x, y, z, sx, sy, sz) => {
        const radius = Math.max(sx, sz) * 0.54;
        const rot = hash2(x, z, 11) * Math.PI;
        const sides = hash2(x, z, 12) > 0.5 ? 6 : 5;
        addRockColumn(parent, rockMat, x, y, z, radius, sy, sides, 0.8, rot);
        addRockColumn(parent, mossMat, x, y + sy * 0.5 + 1.2, z, radius * 0.8 * 0.97, 4.5, sides, 1.0, rot);
    };

    const landscape = new THREE.Group();
    addSceneObject(landscape);

    const addMountain = (x, z, radius, height, material = farRockMat) => {
        const geo = track(new THREE.ConeGeometry(radius, height, 5, 1));
        const mesh = new THREE.Mesh(geo, material);
        mesh.rotation.y = Math.PI / 5;
        mesh.position.set(x, height * 0.5 - 16, z);
        landscape.add(mesh);
        return mesh;
    };

    // Atmospheric mountain wall and distant pyramids: the pale blue recession
    // is what makes the photo read as deep rather than a small stage set.
    [
        [-650, -760, 120, 250],
        [-555, -625, 82, 175],
        [-420, -890, 85, 210],
        [-220, -820, 70, 190],
        [-70, -720, 56, 155],
        [80, -720, 58, 160],
        [210, -840, 76, 205],
        [420, -900, 92, 220],
        [555, -635, 86, 184],
        [660, -760, 130, 260],
        [0, -980, 95, 240],
    ].forEach(([x, z, radius, height]) => addMountain(x, z, radius, height));

    const sidePyramidMat = createBandedMaterial(
        PAL.pyramidLight,
        0x8f876f,
        0.85,
        limestoneTextures,
        0.38,
        0.22,
    );
    const addSidePyramid = (x, z, scale, flip = 1) => {
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        const baseGeo = track(new THREE.BoxGeometry(150 * scale, 28 * scale, 150 * scale));
        const base = new THREE.Mesh(baseGeo, sidePyramidMat);
        base.position.y = 14 * scale;
        group.add(base);
        const capGeo2 = track(new THREE.ConeGeometry(78 * scale, 120 * scale, 4, 1));
        const cap = new THREE.Mesh(capGeo2, sidePyramidMat);
        cap.rotation.y = Math.PI / 4;
        cap.position.y = 88 * scale;
        group.add(cap);
        const portal = new THREE.Mesh(
            track(new THREE.ConeGeometry(9 * scale, 20 * scale, 3, 1)),
            createSolidMaterial(PAL.portalTeal, 0.2),
        );
        portal.material.emissiveNode = colorVec(PAL.portalTeal).mul(0.8);
        portal.material.toneMapped = false;
        portal.position.set(0, 35 * scale, 78 * scale * flip);
        portal.scale.z = 0.12;
        group.add(portal);
        landscape.add(group);
        return group;
    };
    addSidePyramid(-430, -680, 0.62, 1);
    addSidePyramid(470, -700, 0.66, 1);
    addSidePyramid(-150, -900, 0.5, 1);

    const crystalMat = track(new THREE.MeshStandardNodeMaterial({ roughness: 0.18, metalness: 0.04 }));
    crystalMat.flatShading = true;
    crystalMat.colorNode = worldGrade(mix(
        mix(crystalCyan, crystalGlow, bandedRamp(normalize(normalWorld))),
        texture(crystalTextures.colorMap).rgb,
        float(0.26),
    ), 0.42, 0.14);
    crystalMat.normalNode = normalMap(texture(crystalTextures.normalMap), float(0.18));
    crystalMat.roughnessNode = mix(float(0.08), texture(crystalTextures.roughnessMap).r, float(0.32));
    crystalMat.emissiveNode = crystalCyan.mul(0.8).add(texture(crystalTextures.colorMap).rgb.mul(0.18));

    const addCrystalSpire = (x, z, height, radius = 16) => {
        const geo = track(new THREE.ConeGeometry(radius, height, 5, 1));
        const mesh = new THREE.Mesh(geo, crystalMat);
        mesh.position.set(x, height * 0.5 + 4, z);
        mesh.rotation.y = Math.PI / 5;
        landscape.add(mesh);
        return mesh;
    };
    addCrystalSpire(-470, -720, 205, 17);
    addCrystalSpire(-360, -800, 150, 12);
    addCrystalSpire(500, -740, 225, 19);
    addCrystalSpire(610, -700, 165, 14);
    addCrystalSpire(-150, -860, 120, 10);
    addCrystalSpire(190, -820, 135, 11);

    // Acacia/savanna tree: thin tapering trunk + a BROAD FLAT umbrella canopy
    // built from two stacked faceted discs (the signature flat-topped silhouette).
    const canopyMat = createBandedMaterial(PAL.mossLight, 0x6f8a39, 0.92, mossTextures, 0.4, 0.22);
    const addTree = (parent, x, y, z, scale = 1) => {
        const group = new THREE.Group();
        const trunkGeo = track(new THREE.CylinderGeometry(1.4 * scale, 2.8 * scale, 44 * scale, 5));
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(0, 22 * scale, 0);
        trunk.rotation.z = (hash2(x, z, 5) - 0.5) * 0.16;
        group.add(trunk);
        const mkDisc = (radius, flat, yy, rot) => {
            const g = track(new THREE.IcosahedronGeometry(radius, 1));
            const m = new THREE.Mesh(g, canopyMat);
            m.scale.set(1, flat, 1);
            m.position.set(0, yy * scale, 0);
            m.rotation.y = rot;
            group.add(m);
            return m;
        };
        mkDisc(32 * scale, 0.24, 46, hash2(x, z, 1) * Math.PI);
        mkDisc(21 * scale, 0.30, 53, hash2(x, z, 2) * Math.PI);
        group.position.set(x, y, z);
        parent.add(group);
        return group;
    };

    // Foreground cliffs and moss terraces frame the view, matching the photo's
    // dark left/right rock silhouettes while leaving the causeway centered.
    [
        // Tall NEAR corner framers (frame the lower corners like the reference).
        [-360, 34, 210, 150, 150, 150],
        [360, 34, 210, 150, 150, 150],
        // Stepped terraces receding back along each shore.
        [-300, 22, 120, 118, 92, 110],
        [-400, 34, 60, 140, 112, 148],
        [-485, 50, -30, 158, 132, 175],
        [-530, 64, -150, 142, 150, 168],
        [-250, 12, -60, 92, 30, 92],
        [300, 22, 120, 118, 92, 110],
        [400, 34, 60, 140, 112, 148],
        [485, 50, -30, 158, 132, 175],
        [530, 64, -150, 142, 150, 168],
        [250, 12, -60, 92, 30, 92],
    ].forEach(([x, y, z, sx, sy, sz]) => addMossRock(landscape, x, y, z, sx, sy, sz));

    addTree(landscape, -345, 110, 214, 1.25);
    addTree(landscape, -300, 70, 118, 0.85);
    addTree(landscape, -410, 92, 55, 1.1);
    addTree(landscape, -500, 118, -34, 1.0);
    addTree(landscape, -250, 30, -60, 0.6);
    addTree(landscape, 345, 110, 214, 1.25);
    addTree(landscape, 300, 70, 118, 0.85);
    addTree(landscape, 410, 92, 55, 1.1);
    addTree(landscape, 500, 118, -34, 1.0);
    addTree(landscape, 250, 30, -60, 0.6);

    // =====================================================================
    // LAYER — TURQUOISE WATER (large faceted plane, calm ripple)
    // =====================================================================
    const waterGeo = track(new THREE.PlaneGeometry(2400, 2400, 80, 80));
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = track(new THREE.MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0.0 }));
    waterMat.flatShading = true;

    // Calm faceted ripple — LOW amplitude (mirror, not chop).
    const wx = positionLocal.x;
    const wz = positionLocal.z;
    const ripple = sin(wx.mul(0.06).add(uTime.mul(0.6)))
        .add(sin(wz.mul(0.078).add(uTime.mul(0.45))))
        .add(sin(wx.mul(0.021).add(wz.mul(0.017)).add(uTime.mul(0.3))).mul(0.6));
    // Combo water shockwave rings: expanding crests from the uRing uniforms,
    // displacing the existing ripple (reflector mirrors them for free).
    const ringHeight = (r) => {
        const dx = positionLocal.x.sub(r.x);
        const dz = positionLocal.z.sub(r.y);
        const d = dx.mul(dx).add(dz.mul(dz)).sqrt();
        const radius = r.z.mul(150.0);
        const band = d.sub(radius).mul(d.sub(radius)).mul(-1 / (30 * 30)).exp();
        return band.mul(sin(d.sub(radius).mul(0.16))).mul(r.w);
    };
    const ringWave = ringUniforms.reduce((sum, ring) => sum.add(ringHeight(ring)), float(0.0));
    waterMat.positionNode = positionLocal.add(vec3(0.0, ripple.mul(1.1).add(ringWave.mul(7.0)), 0.0));

    // Fresnel bright/deep split + a faint reflected-sky tint.
    const Nw = normalize(normalWorld);
    const Vw = normalize(cameraPosition.sub(positionWorld));
    const fres = pow(clamp(float(1.0).sub(dot(Nw, Vw)), 0.0, 1.0), float(3.0));
    const waterBright = vec3(c(PAL.waterBright).r, c(PAL.waterBright).g, c(PAL.waterBright).b);
    const waterDeep = vec3(c(PAL.waterDeep).r, c(PAL.waterDeep).g, c(PAL.waterDeep).b);
    const skyTint = mix(zenith, warm, float(0.5)); // cheap reflected-dawn approximation
    let waterCol = mix(waterDeep, waterBright, fres);
    waterCol = mix(waterCol, waterBright, float(0.30));
    waterCol = mix(waterCol, skyTint, fres.mul(0.16));
    // Sun-facing facets sparkle a touch.
    const sparkle = pow(clamp(dot(Nw, uSunDir), 0.0, 1.0), float(8.0)).mul(0.4);
    const waterBase = mix(
        waterCol.add(waterBright.mul(sparkle)),
        texture(waterTextures.colorMap).rgb,
        float(0.2),
    );

    // Planar mirror reflection of the dawn sky + pyramid. This is a real
    // offscreen pass; it's guarded so it can be disabled on fragile drivers
    // (?noReflect / ?halcyonApexNoReflection).
    const reflectOff = !!(params && (params.get('noReflect') !== null
        || params.get('halcyonApexNoReflection') !== null));
    if (!reflectOff) {
        reflectionNode = reflector({ resolutionScale: 0.4 });
        reflectionNode.target.rotateX(-Math.PI / 2); // mirror plane normal points up
        reflectionNode.target.position.y = 0;
        addSceneObject(reflectionNode.target);
        // Tint the reflection toward teal so it reads as water (not glass) and
        // fade it in toward grazing angles via the existing fresnel term.
        const reflCol = mix(reflectionNode.rgb, waterBright, float(0.2));
        const reflAmt = clamp(fres.mul(0.6).add(0.12), 0.0, 0.62);
        waterMat.colorNode = worldGrade(mix(waterBase, reflCol, reflAmt), 0.85, 0.24);
    } else {
        waterMat.colorNode = worldGrade(waterBase, 0.85, 0.24);
    }
    waterMat.normalNode = normalMap(texture(waterTextures.normalMap), float(0.11));
    waterMat.roughnessNode = mix(float(0.08), texture(waterTextures.roughnessMap).r.mul(0.45), float(0.42));
    const ringBand = (r) => {
        const dx = positionLocal.x.sub(r.x);
        const dz = positionLocal.z.sub(r.y);
        const d = dx.mul(dx).add(dz.mul(dz)).sqrt();
        const radius = r.z.mul(150.0);
        return d.sub(radius).mul(d.sub(radius)).mul(-1 / (26 * 26)).exp()
            .mul(r.w);
    };
    const ringGlow = ringUniforms.reduce((sum, ring) => sum.add(ringBand(ring)), float(0.0));
    waterMat.emissiveNode = waterBright.mul(0.055)
        .add(waterBright.mul(sparkle).mul(0.35))
        .add(crystalGlow.mul(ringGlow).mul(0.7))
        .add(surfaceGradeTint.mul(surfaceGradeDrive).mul(0.045));

    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = 0;
    scene.add(waterMesh);

    // =====================================================================
    // LAYER — STONE CAUSEWAY (symmetry spine, foreground → pyramid base)
    // =====================================================================
    const causewayGeo = track(new THREE.BoxGeometry(34, 6, 620));
    const causewayMat = track(new THREE.MeshStandardNodeMaterial({ roughness: 0.85 }));
    causewayMat.flatShading = true;
    const cwTop = vec3(c(PAL.causewayTop).r, c(PAL.causewayTop).g, c(PAL.causewayTop).b);
    const cwShadow = vec3(c(PAL.causewayShadow).r, c(PAL.causewayShadow).g, c(PAL.causewayShadow).b);
    const causewayShade = mix(cwShadow, cwTop, bandedRamp(normalize(normalWorld)));
    causewayMat.colorNode = worldGrade(
        mix(causewayShade, texture(slabTextures.colorMap).rgb, float(0.42)),
        0.78,
        0.24,
    );
    causewayMat.normalNode = normalMap(texture(slabTextures.normalMap), float(0.28));
    causewayMat.roughnessNode = mix(float(0.86), texture(slabTextures.roughnessMap).r, float(0.62));
    const causewayMesh = new THREE.Mesh(causewayGeo, causewayMat);
    causewayMesh.position.set(0, 3.0, 30);
    scene.add(causewayMesh);

    const causewayGroup = new THREE.Group();
    addSceneObject(causewayGroup);
    const slabMat = createBandedMaterial(0xd5c8aa, 0xa99d83, 0.9, slabTextures, 0.46, 0.32);
    const edgeMat = createBandedMaterial(0x6d6f67, 0x3f494d, 0.95, darkEdgeTextures, 0.44, 0.28);
    for (let i = 0; i < 13; i += 1) {
        const z = 240 - i * 45;
        const width = 72 - i * 2.8;
        const length = i < 3 ? 42 : 35;
        const y = 8 + Math.max(0, i - 7) * 1.1;
        addBox(causewayGroup, slabMat, 0, y, z, width, 4.2, length);
        if (i % 2 === 0) {
            addBox(causewayGroup, edgeMat, -width * 0.55, y - 1.5, z, 10, 8, length * 0.88);
            addBox(causewayGroup, edgeMat, width * 0.55, y - 1.5, z, 10, 8, length * 0.88);
        }
    }

    const waterfallMat = track(new THREE.MeshBasicNodeMaterial());
    waterfallMat.colorNode = worldGrade(colorVec(PAL.waterBright), 0.6, 0.18);
    waterfallMat.emissiveNode = colorVec(PAL.waterBright).mul(0.55)
        .add(surfaceGradeTint.mul(surfaceGradeDrive).mul(0.08));
    waterfallMat.opacityNode = float(0.58);
    waterfallMat.transparent = true;
    waterfallMat.side = THREE.DoubleSide;
    waterfallMat.depthWrite = false;
    waterfallMat.toneMapped = false;
    waterfallMat.fog = false;
    // Thin tall cascades spilling from the inner faces of the foreground cliff
    // terraces into the lake (not free-floating slabs).
    [
        // x, cliffTopY, z, faceRotY
        [-236, 64, 128, 0.5],
        [236, 64, 128, -0.5],
        [-410, 118, -24, 0.32],
        [410, 118, -24, -0.32],
    ].forEach(([x, topY, z, ry]) => {
        const fall = new THREE.Mesh(track(new THREE.PlaneGeometry(9, topY, 1, 5)), waterfallMat);
        fall.position.set(x, topY * 0.5, z);
        fall.rotation.y = ry;
        causewayGroup.add(fall);
    });

    // =====================================================================
    // LAYER — HERO TERRACED PYRAMID + emissive apex crystal + portal
    // =====================================================================
    const pyrGroup = new THREE.Group();

    // Stepped base tiers (stacked flat-shaded boxes).
    const tierMat = track(new THREE.MeshStandardNodeMaterial({ roughness: 0.8 }));
    tierMat.flatShading = true;
    const pyrLight = vec3(c(PAL.pyramidLight).r, c(PAL.pyramidLight).g, c(PAL.pyramidLight).b);
    const pyrShadow = vec3(c(PAL.pyramidShadow).r, c(PAL.pyramidShadow).g, c(PAL.pyramidShadow).b);
    const tierShade = mix(pyrShadow, pyrLight, bandedRamp(normalize(normalWorld)));
    tierMat.colorNode = worldGrade(
        mix(tierShade, texture(limestoneTextures.colorMap).rgb, float(0.36)),
        0.8,
        0.25,
    );
    tierMat.normalNode = normalMap(texture(limestoneTextures.normalMap), float(0.22));
    tierMat.roughnessNode = mix(float(0.82), texture(limestoneTextures.roughnessMap).r, float(0.52));
    tierMat.emissiveNode = pyrLight.mul(0.06);

    const tierGeos = [];
    const tierDefs = [
        { w: 300, h: 20, y: 10 },
        { w: 256, h: 20, y: 30 },
        { w: 212, h: 20, y: 50 },
        { w: 170, h: 20, y: 70 },
    ];
    tierDefs.forEach((t) => {
        const g = new THREE.BoxGeometry(t.w, t.h, t.w);
        tierGeos.push(g);
        track(g);
        const m = new THREE.Mesh(g, tierMat);
        m.position.set(0, t.y, 0);
        pyrGroup.add(m);
    });

    // Faceted pyramid cap (4-sided cone = low-poly pyramid).
    const capGeo = track(new THREE.ConeGeometry(150, 150, 4, 1));
    const capMat = track(new THREE.MeshStandardNodeMaterial({ roughness: 0.8 }));
    capMat.flatShading = true;
    const capShade = mix(pyrShadow, pyrLight, bandedRamp(normalize(normalWorld)));
    capMat.colorNode = worldGrade(
        mix(capShade, texture(limestoneTextures.colorMap).rgb, float(0.3)),
        0.8,
        0.25,
    );
    capMat.normalNode = normalMap(texture(limestoneTextures.normalMap), float(0.16));
    capMat.roughnessNode = mix(float(0.84), texture(limestoneTextures.roughnessMap).r, float(0.48));
    capMat.emissiveNode = pyrLight.mul(0.07);
    const capMesh = new THREE.Mesh(capGeo, capMat);
    capMesh.rotation.y = Math.PI / 4; // square base faces the camera
    capMesh.position.set(0, 80 + 75, 0);
    pyrGroup.add(capMesh);

    // Emissive APEX crystal (small octahedron, primary cyan bloom seed).
    const apexGeo = track(new THREE.OctahedronGeometry(14, 0));
    const apexMat = track(new THREE.MeshStandardNodeMaterial({ roughness: 0.2 }));
    apexMat.flatShading = true;
    const apexPulse = sin(uTime.mul(1.1)).mul(0.5).add(0.5);
    const apexFres = pow(clamp(float(1.0).sub(dot(
        normalize(normalWorld),
        normalize(cameraPosition.sub(positionWorld)),
    )), 0.0, 1.0), float(2.0));
    apexMat.colorNode = worldGrade(mix(
        mix(crystalCyan, crystalGlow, apexFres),
        texture(crystalTextures.colorMap).rgb,
        float(0.28),
    ), 0.36, 0.12);
    apexMat.normalNode = normalMap(texture(crystalTextures.normalMap), float(0.16));
    apexMat.roughnessNode = mix(float(0.06), texture(crystalTextures.roughnessMap).r, float(0.26));
    apexMat.emissiveNode = mix(crystalCyan, crystalGlow, apexFres)
        .mul(float(1.2).add(apexPulse.mul(0.8)).add(uApexCharge.mul(2.4)));
    const apexMesh = new THREE.Mesh(apexGeo, apexMat);
    apexMesh.position.set(0, 80 + 150 + 14, 0);
    pyrGroup.add(apexMesh);

    // Triangular PORTAL on the front face (emissive teal inset quad).
    const portalGeo = track(new THREE.ConeGeometry(20, 40, 3, 1)); // flat triangle-ish
    const portalMat = track(new THREE.MeshStandardNodeMaterial({ roughness: 0.3 }));
    portalMat.flatShading = true;
    const portalTeal = vec3(c(PAL.portalTeal).r, c(PAL.portalTeal).g, c(PAL.portalTeal).b);
    const portalBreath = sin(uTime.mul(0.8)).mul(0.5).add(0.5);
    portalMat.colorNode = worldGrade(portalTeal, 0.48, 0.14);
    portalMat.emissiveNode = mix(portalTeal, crystalGlow, portalBreath.mul(0.4).add(uPortalCharge.mul(0.5)))
        .mul(float(0.7).add(portalBreath.mul(0.5)).add(uPortalCharge.mul(1.4)));
    portalMat.toneMapped = false;
    const portalMesh = new THREE.Mesh(portalGeo, portalMat);
    portalMesh.position.set(0, 50, 151); // doorway on the broad front face, above the stairs
    portalMesh.scale.set(1.0, 1.7, 0.12); // narrow + tall doorway, flattened into the face
    pyrGroup.add(portalMesh);

    // Stair stack climbing the broad front face from the causeway up to the portal.
    for (let i = 0; i < 11; i += 1) {
        const width = 76 - i * 3.4;
        addBox(
            pyrGroup,
            slabMat,
            0,
            8 + i * 4.2,
            166 - i * 1.7,
            width,
            4.0,
            10,
        );
    }

    pyrGroup.position.set(0, 2, -360); // centered on the vanishing point, beyond the water
    scene.add(pyrGroup);

    const obeliskGroup = new THREE.Group();
    addSceneObject(obeliskGroup);
    const obeliskMat = createBandedMaterial(0xa79b7b, 0x65716e, 0.85, limestoneTextures, 0.34, 0.2);
    const addObelisk = (x, z, scale = 1) => {
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        addBox(group, edgeMat, 0, 9 * scale, 0, 42 * scale, 18 * scale, 42 * scale);
        addBox(group, obeliskMat, 0, 62 * scale, 0, 24 * scale, 100 * scale, 24 * scale);
        const cap = new THREE.Mesh(track(new THREE.ConeGeometry(19 * scale, 42 * scale, 4, 1)), obeliskMat);
        cap.rotation.y = Math.PI / 4;
        cap.position.y = 133 * scale;
        group.add(cap);
        const gem = new THREE.Mesh(track(new THREE.OctahedronGeometry(12 * scale, 0)), crystalMat);
        gem.position.y = 160 * scale;
        group.add(gem);
        obeliskGroup.add(group);
        return { group, gem };
    };
    const obeliskL = addObelisk(-116, -315, 1.05);
    const obeliskR = addObelisk(116, -315, 1.05);
    addObelisk(-205, -255, 0.55);
    addObelisk(205, -255, 0.55);

    // =====================================================================
    // LAYER — CYAN CRYSTAL SHARDS (waypoints lining the causeway)
    // =====================================================================
    const shardGeo = track(new THREE.ConeGeometry(3.2, 16, 4, 1));
    const shardMat = track(new THREE.MeshStandardNodeMaterial({ roughness: 0.2 }));
    shardMat.flatShading = true;
    const shardPulse = sin(uTime.mul(1.6)).mul(0.5).add(0.5);
    const shardFres = pow(clamp(float(1.0).sub(dot(
        normalize(normalWorld),
        normalize(cameraPosition.sub(positionWorld)),
    )), 0.0, 1.0), float(2.0));
    shardMat.colorNode = worldGrade(mix(
        mix(crystalCyan, crystalGlow, shardFres),
        texture(crystalTextures.colorMap).rgb,
        float(0.24),
    ), 0.38, 0.12);
    shardMat.normalNode = normalMap(texture(crystalTextures.normalMap), float(0.14));
    shardMat.roughnessNode = mix(float(0.08), texture(crystalTextures.roughnessMap).r, float(0.28));
    // Lock "trickle": the shard band nearest the locked column brightens (a moving
    // gaussian in world-Z), plus a global lift on combo energy.
    const shardBandD = positionWorld.z.sub(uShardBandZ);
    const shardGlowBoost = uShardCharge.mul(shardBandD.mul(shardBandD).mul(-1 / (40 * 40)).exp());
    shardMat.emissiveNode = mix(crystalCyan, crystalGlow, shardFres)
        .mul(float(0.9).add(shardPulse.mul(0.6)).add(shardGlowBoost).add(uEnergy.mul(0.3)));

    const shardMeshes = [];
    const shardRows = 9;
    for (let i = 0; i < shardRows; i += 1) {
        const z = 120 - i * 56; // march down the causeway toward the pyramid
        [-26, 26].forEach((x) => {
            const m = new THREE.Mesh(shardGeo, shardMat);
            m.position.set(x, 8, z);
            scene.add(m);
            shardMeshes.push(m);
        });
    }

    // =====================================================================
    // LAYER — TWO FLOATING DIAMONDS (the levitation signature)
    // =====================================================================
    const diamondGeo = track(new THREE.OctahedronGeometry(46, 0));
    const diamondMat = track(new THREE.MeshStandardNodeMaterial({ roughness: 0.16, metalness: 0.0 }));
    diamondMat.flatShading = true;
    const diamondPale = colorVec(0xcfe2df); // pale teal-gray crystal body
    const diamondDeep = colorVec(0x8fb6b8); // shadowed facet
    const spireGlow = vec3(c(PAL.spireGlow).r, c(PAL.spireGlow).g, c(PAL.spireGlow).b);
    const dFres = pow(clamp(float(1.0).sub(dot(
        normalize(normalWorld),
        normalize(cameraPosition.sub(positionWorld)),
    )), 0.0, 1.0), float(2.4));
    // Faceted pale crystal: banded body, cyan fresnel rim, gentle inner glow.
    diamondMat.colorNode = worldGrade(
        mix(diamondDeep, diamondPale, bandedRamp(normalize(normalWorld)))
            .add(crystalCyan.mul(dFres).mul(0.35)),
        0.42,
        0.14,
    );
    diamondMat.roughnessNode = mix(float(0.12), texture(crystalTextures.roughnessMap).r, float(0.3));
    // A glowing cyan gem-belt at the diamond's equator (follows the faceted
    // surface via local Y) — the bright crystalline heart from the reference.
    const diamondBelt = pow(clamp(float(1.0).sub(abs(positionLocal.y).mul(0.13)), 0.0, 1.0), float(2.2));
    diamondMat.emissiveNode = mix(spireGlow, crystalGlow, dFres).mul(dFres.mul(0.6).add(0.1))
        .add(crystalGlow.mul(diamondBelt).mul(float(1.5).add(uDiamondCharge.mul(1.3))));

    const diamondL = new THREE.Mesh(diamondGeo, diamondMat);
    diamondL.position.set(-225, 222, -365);
    diamondL.scale.set(0.72, 1.85, 0.72);
    const diamondR = new THREE.Mesh(diamondGeo, diamondMat);
    diamondR.position.set(225, 235, -390);
    diamondR.scale.set(0.74, 1.95, 0.74);
    scene.add(diamondL);
    scene.add(diamondR);
    const diamondBaseY = { l: 222, r: 235 };

    // =====================================================================
    // ADDITIVE GLOW HALOS — a robust "pre-bloom" so the cyan crystals, apex,
    // portal and diamonds bloom softly in BOTH the playground and the real
    // theme without depending on a post pass. Camera-facing additive billboards
    // with a radial falloff + gentle breathing.
    // =====================================================================
    const glowBillboards = [];
    const makeGlow = (x, y, z, radius, hex, strength, pulse = 1.2) => {
        const mat = track(new THREE.MeshBasicNodeMaterial());
        const d = uv().sub(0.5).length().mul(2.0);
        const fall = pow(clamp(float(1.0).sub(d), 0.0, 1.0), float(2.3));
        mat.colorNode = worldGrade(colorVec(hex), 0.3, 0.1);
        mat.opacityNode = fall.mul(strength).mul(sin(uTime.mul(pulse)).mul(0.12).add(0.9))
            .mul(float(1.0).add(uEnergy.mul(0.5)));
        mat.transparent = true;
        mat.depthWrite = false;
        mat.blending = THREE.AdditiveBlending;
        mat.toneMapped = false;
        mat.fog = false;
        const geo = track(new THREE.PlaneGeometry(radius * 2, radius * 2));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.frustumCulled = false;
        scene.add(mesh);
        sceneObjects.push(mesh);
        glowBillboards.push(mesh);
        return mesh;
    };

    makeGlow(0, 246, -360, 54, PAL.crystalGlow, 0.85, 1.1); // apex crystal
    makeGlow(0, 52, -209, 40, PAL.portalTeal, 0.7, 0.8); // portal doorway
    makeGlow(-116, 168, -315, 26, PAL.crystalGlow, 0.6, 1.5); // obelisk gem L
    makeGlow(116, 168, -315, 26, PAL.crystalGlow, 0.6, 1.5); // obelisk gem R
    const glowDiamondL = makeGlow(
        diamondL.position.x,
        diamondL.position.y,
        diamondL.position.z,
        72,
        PAL.crystalGlow,
        0.8,
        0.9,
    );
    const glowDiamondR = makeGlow(
        diamondR.position.x,
        diamondR.position.y,
        diamondR.position.z,
        76,
        PAL.crystalGlow,
        0.8,
        0.9,
    );

    // Mouse parallax — a gentle look-around that makes the still feel alive and
    // hand-held. Normalized pointer in [-1,1], critically damped toward target.
    const mouse = {
        tx: 0, ty: 0, x: 0, y: 0,
    };
    const onPointerMove = (e) => {
        const w = window.innerWidth || 1;
        const hh = window.innerHeight || 1;
        mouse.tx = (e.clientX / w) * 2 - 1;
        mouse.ty = (e.clientY / hh) * 2 - 1;
    };
    if (typeof window !== 'undefined') {
        window.addEventListener('pointermove', onPointerMove, { passive: true });
    }

    // =====================================================================
    // "LEY-LIGHT RESONANCE" — combo + lock-piece reactive system.
    // One decaying energy scalar + per-anchor charges + pooled arcs / rings /
    // fireflies / a dawn column. Driven by pulse(kind,payload), decayed in
    // update(). All additive, no post pass; eases to today's scene at rest.
    // =====================================================================
    let camRef = null;
    let lastReactTime = null;
    let apexSpin = 0;
    // Saturated low-red cyan: reads as a hue shift under additive blending over
    // the bright pastel dawn (near-white crystalGlow just clamps to white there).
    const energyCyan = colorVec(0x14d8e6);

    const react = {
        energy: 0,
        targetEnergy: 0,
        world: 0,
        worldTarget: 0,
        worldPulse: 0,
        skyHue: 0.08,
        comboStack: 0,
        comboHold: 0,
        comboN: 0,
        apex: 0,
        portal: 0,
        diamond: 0,
        shard: 0,
        shardZ: 0,
        column: 0,
        crown: 0,
        edge: 0,
        columnHalf: 0.9,
        b2bFloor: 0,
        intensity: 1,
        lockN: 0,
    };

    const ANCHOR = {
        apex: new THREE.Vector3(0, 246, -360),
        portal: new THREE.Vector3(0, 52, -209),
        gemL: new THREE.Vector3(-116, 168, -315),
        gemR: new THREE.Vector3(116, 168, -315),
        spireL: new THREE.Vector3(-470, 120, -720),
        spireR: new THREE.Vector3(500, 130, -740),
        edgeNearL: new THREE.Vector3(-520, 70, 40),
        edgeNearR: new THREE.Vector3(520, 70, 40),
        edgeFarL: new THREE.Vector3(-570, 150, -230),
        edgeFarR: new THREE.Vector3(570, 150, -230),
    };
    const diaPos = (which) => (which === 'L' ? diamondL : diamondR).position;
    const comboEchoWideL = new THREE.Vector3(-690, 172, 18);
    const comboEchoWideR = new THREE.Vector3(690, 172, 18);
    const comboEchoHighL = new THREE.Vector3(-710, 236, -240);
    const comboEchoHighR = new THREE.Vector3(710, 236, -240);
    const comboEchoAnchors = [
        () => ANCHOR.edgeNearL,
        () => ANCHOR.edgeNearR,
        () => comboEchoWideL,
        () => comboEchoWideR,
        () => ANCHOR.edgeFarL,
        () => ANCHOR.edgeFarR,
        () => ANCHOR.spireL,
        () => ANCHOR.spireR,
        () => comboEchoHighL,
        () => comboEchoHighR,
        () => ANCHOR.gemL,
        () => ANCHOR.gemR,
        () => diaPos('L'),
        () => diaPos('R'),
    ];
    const _comboEchoPos = new THREE.Vector3();

    // ---- APEX CROWN + SIDE VEILS + CAUSEWAY RAILS ----
    // These occupy the upper/peripheral frame so the 2D game board can stay
    // readable while high combos still feel larger than the current canvas.
    const beaconCrownGroup = new THREE.Group();
    beaconCrownGroup.position.copy(ANCHOR.apex);
    beaconCrownGroup.visible = false;
    scene.add(beaconCrownGroup);
    sceneObjects.push(beaconCrownGroup);

    const crownMat = track(new THREE.MeshBasicNodeMaterial());
    crownMat.colorNode = mix(crystalGlow, colorVec(PAL.sunHalo), uv().y.mul(0.35));
    crownMat.opacityNode = uCrownLife.mul(0.42);
    crownMat.transparent = true;
    crownMat.depthWrite = false;
    crownMat.blending = THREE.AdditiveBlending;
    crownMat.toneMapped = false;
    crownMat.fog = false;
    crownMat.side = THREE.DoubleSide;

    const crownRings = [
        {
            inner: 40, outer: 44, base: 0.9, phase: 0.0, speed: 0.28,
        },
        {
            inner: 66, outer: 71, base: 1.0, phase: 1.1, speed: -0.18,
        },
        {
            inner: 98, outer: 104, base: 1.0, phase: 2.2, speed: 0.12,
        },
    ].map((def) => {
        const mesh = new THREE.Mesh(track(new THREE.RingGeometry(def.inner, def.outer, 96)), crownMat);
        mesh.userData.baseScale = def.base;
        mesh.userData.phase = def.phase;
        mesh.userData.speed = def.speed;
        mesh.renderOrder = 6;
        beaconCrownGroup.add(mesh);
        return mesh;
    });

    const veilMat = track(new THREE.MeshBasicNodeMaterial());
    const veilUv = uv();
    const veilCenter = clamp(float(1.0).sub(abs(veilUv.x.sub(0.5)).mul(2.0)), 0.0, 1.0);
    const veilX = pow(veilCenter, float(1.45));
    const veilYFade = smoothstep(0.02, 0.18, veilUv.y)
        .mul(float(1.0).sub(smoothstep(0.72, 1.0, veilUv.y)));
    const veilStrands = sin(veilUv.y.mul(26.0).add(veilUv.x.mul(7.0)).sub(uTime.mul(0.45)))
        .mul(0.18).add(0.82);
    const veilDrive = uEnergy.mul(0.18).add(uColumnLife.mul(0.44)).add(uCrownLife.mul(0.24));
    veilMat.colorNode = mix(energyCyan, colorVec(PAL.sunHalo), veilUv.y.mul(0.52));
    veilMat.opacityNode = veilX.mul(veilYFade).mul(veilStrands).mul(veilDrive);
    veilMat.transparent = true;
    veilMat.depthWrite = false;
    veilMat.blending = THREE.AdditiveBlending;
    veilMat.toneMapped = false;
    veilMat.fog = false;
    veilMat.side = THREE.DoubleSide;

    const veilMeshes = [];
    [
        [-245, 290, -445, 128, 470, -0.08],
        [245, 290, -445, 128, 470, 0.08],
        [-350, 250, -560, 92, 370, 0.13],
        [350, 250, -560, 92, 370, -0.13],
    ].forEach(([x, y, z, w, h2, ry]) => {
        const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h2)), veilMat);
        mesh.position.set(x, y, z);
        mesh.rotation.y = ry;
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        scene.add(mesh);
        sceneObjects.push(mesh);
        veilMeshes.push(mesh);
    });

    const railMat = track(new THREE.MeshBasicNodeMaterial());
    const railUv = uv();
    const railCenter = pow(clamp(float(1.0).sub(abs(railUv.x.sub(0.5)).mul(2.0)), 0.0, 1.0), float(2.4));
    const railTravel = sin(railUv.y.mul(34.0).sub(uTime.mul(3.2))).mul(0.5).add(0.5);
    const railDrive = uShardCharge.mul(0.56).add(uEnergy.mul(0.24)).add(uColumnLife.mul(0.38));
    railMat.colorNode = mix(energyCyan, crystalGlow, railTravel.mul(0.55));
    railMat.opacityNode = railCenter.mul(float(0.08).add(railTravel.mul(0.42))).mul(railDrive);
    railMat.transparent = true;
    railMat.depthWrite = false;
    railMat.blending = THREE.AdditiveBlending;
    railMat.toneMapped = false;
    railMat.fog = false;
    railMat.side = THREE.DoubleSide;

    const leyRailMeshes = [];
    [-55, 55].forEach((x) => {
        const rail = new THREE.Mesh(track(new THREE.PlaneGeometry(12, 720)), railMat);
        rail.position.set(x, 13.5, -70);
        rail.rotation.x = -Math.PI / 2;
        rail.visible = false;
        rail.frustumCulled = false;
        rail.renderOrder = 5;
        scene.add(rail);
        sceneObjects.push(rail);
        leyRailMeshes.push(rail);
    });

    const edgeHaloMat = track(new THREE.MeshBasicNodeMaterial());
    const edgeUv = uv();
    const edgeX = pow(
        clamp(float(1.0).sub(abs(edgeUv.x.sub(0.5)).mul(2.0)), 0.0, 1.0),
        float(1.7),
    );
    const edgeY = smoothstep(0.0, 0.18, edgeUv.y)
        .mul(float(1.0).sub(smoothstep(0.74, 1.0, edgeUv.y)));
    const edgeStrands = sin(edgeUv.y.mul(34.0).add(edgeUv.x.mul(5.0)).add(uTime.mul(0.34)))
        .mul(0.14).add(0.86);
    const edgeDrive = uEdgeLife.mul(0.62).add(uColumnLife.mul(0.32)).add(uEnergy.mul(0.16));
    edgeHaloMat.colorNode = mix(energyCyan, colorVec(PAL.sunHalo), edgeUv.y.mul(0.48));
    edgeHaloMat.opacityNode = edgeX.mul(edgeY).mul(edgeStrands).mul(edgeDrive);
    edgeHaloMat.transparent = true;
    edgeHaloMat.depthWrite = false;
    edgeHaloMat.blending = THREE.AdditiveBlending;
    edgeHaloMat.toneMapped = false;
    edgeHaloMat.fog = false;
    edgeHaloMat.side = THREE.DoubleSide;

    const edgeHaloMeshes = [];
    [
        [-520, 172, -85, 145, 355, -0.18],
        [520, 172, -85, 145, 355, 0.18],
        [-675, 150, 80, 118, 300, -0.28],
        [675, 150, 80, 118, 300, 0.28],
    ].forEach(([x, y, z, w, h2, ry]) => {
        const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h2)), edgeHaloMat);
        mesh.position.set(x, y, z);
        mesh.rotation.y = ry;
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        scene.add(mesh);
        sceneObjects.push(mesh);
        edgeHaloMeshes.push(mesh);
    });

    const edgeFanMat = track(new THREE.MeshBasicNodeMaterial());
    const fanUv = uv();
    const fanX = pow(
        clamp(float(1.0).sub(abs(fanUv.x.sub(0.5)).mul(2.0)), 0.0, 1.0),
        float(1.35),
    );
    const fanTail = float(1.0).sub(smoothstep(0.65, 1.0, fanUv.y));
    const fanLines = sin(fanUv.y.mul(42.0).sub(uTime.mul(2.4))).mul(0.5).add(0.5);
    const fanDrive = uEdgeLife.mul(0.58).add(uColumnLife.mul(0.26)).add(uShardCharge.mul(0.16));
    edgeFanMat.colorNode = mix(energyCyan, crystalGlow, fanLines.mul(0.55));
    edgeFanMat.opacityNode = fanX.mul(fanTail).mul(float(0.1).add(fanLines.mul(0.34))).mul(fanDrive);
    edgeFanMat.transparent = true;
    edgeFanMat.depthWrite = false;
    edgeFanMat.blending = THREE.AdditiveBlending;
    edgeFanMat.toneMapped = false;
    edgeFanMat.fog = false;
    edgeFanMat.side = THREE.DoubleSide;

    const edgeFanMeshes = [];
    [
        [-430, 5.5, 118, 260, 390, 0.32],
        [430, 5.5, 118, 260, 390, -0.32],
        [-600, 5.8, -72, 210, 320, 0.18],
        [600, 5.8, -72, 210, 320, -0.18],
    ].forEach(([x, y, z, w, h2, rz]) => {
        const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h2)), edgeFanMat);
        mesh.position.set(x, y, z);
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = rz;
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        scene.add(mesh);
        sceneObjects.push(mesh);
        edgeFanMeshes.push(mesh);
    });

    const edgeGlyphMat = track(new THREE.MeshBasicNodeMaterial());
    edgeGlyphMat.colorNode = mix(crystalGlow, colorVec(PAL.sunHalo), uv().y.mul(0.25));
    edgeGlyphMat.opacityNode = uEdgeLife.mul(0.54).add(uColumnLife.mul(0.2));
    edgeGlyphMat.transparent = true;
    edgeGlyphMat.depthWrite = false;
    edgeGlyphMat.blending = THREE.AdditiveBlending;
    edgeGlyphMat.toneMapped = false;
    edgeGlyphMat.fog = false;
    edgeGlyphMat.side = THREE.DoubleSide;

    const edgeGlyphMeshes = [
        [-455, 104, 70, 24, 30, 0.25],
        [455, 104, 70, 24, 30, -0.25],
        [-610, 190, -165, 32, 40, -0.18],
        [610, 190, -165, 32, 40, 0.18],
    ].map(([x, y, z, inner, outer, spin]) => {
        const mesh = new THREE.Mesh(track(new THREE.RingGeometry(inner, outer, 4)), edgeGlyphMat);
        mesh.position.set(x, y, z);
        mesh.userData.spin = spin;
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 7;
        scene.add(mesh);
        sceneObjects.push(mesh);
        return mesh;
    });

    // ---- pooled COMBO ECHO SEALS ----
    // One scalar glow can feel like the previous combo was replaced. These
    // additive peripheral seals are separate pooled layers: every combo leaves
    // its own expanding echo while the next combo starts elsewhere.
    const COMBO_ECHO_COUNT = 18;
    const comboEchoGeo = track(new THREE.RingGeometry(42, 50, 96));
    const comboEchoes = [];
    for (let e = 0; e < COMBO_ECHO_COUNT; e += 1) {
        const uEcho = uniform(0);
        const uEchoWarm = uniform(0);
        const mat = track(new THREE.MeshBasicNodeMaterial());
        const echoPulse = sin(uTime.mul(1.15).add(float(e * 0.73))).mul(0.11).add(0.9);
        const echoWarm = mix(colorVec(PAL.sunHalo), colorVec(0xff78c8), uEchoWarm);
        mat.colorNode = mix(energyCyan, echoWarm, float(0.48).add(uEchoWarm.mul(0.3)));
        mat.opacityNode = uEcho.mul(echoPulse);
        mat.transparent = true;
        mat.depthWrite = false;
        mat.depthTest = false;
        mat.blending = THREE.AdditiveBlending;
        mat.toneMapped = false;
        mat.fog = false;
        mat.side = THREE.DoubleSide;
        const mesh = new THREE.Mesh(comboEchoGeo, mat);
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.renderOrder = 8;
        scene.add(mesh);
        sceneObjects.push(mesh);
        comboEchoes.push({
            mesh,
            uEcho,
            uEchoWarm,
            active: false,
            t: 0,
            dur: 3.2,
            heat: 1,
            base: 1,
            grow: 1,
            phase: e * 0.61,
            spin: e % 2 === 0 ? 1 : -1,
        });
    }

    const comboEchoSlot = () => {
        const free = comboEchoes.find((echo) => !echo.active);
        if (free) return free;
        return comboEchoes.reduce((oldest, echo) => (
            echo.t / echo.dur > oldest.t / oldest.dur ? echo : oldest
        ), comboEchoes[0]);
    };

    const spawnComboEcho = (anchor, {
        heat = 1,
        base = 1,
        grow = 1,
        dur = 3.2,
        warmth = 0.5,
        spin = 1,
    } = {}) => {
        const echo = comboEchoSlot();
        echo.mesh.position.copy(anchor);
        echo.heat = Math.max(0, heat);
        echo.base = base;
        echo.grow = grow;
        echo.dur = dur;
        echo.t = 0;
        echo.spin = spin;
        echo.uEchoWarm.value = Math.max(0, Math.min(1, warmth));
        echo.uEcho.value = echo.heat * react.intensity;
        echo.active = true;
        echo.mesh.visible = true;
    };

    const spawnComboEchoes = (n, stack) => {
        react.comboN += 1;
        let tier = 0;
        if (n >= 10) tier = 4;
        else if (n >= 7) tier = 3;
        else if (n >= 5) tier = 2;
        else if (n >= 3) tier = 1;
        const count = [2, 3, 4, 5, 7][tier];
        const heat = 0.48 + stack * 0.82;
        for (let i = 0; i < count; i += 1) {
            const anchorFn = comboEchoAnchors[(react.comboN + n + i * 3) % comboEchoAnchors.length];
            _comboEchoPos.copy(anchorFn());
            _comboEchoPos.y += 12 + tier * 6 + (i % 2) * 10;
            spawnComboEcho(_comboEchoPos, {
                heat: heat * (1 - i * 0.045),
                base: 0.92 + tier * 0.16 + i * 0.045,
                grow: 1.28 + stack * 1.05 + tier * 0.28,
                dur: 2.5 + stack * 1.6 + tier * 0.28,
                warmth: (0.18 + stack * 0.62 + i * 0.13) % 1,
                spin: i % 2 === 0 ? 1 : -1,
            });
        }
        if (tier >= 3) {
            spawnComboEcho(ANCHOR.apex, {
                heat: 0.7 + stack * 0.38,
                base: 1.06,
                grow: 1.9 + stack * 0.7,
                dur: 4.2 + stack,
                warmth: 0.82,
                spin: -1,
            });
            [comboEchoHighL, comboEchoHighR].forEach((anchor, index) => {
                spawnComboEcho(anchor, {
                    heat: 0.9 + stack * 0.5,
                    base: 1.35,
                    grow: 2.6 + stack,
                    dur: 4.4 + stack,
                    warmth: index === 0 ? 0.72 : 0.94,
                    spin: index === 0 ? 1 : -1,
                });
            });
        }
    };

    const updateComboEcho = (echo, dt) => {
        if (!echo.active) return;
        echo.t += dt;
        const p = Math.min(1, echo.t / echo.dur);
        const fadeIn = Math.min(1, p * 5);
        const fadeOut = (1 - p) ** 0.72;
        const breath = 1 + Math.sin(echo.t * 3.0 + echo.phase) * 0.035;
        echo.uEcho.value = fadeIn * fadeOut * echo.heat * react.intensity;
        echo.mesh.scale.setScalar((echo.base + p * echo.grow) * breath);
        if (camRef) {
            echo.mesh.quaternion.copy(camRef.quaternion);
            echo.mesh.rotateZ(echo.spin * (echo.phase + echo.t * 0.42));
        }
        if (p >= 1) {
            echo.active = false;
            echo.mesh.visible = false;
            echo.uEcho.value = 0;
        }
    };

    // ---- pooled crystal-current COMETS (bright cyan energy streaking between
    // crystals). Implemented as additive radial billboards — the same primitive
    // as the glow halos that demonstrably render under this WebGPU node path
    // (transformed/scaled custom beam geometry would not draw here). Several
    // converging on the apex read as "the network discharging its current."
    const ARC_COUNT = 28;
    const arcs = [];
    for (let a = 0; a < ARC_COUNT; a += 1) {
        const uArcOp = uniform(0);
        const mat = track(new THREE.MeshBasicNodeMaterial());
        const d = uv().sub(0.5).length().mul(2.0);
        const fall = pow(clamp(float(1.0).sub(d), 0.0, 1.0), float(1.7));
        mat.colorNode = mix(energyCyan, crystalGlow, float(0.45));
        mat.opacityNode = fall.mul(uArcOp);
        mat.transparent = true;
        mat.depthWrite = false;
        mat.blending = THREE.AdditiveBlending;
        mat.toneMapped = false;
        mat.fog = false;
        const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(30, 30)), mat);
        mesh.frustumCulled = false;
        mesh.visible = false;
        scene.add(mesh);
        sceneObjects.push(mesh);
        arcs.push({
            mesh,
            uArcOp,
            active: false,
            t: 0,
            dur: 0.7,
            heat: 1,
            start: new THREE.Vector3(),
            end: new THREE.Vector3(),
        });
    }
    const _amid = new THREE.Vector3();
    const buildArc = (arc) => {
        const p = Math.min(1, arc.t / arc.dur);
        _amid.copy(arc.start).lerp(arc.end, p);
        arc.mesh.position.copy(_amid);
        if (camRef) arc.mesh.quaternion.copy(camRef.quaternion);
        // brighten and grow through the flight, snuff out as it reaches the target
        const ramp = Math.sin(Math.min(1, p * 1.1) * Math.PI);
        arc.mesh.scale.setScalar(0.6 + ramp * 0.9);
        arc.uArcOp.value = ramp * arc.heat * react.intensity;
    };
    const spawnArc = (from, to, heat = 1, dur = 0.7) => {
        let arc = arcs.find((x) => !x.active);
        if (!arc) arc = arcs.reduce((m, x) => (x.t > m.t ? x : m), arcs[0]);
        arc.start.copy(from);
        arc.end.copy(to);
        arc.heat = heat;
        arc.dur = dur;
        arc.t = 0;
        arc.active = true;
        buildArc(arc);
        arc.mesh.visible = true;
    };
    const updateArc = (arc, dt) => {
        if (!arc.active) return;
        arc.t += dt;
        if (arc.t > arc.dur) {
            arc.active = false;
            arc.mesh.visible = false;
            arc.uArcOp.value = 0;
            return;
        }
        buildArc(arc);
    };

    // ---- pooled climbing FIREFLIES (lock trickle) ----
    const FLY_COUNT = 6;
    const flies = [];
    for (let f = 0; f < FLY_COUNT; f += 1) {
        const uFly = uniform(0);
        const mat = track(new THREE.MeshBasicNodeMaterial());
        const d = uv().sub(0.5).length().mul(2.0);
        const fall = pow(clamp(float(1.0).sub(d), 0.0, 1.0), float(2.0));
        mat.colorNode = crystalGlow;
        mat.opacityNode = fall.mul(uFly);
        mat.transparent = true;
        mat.depthWrite = false;
        mat.blending = THREE.AdditiveBlending;
        mat.toneMapped = false;
        mat.fog = false;
        const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(13, 13)), mat);
        mesh.frustumCulled = false;
        mesh.visible = false;
        scene.add(mesh);
        sceneObjects.push(mesh);
        flies.push({
            mesh, uFly, active: false, t: 0, dur: 0.32, fromY: 8, toY: 24,
        });
    }
    const spawnFirefly = (x, z, fromY, toY, dur = 0.32) => {
        let fly = flies.find((v) => !v.active);
        if (!fly) [fly] = flies;
        fly.fromY = fromY;
        fly.toY = toY;
        fly.dur = dur;
        fly.t = 0;
        fly.active = true;
        fly.mesh.visible = true;
        fly.mesh.position.set(x, fromY, z);
    };
    const updateFirefly = (fly, dt) => {
        if (!fly.active) return;
        fly.t += dt;
        const p = Math.min(1, fly.t / fly.dur);
        fly.mesh.position.y = fly.fromY + (fly.toY - fly.fromY) * p;
        fly.uFly.value = Math.sin(p * Math.PI) * 0.6 * react.intensity;
        if (camRef) fly.mesh.quaternion.copy(camRef.quaternion);
        if (p >= 1) {
            fly.active = false;
            fly.mesh.visible = false;
        }
    };

    // ---- DAWN COLUMN (combo 10+ / perfect clear) ----
    const colMat = track(new THREE.MeshBasicNodeMaterial());
    const columnUv = uv();
    const columnCenter = clamp(float(1.0).sub(abs(columnUv.x.sub(0.5)).mul(2.0)), 0.0, 1.0);
    const columnFeather = pow(columnCenter, float(1.8));
    colMat.colorNode = mix(energyCyan, crystalGlow, columnUv.y.mul(0.6));
    colMat.opacityNode = columnFeather.mul(float(1.0).sub(columnUv.y)).mul(uColumnLife).mul(1.35);
    colMat.transparent = true;
    colMat.depthWrite = false;
    colMat.blending = THREE.AdditiveBlending;
    colMat.toneMapped = false;
    colMat.fog = false;
    const columnMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(70, 540)), colMat);
    columnMesh.position.set(0, 246 + 250, -360);
    columnMesh.frustumCulled = false;
    columnMesh.visible = false;
    scene.add(columnMesh);
    sceneObjects.push(columnMesh);

    // ---- water shockwave RING pool ----
    const ringNodes = ringUniforms;
    const ringState = ringNodes.map(() => ({
        x: 0, z: 0, age: 0, amp: 0, active: false,
    }));
    const spawnRing = (x, z, amp = 1) => {
        let i = ringState.findIndex((r) => !r.active);
        if (i < 0) {
            i = 0;
            for (let k = 1; k < ringState.length; k += 1) {
                if (ringState[k].amp < ringState[i].amp) i = k;
            }
        }
        const r = ringState[i];
        r.x = x;
        r.z = z;
        r.age = 0;
        r.amp = amp * react.intensity;
        r.active = true;
    };
    const spawnEdgeRings = (amp = 0.7, wide = false) => {
        spawnRing(-430, 88, amp);
        spawnRing(430, 88, amp);
        if (wide) {
            spawnRing(-610, -90, amp * 0.72);
            spawnRing(610, -90, amp * 0.72);
        }
    };

    // ---- energy helpers + dispatchers ----
    const setEnergyTarget = (v) => {
        const amount = Math.max(0, v || 0);
        react.energy = Math.min(1.2, react.energy + amount * 0.12);
        react.targetEnergy = Math.min(1.2, Math.max(react.targetEnergy, react.energy + amount * 0.18, amount));
        react.worldTarget = Math.min(1.15, Math.max(react.worldTarget, amount * 0.58));
    };
    const addCharge = (k, v, cap = 1.15) => {
        react[k] = Math.min(cap, Math.max(0, react[k]) + Math.max(0, v || 0));
    };
    const addWorld = (amount, pulseAmount = amount) => {
        const a = Math.max(0, amount || 0);
        const p = Math.max(0, pulseAmount || 0);
        react.world = Math.min(1.25, react.world + a * 0.28);
        react.worldTarget = Math.min(1.18, Math.max(react.worldTarget, react.world + a * 0.42));
        react.worldPulse = Math.min(1.25, react.worldPulse + p);
        react.skyHue = (react.skyHue + 0.075 + a * 0.09 + p * 0.035) % 1;
    };
    const noteCombo = (n) => {
        react.comboStack = Math.min(16, Math.max(react.comboStack * 0.72, n) + 1);
        react.comboHold = 3.8;
        const stack = Math.min(1, react.comboStack / 12);
        addWorld(0.07 + n * 0.018 + stack * 0.16, 0.11 + stack * 0.34);
        react.skyHue = (0.56 + stack * 0.24 + (n % 3) * 0.075) % 1;
        return stack;
    };

    const triggerBeacon = (depth = 1) => {
        addWorld(0.72 + depth * 0.12, 0.86 + depth * 0.08);
        setEnergyTarget(1);
        react.energy = Math.min(1.2, react.energy + 0.55);
        addCharge('apex', 1, 1.25);
        addCharge('portal', 1, 1.2);
        addCharge('diamond', 1, 1.2);
        addCharge('crown', 1, 1.22);
        addCharge('edge', 1, 1.25);
        react.column = Math.min(1.25, react.column + 1);
        react.columnHalf = 2.1 + depth * 0.25;
        spawnRing(0, -360, 1.25);
        spawnRing(0, -265, 0.72);
        spawnRing(-80, -330, 0.54);
        spawnRing(80, -330, 0.54);
        spawnEdgeRings(0.9, true);
        spawnArc(ANCHOR.gemL, ANCHOR.apex, 1, 0.8);
        spawnArc(ANCHOR.gemR, ANCHOR.apex, 1, 0.8);
        spawnArc(diaPos('L'), ANCHOR.apex, 1, 0.9);
        spawnArc(diaPos('R'), ANCHOR.apex, 1, 0.9);
        spawnArc(ANCHOR.spireL, ANCHOR.apex, 0.65, 1.25);
        spawnArc(ANCHOR.spireR, ANCHOR.apex, 0.65, 1.25);
        spawnArc(ANCHOR.edgeNearL, ANCHOR.gemL, 0.8, 0.85);
        spawnArc(ANCHOR.edgeNearR, ANCHOR.gemR, 0.8, 0.85);
    };

    const comboTier = (n) => {
        if (n <= 0) return;
        const stack = noteCombo(n);
        spawnComboEchoes(n, stack);
        if (n <= 2) {
            setEnergyTarget(0.15 + stack * 0.12);
            addCharge('apex', 0.1 + n * 0.05 + stack * 0.06, 0.95);
            addCharge('edge', 0.08 + stack * 0.08, 0.75);
        } else if (n <= 4) {
            setEnergyTarget(0.35 + stack * 0.14);
            addCharge('apex', 0.35 + stack * 0.1);
            addCharge('diamond', 0.25 + stack * 0.08);
            addCharge('crown', 0.18 + stack * 0.12);
            addCharge('edge', 0.18 + stack * 0.16);
            spawnArc(ANCHOR.gemL, ANCHOR.apex, 0.8, 0.9);
            spawnArc(ANCHOR.gemR, ANCHOR.apex, 0.8, 0.9);
            if (stack > 0.35) spawnEdgeRings(0.28 + stack * 0.18, false);
        } else if (n <= 6) {
            setEnergyTarget(0.6 + stack * 0.16);
            addCharge('apex', 0.6 + stack * 0.12, 1.2);
            addCharge('portal', 0.4 + stack * 0.08);
            addCharge('diamond', 0.6 + stack * 0.1);
            addCharge('crown', 0.42 + stack * 0.18, 1.18);
            addCharge('edge', 0.48 + stack * 0.22, 1.2);
            spawnArc(ANCHOR.gemL, ANCHOR.apex, 0.9, 0.9);
            spawnArc(ANCHOR.gemR, ANCHOR.apex, 0.9, 0.9);
            spawnArc(diaPos('L'), ANCHOR.apex, 0.8, 1.0);
            spawnArc(diaPos('R'), ANCHOR.apex, 0.8, 1.0);
            spawnRing(0, -360, 0.86);
            spawnRing(0, -290, 0.48);
            spawnEdgeRings(0.48 + stack * 0.16, false);
        } else if (n <= 9) {
            setEnergyTarget(0.8 + stack * 0.18);
            addCharge('apex', 0.85 + stack * 0.16, 1.25);
            addCharge('portal', 0.6 + stack * 0.1, 1.15);
            addCharge('diamond', 0.8 + stack * 0.12, 1.2);
            addCharge('crown', 0.72 + stack * 0.22, 1.22);
            addCharge('edge', 0.76 + stack * 0.26, 1.25);
            spawnArc(ANCHOR.gemL, ANCHOR.apex, 1, 0.9);
            spawnArc(ANCHOR.gemR, ANCHOR.apex, 1, 0.9);
            spawnArc(ANCHOR.spireL, ANCHOR.apex, 0.5, 1.3);
            spawnArc(ANCHOR.spireR, ANCHOR.apex, 0.5, 1.3);
            spawnArc(ANCHOR.edgeFarL, ANCHOR.gemL, 0.55, 1.05);
            spawnArc(ANCHOR.edgeFarR, ANCHOR.gemR, 0.55, 1.05);
            spawnRing(0, -360, 0.98);
            spawnRing(-70, -310, 0.55);
            spawnRing(70, -310, 0.55);
            spawnEdgeRings(0.68 + stack * 0.18, true);
        } else {
            triggerBeacon(1);
        }
    };

    const pulse = (kind, payload = {}) => {
        if (react.intensity <= 0 && kind !== 'b2b') return;
        if (kind === 'pieceLock' || kind === 'hardDrop') {
            const z = (payload && typeof payload.z === 'number') ? payload.z : 0;
            const down = kind === 'hardDrop';
            react.shardZ = z;
            addCharge('shard', 0.5, 0.7);
            addCharge('edge', down ? 0.18 : 0.1, 0.55);
            react.lockN += 1;
            const x = (react.lockN % 2 === 0) ? 26 : -26;
            spawnFirefly(x, z, down ? 24 : 8, down ? 8 : 24, 0.32);
            setEnergyTarget(Math.min(0.5, react.energy + 0.04));
            if (down) {
                addWorld(0.08, 0.12);
                spawnRing(0, z, 0.4);
            }
        } else if (kind === 'combo') {
            comboTier(Math.max(0, Math.floor(payload.count || 0)));
        } else if (kind === 'lineClear') {
            const lines = Math.max(1, payload.lines || 1);
            const cascade = Math.max(1, payload.cascade || 1);
            const lineCharge = 0.12 + lines * 0.07 + Math.min(0.18, (cascade - 1) * 0.05);
            addWorld(lineCharge, 0.22 + lines * 0.08);
            setEnergyTarget(0.25 + lines * 0.12 + Math.min(0.18, (cascade - 1) * 0.06));
            addCharge('portal', 0.42 + lines * 0.08 + Math.min(0.22, (cascade - 1) * 0.08), 1.18);
            addCharge('apex', 0.4 + lines * 0.08, 1.2);
            addCharge('crown', lines >= 4 ? 0.62 : 0.22 + lines * 0.08, 1.2);
            addCharge('edge', lines >= 4 ? 0.72 : 0.28 + lines * 0.08, 1.25);
            const ringAmp = Math.min(1.1, 0.52 + lines * 0.11 + (cascade - 1) * 0.06);
            for (let i = 0; i < lines && i < ringState.length; i += 1) {
                spawnRing(0, -360 + i * 30, ringAmp);
            }
            if (cascade > 1) {
                spawnRing(-70, -318, 0.48 + Math.min(0.24, cascade * 0.04));
                spawnRing(70, -318, 0.48 + Math.min(0.24, cascade * 0.04));
                spawnEdgeRings(0.52 + Math.min(0.18, cascade * 0.04), true);
            } else if (lines >= 2) {
                spawnEdgeRings(0.42 + lines * 0.06, lines >= 4);
            }
            spawnArc(ANCHOR.gemL, ANCHOR.apex, 0.9, 0.9);
            spawnArc(ANCHOR.gemR, ANCHOR.apex, 0.9, 0.9);
            if (lines >= 4) {
                spawnArc(ANCHOR.edgeNearL, ANCHOR.gemL, 0.65, 0.9);
                spawnArc(ANCHOR.edgeNearR, ANCHOR.gemR, 0.65, 0.9);
            }
            if (lines >= 4) comboTier(6);
        } else if (kind === 'tspin') {
            const lines = payload.lines || 0;
            addWorld(0.22 + lines * 0.08, 0.34 + lines * 0.09);
            setEnergyTarget(0.4 + lines * 0.1);
            addCharge('apex', 0.8, 1.2);
            addCharge('portal', 0.5, 1.12);
            addCharge('crown', 0.5 + lines * 0.12, 1.2);
            addCharge('edge', 0.56 + lines * 0.08, 1.22);
            spawnRing(0, -310, 0.6 + lines * 0.12);
            spawnEdgeRings(0.5 + lines * 0.08, false);
            spawnArc(ANCHOR.portal, ANCHOR.apex, 1, 1.0);
            spawnArc(diaPos('L'), ANCHOR.apex, 0.7, 1.1);
            spawnArc(diaPos('R'), ANCHOR.apex, 0.7, 1.1);
        } else if (kind === 'b2b') {
            react.b2bFloor = payload.active ? 0.3 : 0;
            if (payload.active) {
                addWorld(0.18, 0.22);
                addCharge('edge', 0.28, 0.85);
            }
        } else if (kind === 'perfectClear') {
            triggerBeacon(payload.depth || 1);
        } else if (kind === 'levelUp') {
            addWorld(0.3, 0.42);
            setEnergyTarget(0.5);
            addCharge('apex', 0.6, 1.1);
            addCharge('crown', 0.44, 1.1);
            addCharge('edge', 0.62, 1.16);
            spawnRing(0, -360, 0.86);
            spawnRing(0, -285, 0.5);
            spawnEdgeRings(0.55, true);
        }
    };

    const setIntensity = (m) => { react.intensity = Math.max(0, Math.min(1, m || 0)); };

    const updateReactive = (time, delta) => {
        const dt = Math.max(0, Math.min(0.05, delta));
        react.comboHold = Math.max(0, react.comboHold - dt);
        if (react.comboHold <= 0) {
            react.comboStack *= 0.5 ** (dt / 3.2);
            if (react.comboStack < 0.01) react.comboStack = 0;
        }
        const stackHold = react.comboHold > 0 ? 1 : 0;
        react.targetEnergy = Math.max(react.b2bFloor, react.targetEnergy * (0.5 ** (dt / (0.9 + stackHold * 0.8))));
        react.energy += (react.targetEnergy - react.energy) * Math.min(1, dt * 6);
        react.energy = Math.max(0, Math.min(1.2, react.energy));
        react.worldTarget = Math.max(
            react.b2bFloor * 0.5,
            react.worldTarget * (0.5 ** (dt / (2.4 + stackHold * 1.8))),
        );
        react.world += (react.worldTarget - react.world) * Math.min(1, dt * 2.8);
        react.world = Math.max(0, Math.min(1.25, react.world));
        react.worldPulse *= 0.5 ** (dt / 0.72);
        react.skyHue = (react.skyHue + dt * (0.012 + react.world * 0.015 + react.worldPulse * 0.028)) % 1;
        react.apex *= 0.5 ** (dt / 0.6);
        react.portal *= 0.5 ** (dt / 0.7);
        react.diamond *= 0.5 ** (dt / 0.7);
        react.shard *= 0.5 ** (dt / 0.3);
        react.column *= 0.5 ** (dt / react.columnHalf);
        react.crown *= 0.5 ** (dt / (1.25 + stackHold * 0.65));
        react.edge *= 0.5 ** (dt / (1.1 + stackHold * 0.8));
        const k = react.intensity;
        const worldLive = Math.min(1.25, Math.max(react.world, react.worldPulse * 0.46)) * k;
        const crownLive = Math.min(1.28, Math.max(react.crown, react.column * 0.78, react.world * 0.28));
        const edgeLive = Math.min(
            1.3,
            Math.max(react.edge, react.column * 0.55, react.crown * 0.35, react.world * 0.38),
        );
        uEnergy.value = react.energy * k;
        uApexCharge.value = react.apex * k;
        uPortalCharge.value = react.portal * k;
        uDiamondCharge.value = react.diamond * k;
        uShardCharge.value = react.shard * k;
        uShardBandZ.value = react.shardZ;
        uShaftBoost.value = Math.min(
            1.35,
            (react.energy * 0.9 + react.world * 0.42 + react.worldPulse * 0.28) * k,
        );
        uColumnLife.value = react.column * k;
        uCrownLife.value = crownLive * k;
        uEdgeLife.value = edgeLive * k;
        uWorldCharge.value = Math.min(1.25, react.world * k);
        uWorldPulse.value = Math.min(1.25, react.worldPulse * k);
        uSkyHue.value = react.skyHue;
        const hueMix = Math.sin(react.skyHue * Math.PI * 2) * 0.5 + 0.5;
        const goldMix = Math.sin(react.skyHue * Math.PI * 2 + 1.9) * 0.5 + 0.5;
        _worldTint.copy(worldTintRose).lerp(worldTintCyan, hueMix);
        _worldTint2.copy(worldTintViolet).lerp(worldTintGold, goldMix);
        _worldTint.lerp(_worldTint2, Math.min(0.55, react.worldPulse * 0.32 + react.world * 0.18));
        if (scene.fog) scene.fog.color.copy(baseFogColor).lerp(_worldTint, Math.min(0.42, worldLive * 0.34));
        key.color.copy(keyBaseColor).lerp(_worldTint, Math.min(0.32, worldLive * 0.22));
        fill.color.copy(fillBaseColor).lerp(_worldTint, Math.min(0.28, worldLive * 0.2));
        hemi.color.copy(hemiSkyBaseColor).lerp(_worldTint, Math.min(0.34, worldLive * 0.23));
        hemi.groundColor.copy(hemiGroundBaseColor).lerp(worldTintCyan, Math.min(0.22, worldLive * 0.18));
        key.intensity = 2.8 + react.energy * 0.5 * k + worldLive * 0.38;
        fill.intensity = 1.55 + worldLive * 0.18;
        hemi.intensity = 0.9 + worldLive * 0.1;
        for (let i = 0; i < ringState.length; i += 1) {
            const r = ringState[i];
            if (r.active) {
                r.age += dt;
                r.amp *= 0.5 ** (dt / 1.4);
                if (r.amp < 0.02) {
                    r.active = false;
                    r.amp = 0;
                }
            }
            ringNodes[i].value.set(r.x, r.z, r.age, r.amp);
        }
        for (let i = 0; i < arcs.length; i += 1) updateArc(arcs[i], dt);
        for (let i = 0; i < comboEchoes.length; i += 1) updateComboEcho(comboEchoes[i], dt);
        for (let i = 0; i < flies.length; i += 1) updateFirefly(flies[i], dt);
        const auraLive = (react.energy + react.column + react.crown) * k;
        for (let i = 0; i < veilMeshes.length; i += 1) {
            veilMeshes[i].visible = auraLive > 0.025;
        }
        const railLive = (react.shard + react.energy + react.column) * k;
        for (let i = 0; i < leyRailMeshes.length; i += 1) {
            leyRailMeshes[i].visible = railLive > 0.018;
        }
        const sideLive = edgeLive * k;
        for (let i = 0; i < edgeHaloMeshes.length; i += 1) {
            edgeHaloMeshes[i].visible = sideLive > 0.018;
        }
        for (let i = 0; i < edgeFanMeshes.length; i += 1) {
            edgeFanMeshes[i].visible = sideLive > 0.02;
        }
        for (let i = 0; i < edgeGlyphMeshes.length; i += 1) {
            const glyph = edgeGlyphMeshes[i];
            glyph.visible = sideLive > 0.03;
            if (glyph.visible && camRef) {
                glyph.quaternion.copy(camRef.quaternion);
                glyph.rotation.z += glyph.userData.spin * dt;
                glyph.scale.setScalar(1 + sideLive * 0.28);
            }
        }
        beaconCrownGroup.visible = crownLive * k > 0.015;
        if (beaconCrownGroup.visible && camRef) {
            beaconCrownGroup.quaternion.copy(camRef.quaternion);
            for (let i = 0; i < crownRings.length; i += 1) {
                const ring = crownRings[i];
                const ringBreath = Math.sin(time * 0.9 + ring.userData.phase) * 0.035;
                const scale = ring.userData.baseScale + crownLive * (0.2 + i * 0.08) + ringBreath;
                ring.scale.setScalar(scale);
                ring.rotation.z = time * ring.userData.speed;
            }
        }
        columnMesh.visible = react.column > 0.01;
        if (columnMesh.visible && camRef) {
            columnMesh.rotation.y = Math.atan2(camRef.position.x, camRef.position.z + 360);
            columnMesh.scale.set(1 + react.column * 0.55, 1 + react.column * 0.04, 1);
        }
    };

    const debugTimers = [];
    const scheduleDebugPulse = (fn, delay = 0) => {
        if (delay <= 0 || typeof window === 'undefined') {
            fn();
            return;
        }
        const id = window.setTimeout(() => {
            const index = debugTimers.indexOf(id);
            if (index >= 0) debugTimers.splice(index, 1);
            fn();
        }, delay);
        debugTimers.push(id);
    };

    const fireDebugPulse = (name) => {
        if (name === 'lock') pulse('pieceLock', { z: 0 });
        else if (name === 'hardDrop') pulse('hardDrop', { z: 0 });
        else if (name === 'comboChain' || name === 'chain') {
            [2, 3, 4, 5, 6, 7, 8, 9].forEach((count, index) => {
                scheduleDebugPulse(() => pulse('combo', { count }), index * 120);
            });
            scheduleDebugPulse(() => pulse('lineClear', { lines: 4, cascade: 2 }), 1040);
        } else if (name === 'combo4') pulse('combo', { count: 4 });
        else if (name === 'combo6') pulse('combo', { count: 6 });
        else if (name === 'combo9') pulse('combo', { count: 9 });
        else if (name === 'combo10' || name === 'beacon') pulse('combo', { count: 10 });
        else if (name === 'tetris') pulse('lineClear', { lines: 4 });
        else if (name === 'cascade') pulse('lineClear', { lines: 3, cascade: 3 });
        else if (name === 'tspin') pulse('tspin', { lines: 2 });
        else if (name === 'perfect') pulse('perfectClear', { depth: 2 });
        else if (name === 'levelUp') pulse('levelUp', {});
    };

    let pendingDebugPulseAge = 0;
    const initialDebugPulse = params?.get?.('halcyonApexPulse');
    if (initialDebugPulse) {
        fireDebugPulse(initialDebugPulse);
        const age = Number.parseFloat(params?.get?.('halcyonApexPulseAge') || '0');
        pendingDebugPulseAge = Number.isFinite(age) ? Math.max(0, Math.min(1.5, age)) : 0;
    }

    // Playground test hook: ?halcyonApexReact=1 binds keys to fire pulses for
    // phase-locked screenshots without the game running (0=lock, 1-9=combo,
    // c=tetris, p=perfect, t=tspin, b=b2b, x=combo chain).
    let keyHandler = null;
    if (params && params.get('halcyonApexReact') !== null && typeof window !== 'undefined') {
        keyHandler = (e) => {
            if (e.key === '0') pulse('pieceLock', { z: Math.random() * 240 - 120 });
            else if (e.key >= '1' && e.key <= '9') pulse('combo', { count: parseInt(e.key, 10) });
            else if (e.key === 'c') fireDebugPulse('tetris');
            else if (e.key === 'p') fireDebugPulse('perfect');
            else if (e.key === 't') fireDebugPulse('tspin');
            else if (e.key === 'b') pulse('b2b', { active: true });
            else if (e.key === 'x') fireDebugPulse('comboChain');
        };
        window.addEventListener('keydown', keyHandler);
        window.__HALCYON_DBG__ = () => {
            const a = arcs.find((x) => x.active) || arcs[0];
            return {
                energy: +react.energy.toFixed(3),
                world: +react.world.toFixed(3),
                worldPulse: +react.worldPulse.toFixed(3),
                comboStack: +react.comboStack.toFixed(3),
                skyHue: +react.skyHue.toFixed(3),
                column: +react.column.toFixed(3),
                crown: +react.crown.toFixed(3),
                edge: +react.edge.toFixed(3),
                ringsActive: ringState.filter((r) => r.active).length,
                arcsActive: arcs.filter((x) => x.active).length,
                comboEchoesActive: comboEchoes.filter((x) => x.active).length,
                edgeVisible: edgeHaloMeshes.filter((m) => m.visible).length
                    + edgeFanMeshes.filter((m) => m.visible).length
                    + edgeGlyphMeshes.filter((m) => m.visible).length,
                arc: {
                    active: a.active,
                    visible: a.mesh.visible,
                    op: +a.uArcOp.value.toFixed(2),
                    pos: a.mesh.position.toArray().map((n) => Math.round(n)),
                },
                cam: camRef ? camRef.position.toArray().map((n) => Math.round(n)) : null,
            };
        };
    }

    // =====================================================================
    // controller
    // =====================================================================
    return {
        cameraRadius: 120, // only used if camera() were absent; we drive it below
        camera(time, cam) {
            camRef = cam;
            // Symmetric one-point perspective down the causeway to the portal/apex,
            // with micro-drift + smooth mouse parallax orbiting the hero pyramid.
            mouse.x += (mouse.tx - mouse.x) * 0.05;
            mouse.y += (mouse.ty - mouse.y) * 0.05;
            const sway = Math.sin(time * 0.05) * 1.4 + mouse.x * 42;
            const lift = 62 - mouse.y * 20;
            const dolly = Math.sin(time * 0.07) * 3.0;
            cam.position.set(sway, lift, 345 + dolly);
            // Look target counter-shifts a touch so the parallax pivots on the pyramid.
            cam.lookAt(mouse.x * -10, 78 + mouse.y * 10, -385);
            // Keep the additive glow billboards facing the camera.
            for (let i = 0; i < glowBillboards.length; i += 1) {
                glowBillboards[i].quaternion.copy(cam.quaternion);
            }
        },
        pulse,
        setIntensity,
        update(time, deltaArg) {
            uTime.value = time;
            // Prefer the loop delta when available so fixed-time playground captures
            // can still show reactive pulses easing naturally.
            const fallbackDelta = Math.max(0, Math.min(0.05, time - (lastReactTime == null ? time : lastReactTime)));
            let delta = Number.isFinite(deltaArg) ? Math.max(0, Math.min(0.05, deltaArg)) : fallbackDelta;
            if (pendingDebugPulseAge > 0) {
                delta = pendingDebugPulseAge;
                pendingDebugPulseAge = 0;
            }
            lastReactTime = time;
            // Diamond levitation + slow spin.
            diamondL.position.y = diamondBaseY.l + Math.sin(time * 0.4) * 10;
            diamondR.position.y = diamondBaseY.r + Math.sin(time * 0.4 + 1.6) * 12;
            diamondL.rotation.y = time * 0.15;
            diamondR.rotation.y = -time * 0.12;
            // Diamond glow halos follow their levitation.
            glowDiamondL.position.y = diamondL.position.y;
            glowDiamondR.position.y = diamondR.position.y;
            obeliskL.gem.rotation.y = time * 0.5;
            obeliskR.gem.rotation.y = -time * 0.45;
            // Reactive "Ley-Light Resonance" combo/lock system.
            updateReactive(time, delta);
            // Apex crystal spin accelerates with charge (accumulated, no angle jumps).
            apexSpin += delta * (0.5 + react.energy * 2.2);
            apexMesh.rotation.y = apexSpin;
        },
        dispose() {
            if (typeof window !== 'undefined') {
                window.removeEventListener('pointermove', onPointerMove);
                if (keyHandler) window.removeEventListener('keydown', keyHandler);
                debugTimers.forEach((id) => window.clearTimeout(id));
                debugTimers.length = 0;
            }
            scene.fog = null;
            scene.remove(skyMesh);
            scene.remove(key);
            scene.remove(fill);
            scene.remove(hemi);
            scene.remove(waterMesh);
            scene.remove(causewayMesh);
            scene.remove(pyrGroup);
            scene.remove(diamondL);
            scene.remove(diamondR);
            shardMeshes.forEach((m) => scene.remove(m));
            sceneObjects.forEach((obj) => scene.remove(obj));
            if (reflectionNode) { try { reflectionNode.dispose?.(); } catch (e) { /* noop */ } }
            disposables.forEach((d) => { try { d.dispose(); } catch (e) { /* noop */ } });
        },
    };
}
