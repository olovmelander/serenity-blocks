/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Earth Core Environment - Chapter 1 Visual Theme
 *
 * ENHANCED VERSION: Stunning volcanic Earth Core with:
 * - Animated molten lava floor with FBM noise shaders
 * - Volcanic crater rim with jagged rock formations
 * - Rising smoke/ash particles
 * - Enhanced magma balls with corona effects
 * - Improved lighting and atmosphere
 *
 * Design: Immersive volcanic core experience with realistic lava,
 * dramatic lighting, and cinematic visual effects.
 */

import * as THREE from 'three/webgpu';
import {
    attribute,
    clamp,
    cos,
    float,
    mix,
    mod,
    oneMinus,
    pow,
    sin,
    smoothstep,
    texture,
    uniform,
    uv,
    vec3,
} from 'three/tsl';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
    getOdysseyPathPointAt,
} from '../path-utils.js';
import {
    createLavaLakeTSL,
    createLavaFallTSL,
    createGodRayConeTSL,
    createVolcanoBackgroundTSL,
    createMagmaCloudCanopyTSL,
    createRockClusterTSL,
    createObsidianColumnTSL,
    createMagmaHorizonTSL,
    createMoltenHazeMaterialTSL,
    createMoltenPocketTSL,
    createContactShadowDecalTSL,
} from './earth-core.tsl.js';
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';

/**
 * Earth Core environment configuration
 */
export const EARTH_CORE_CONFIG = {
    id: 1,
    name: 'earth-core',
    yStart: -52.5,
    yEnd: -7.5,
    transitionZone: 0.005, // Faster fade out to clear lava colors before chapter 2
    colors: {
        primary: 0xff4400,
        secondary: 0x8b0000,
        tertiary: 0xffdd66,
        accent: 0xff6600,
        background: 0x0a0200,
    },
};

// The opaque lava lake sits low so the camera looks ACROSS it (see createLavaLakeTSL
// mesh.position.y); set pieces (lava-fall, god-rays, columns) anchor off this.
const LAVA_LAKE_Y = -10;

const EMBER_COLORS = [
    '#ff4400', '#ff6600', '#ff8800', '#ffaa00', '#ffcc00', // Oranges/yellows
    '#ff2200', '#ff3300', '#cc2200', '#aa1100', // Reds
    '#ffdd44', '#ffee66', // Bright yellows
];

// ═══════════════════════════════════════════════════════════════════════════════
// TSL PARTICLE HELPERS (canvas-Points -> instanced billboard quads on WebGPU)
// ═══════════════════════════════════════════════════════════════════════════════
//
// THREE.Points render as 1px on the WebGPU backend, so the chapter's smoke, ember
// stars, rising embers and the crater-rim cloud puffs are rebuilt as instanced
// billboard quads (a unit PlaneGeometry instanced per particle) whose positionNode
// faces the camera and whose colorNode/opacityNode sample the original canvas sprite
// via uv(). Per-particle data rides as instanced attributes so the animation math
// from the old GLSL vertex shaders is reproduced on the GPU. Counts/colors/sizes
// mirror the original look (the old screen-space gl_PointSize becomes a small
// world-space billboard size).

const TAU = Math.PI * 2;

/** Radial soft-glow sprite mask (0 at edge, 1 at center) from the quad uv. */
function spriteGlowMask(exponent) {
    const p = uv().sub(0.5);
    const dist = p.length().mul(2.0); // 0 at center, ~1 at quad edge
    return pow(clamp(oneMinus(dist), 0.0, 1.0), exponent);
}

/**
 * Additive glow sprite material for the lava-floor / magma-ball corona sprites.
 * SpriteMaterial cannot render on WebGPU, so this is a SpriteNodeMaterial that samples
 * the canvas glow texture (tinted + scaled by opacity), matching the old look.
 * @param {THREE.Texture} map canvas glow texture
 * @param {number} colorHex tint color
 * @param {number} opacity constant opacity multiplier
 */
function makeGlowSpriteMaterial(map, colorHex, opacity) {
    const material = new THREE.SpriteNodeMaterial();
    const sprite = texture(map, uv());
    material.colorNode = sprite.rgb.mul(vec3(new THREE.Color(colorHex)));
    material.opacityNode = sprite.a.mul(opacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    return material;
}

/**
 * Volcanic smoke/ash — instanced billboards rising and expanding from the lava.
 * Mirrors the old smoke Points (position + aRandom/aSize/aSpeed), animated entirely
 * from uTime so the update loop is unchanged.
 */
function createVolcanicSmoke(uniforms, count) {
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);
    const speeds = new Float32Array(count);

    const columns = [
        { x: 24, z: 3 - 116, spread: 18 }, // lava-fall splash plume
        { x: -22, z: 3 - 55, spread: 15 }, // near path shelf
        { x: 18, z: 3 - 32, spread: 18 }, // forward corridor smoke
        { x: -48, z: 3 - 96, spread: 22 }, // side-wall smoke bank
    ];
    for (let i = 0; i < count; i++) {
        const col = columns[i % columns.length];
        const angle = Math.random() * TAU;
        const radius = Math.random() * col.spread;
        bases[i * 3] = col.x + Math.cos(angle) * radius;
        bases[i * 3 + 1] = LAVA_LAKE_Y - 2 + Math.random() * 8;
        bases[i * 3 + 2] = col.z + Math.sin(angle) * radius;
        randoms[i] = Math.random();
        sizes[i] = 8 + Math.random() * 10;
        speeds[i] = 0.45 + Math.random() * 0.7;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aRandom: { array: randoms, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
        aSpeed: { array: speeds, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aRandom = attribute('aRandom', 'float');
    const aSize = attribute('aSize', 'float');
    const aSpeed = attribute('aSpeed', 'float');
    const time = uniforms.uTime;

    // Rise with time, looping (mod 80, offset -10) — matches the old vertex shader.
    const riseSpeed = aSpeed.mul(3.2);
    const yOffset = mod(time.mul(riseSpeed).add(aRandom.mul(72.0)), 92.0).sub(10.0);
    const lifeProgress = clamp(yOffset.add(10.0).div(92.0), 0.0, 1.0);
    const spread = lifeProgress.mul(24.0);
    const angle = time.mul(0.26).add(aRandom.mul(TAU));
    const yPos = aBase.y.add(yOffset);
    const cx = aBase.x.add(sin(angle.add(yPos.mul(0.02))).mul(spread));
    const cz = aBase.z.add(cos(angle.mul(0.7).add(yPos.mul(0.015))).mul(spread).mul(0.8));
    const center = vec3(cx, yPos, cz);

    // Size grows as smoke rises; pixel size -> small world size.
    const worldSize = aSize.mul(lifeProgress.mul(1.8).add(0.85)).mul(0.23);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, worldSize);
    const smokeBase = mix(vec3(0.035, 0.028, 0.038), vec3(0.13, 0.055, 0.034), aRandom);
    const lavaTint = vec3(0.38, 0.095, 0.025).mul(pow(oneMinus(lifeProgress), 2.2));
    material.colorNode = smokeBase.add(lavaTint);
    const glow = spriteGlowMask(0.72);
    const fadeIn = smoothstep(0.02, 0.16, lifeProgress);
    material.opacityNode = glow.mul(oneMinus(lifeProgress).mul(0.46).add(0.04)).mul(fadeIn);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;

    const smoke = new THREE.Mesh(geometry, material);
    smoke.name = 'volcanic-smoke';
    smoke.frustumCulled = false;
    return smoke;
}

/**
 * Ember stars — twinkling background sparkles as instanced additive billboards.
 * Mirrors the old ember-star Points (position + size/twinkle/brightness/color attrs).
 */
function createEmberStars(uniforms, count) {
    const bases = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinklePhases = new Float32Array(count);
    const twinkleSpeeds = new Float32Array(count);
    const brightnesses = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        const r = 25 + Math.random() * 35; // radius 25–60 (sparse depth field)
        const theta = Math.random() * TAU;
        const phi = Math.acos(2 * Math.random() - 1);
        bases[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        bases[i * 3 + 1] = r * Math.cos(phi);
        bases[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

        const sizeBias = Math.random() ** 2;
        sizes[i] = 0.4 + sizeBias * 2.5;
        twinklePhases[i] = Math.random() * TAU;
        twinkleSpeeds[i] = 2 + Math.random() * 4;
        brightnesses[i] = 0.3 + Math.random() * 0.7;

        const color = new THREE.Color(
            EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)],
        );
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aTwinklePhase: { array: twinklePhases, itemSize: 1 },
        aTwinkleSpeed: { array: twinkleSpeeds, itemSize: 1 },
        aBrightness: { array: brightnesses, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aTwinklePhase = attribute('aTwinklePhase', 'float');
    const aTwinkleSpeed = attribute('aTwinkleSpeed', 'float');
    const aBrightness = attribute('aBrightness', 'float');
    const aColor = attribute('aColor', 'vec3');
    const { uTime, uPulseIntensity } = uniforms;

    const twinkle = sin(uTime.mul(aTwinkleSpeed).add(aTwinklePhase)).mul(0.3).add(0.7);
    const brightness = aBrightness.mul(twinkle).mul(uPulseIntensity.mul(0.5).add(1.0));

    const worldSize = aSize.mul(uPulseIntensity.mul(0.3).add(1.0)).mul(0.16);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(aBase, worldSize);
    // Soft glow with a hot white core (smoothstep on dist).
    const p = uv().sub(0.5);
    const dist = p.length().mul(2.0);
    const glow = pow(clamp(oneMinus(dist), 0.0, 1.0), 1.5);
    const core = smoothstep(0.2, 0.0, dist.mul(0.5));
    const hotColor = mix(aColor, vec3(1.0, 0.95, 0.85), core.mul(0.5));
    material.colorNode = hotColor.mul(glow).mul(brightness);
    material.opacityNode = glow.mul(brightness);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;

    const stars = new THREE.Mesh(geometry, material);
    stars.name = 'ember-stars';
    stars.frustumCulled = false;
    return stars;
}

/**
 * Rising ember particles — an ember-STORM in a few rising COLUMNS rather than an even
 * ring. Each ember is seeded around one of a small set of column centres (the lava-fall
 * splash + node shelves), giving directional shafts of rising sparks. Spiraling, fading
 * additive billboards animated from uTime so the update loop is unchanged.
 */
function createRisingEmbers(uniforms, count) {
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);

    // Column centres: lava-fall splash, node-shelf clusters, and side smoke banks.
    const columns = [
        { x: 24, z: 3 - 116, spread: 14 }, // lava-fall splash
        { x: -22, z: 3 - 55, spread: 11 }, // left node shelf cluster
        { x: 12, z: 3 - 20, spread: 12 }, // near corridor cluster
        { x: -48, z: 3 - 96, spread: 16 }, // side smoke bank
    ];
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const col = columns[i % columns.length];
        const theta = Math.random() * TAU;
        const radius = Math.random() * col.spread;
        bases[i3] = col.x + Math.cos(theta) * radius;
        bases[i3 + 1] = LAVA_LAKE_Y + (Math.random() - 0.5) * 8;
        bases[i3 + 2] = col.z + Math.sin(theta) * radius;
        randoms[i] = Math.random();
        sizes[i] = 3.0 + Math.random() * 5.0;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aRandom: { array: randoms, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aRandom = attribute('aRandom', 'float');
    const aSize = attribute('aSize', 'float');
    const time = uniforms.uTime;

    // Rise (mod 50, offset -25) + gentle spiral drift — matches the old vertex shader.
    const riseSpeed = aRandom.mul(2.5).add(1.5);
    const yOffset = mod(time.mul(riseSpeed).add(aRandom.mul(40.0)), 50.0).sub(25.0);
    const angle = time.mul(0.4).add(aRandom.mul(TAU));
    const radius = aRandom.mul(3.0).add(1.5);
    const yPos = aBase.y.add(yOffset);
    const cx = aBase.x.add(sin(angle.add(yPos.mul(0.05))).mul(radius));
    const cz = aBase.z.add(cos(angle.mul(0.7).add(yPos.mul(0.04))).mul(radius).mul(0.8));
    const center = vec3(cx, yPos, cz);

    const normalizedY = yOffset.add(25.0).div(50.0);
    const worldSize = aSize.mul(oneMinus(normalizedY.mul(0.5))).mul(0.16);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, worldSize);
    // §5.3 temperature ramp by LIFE (white-hot → orange → red → ash, pyrestorm look):
    // fresh sparks at the lava are hottest, cooling as they rise. `life` = 1 new → 0 old.
    const life = oneMinus(normalizedY);
    const whiteHot = vec3(1.0, 0.95, 0.85);
    const orange = vec3(1.0, 0.45, 0.06);
    const red = vec3(0.8, 0.12, 0.02);
    const ash = vec3(0.2, 0.12, 0.08);
    const lowRamp = mix(ash, red, clamp(life.div(0.35), 0.0, 1.0));
    const midRamp = mix(red, orange, clamp(life.sub(0.35).div(0.35), 0.0, 1.0));
    const hiRamp = mix(orange, whiteHot, clamp(life.sub(0.7).div(0.3), 0.0, 1.0));
    let baseColor = mix(lowRamp, midRamp, smoothstep(0.35, 0.36, life));
    baseColor = mix(baseColor, hiRamp, smoothstep(0.7, 0.71, life));
    const p = uv().sub(0.5);
    const dist = p.length().mul(2.0);
    const glow = pow(clamp(oneMinus(dist), 0.0, 1.0), 1.8);
    const core = smoothstep(0.2, 0.0, dist.mul(0.5));
    const hotColor = mix(baseColor, vec3(1.0, 0.95, 0.85), core.mul(0.5));
    const alpha = oneMinus(normalizedY).mul(aRandom.mul(0.4).add(0.6));
    material.colorNode = hotColor.mul(glow);
    material.opacityNode = glow.mul(alpha);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;

    const embers = new THREE.Mesh(geometry, material);
    embers.name = 'rising-embers';
    embers.frustumCulled = false;
    return embers;
}

/**
 * Tiny SHARP near-camera embers (§3.3/§5.3 scale cue). A small set of bright, crisp,
 * fast-rising sparks seeded right on the path centreline so the eye gets a known small
 * size to measure the cavern against. Brightest sparks are bloom-eligible; a temperature
 * ramp (white-hot → orange → red → ash, like pyrestorm's ember shader) drives the color
 * by normalized life. Crisp = a tighter glow exponent + a hot white core. Capped.
 */
function createNearCameraEmbers(uniforms, count, yLow, yHigh) {
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);

    const span = yHigh - yLow;
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        // Hug the path centreline (x≈-1.5, z≈3) within a tight tube so they read as
        // near-camera foreground sparks across the whole descent.
        const angle = Math.random() * TAU;
        const radius = Math.random() * 4;
        bases[i3] = -1.5 + Math.cos(angle) * radius;
        bases[i3 + 1] = yLow + Math.random() * span;
        bases[i3 + 2] = 3 + Math.sin(angle) * radius;
        randoms[i] = Math.random();
        sizes[i] = 0.6 + Math.random() * 1.0; // SMALL + sharp (scale cue)
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aRandom: { array: randoms, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aRandom = attribute('aRandom', 'float');
    const aSize = attribute('aSize', 'float');
    const time = uniforms.uTime;
    const { uPulseIntensity } = uniforms;

    // Fast rise (mod 22, offset -4) so near sparks streak past the camera.
    const riseSpeed = aRandom.mul(4.0).add(3.0);
    const yOffset = mod(time.mul(riseSpeed).add(aRandom.mul(20.0)), 22.0).sub(4.0);
    const drift = sin(time.mul(1.5).add(aRandom.mul(TAU))).mul(0.8);
    const yPos = aBase.y.add(yOffset);
    const center = vec3(aBase.x.add(drift), yPos, aBase.z.add(drift.mul(0.6)));

    const life = clamp(oneMinus(yOffset.add(4.0).div(22.0)), 0.0, 1.0); // 1 new → 0 spent
    const worldSize = aSize.mul(uPulseIntensity.mul(0.3).add(1.0)).mul(0.12);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, worldSize);

    // §5.3 temperature ramp by life: white-hot → orange → red → ash (pyrestorm look).
    const whiteHot = vec3(1.0, 0.95, 0.85);
    const orange = vec3(1.0, 0.45, 0.06);
    const red = vec3(0.8, 0.12, 0.02);
    const ash = vec3(0.18, 0.1, 0.07);
    const lowRamp = mix(ash, red, clamp(life.div(0.35), 0.0, 1.0));
    const midRamp = mix(red, orange, clamp(life.sub(0.35).div(0.35), 0.0, 1.0));
    const hiRamp = mix(orange, whiteHot, clamp(life.sub(0.7).div(0.3), 0.0, 1.0));
    let rampColor = mix(lowRamp, midRamp, smoothstep(0.35, 0.36, life));
    rampColor = mix(rampColor, hiRamp, smoothstep(0.7, 0.71, life));

    const p = uv().sub(0.5);
    const dist = p.length().mul(2.0);
    const glow = pow(clamp(oneMinus(dist), 0.0, 1.0), 2.6); // tighter = sharper spark
    const core = smoothstep(0.18, 0.0, dist.mul(0.5));
    const hotColor = mix(rampColor, vec3(1.0, 0.97, 0.9), core.mul(0.6));

    material.colorNode = hotColor.mul(glow);
    material.opacityNode = glow.mul(life.mul(0.7).add(0.3));
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true; // brightest near sparks bloom (capped by glow)

    const sparks = new THREE.Mesh(geometry, material);
    sparks.name = 'near-camera-embers';
    sparks.frustumCulled = false;
    return sparks;
}

/**
 * Molten volumetric haze — warm glowing puffs hugging the path corridor along the
 * WHOLE chapter span so approach/entry frames are not bare. Instanced billboard quads
 * (Points are 1px on WebGPU), distributed in a tube around the path centerline (local
 * Y from `yLow` to `yHigh`), capped + additive + feathered (no white blowout).
 * @param {object} uniforms shared chapter uniforms (uTime/uPulseIntensity)
 * @param {number} count instance count (capped)
 * @param {number} yLow corridor bottom in chapter-local Y
 * @param {number} yHigh corridor top in chapter-local Y
 */
function createMoltenHaze(uniforms, count, yLow, yHigh) {
    const bases = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);

    const span = yHigh - yLow;
    for (let i = 0; i < count; i++) {
        // Spread around the path centerline (x≈-1.5, z≈3 in local space) in a ring so
        // the camera is always inside warm haze, denser low (near the lava).
        const angle = Math.random() * TAU;
        const radius = 8 + Math.random() * 34;
        const yT = i / count; // even vertical coverage of the corridor
        const y = yLow + yT * span + (Math.random() - 0.5) * (span / count) * 2.5;
        bases[i * 3] = -1.5 + Math.cos(angle) * radius;
        bases[i * 3 + 1] = y;
        bases[i * 3 + 2] = 3 + Math.sin(angle) * radius;
        seeds[i] = Math.random();
        // Larger puffs lower (hugging the lava), smaller higher up the corridor.
        sizes[i] = (16 + Math.random() * 22) * (1.0 - yT * 0.45);
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSeed: { array: seeds, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
    });

    const { material } = createMoltenHazeMaterialTSL(uniforms.uTime, uniforms.uPulseIntensity);
    const haze = new THREE.Mesh(geometry, material);
    haze.name = 'molten-haze';
    haze.frustumCulled = false;
    haze.renderOrder = -10; // behind the hero set pieces, in front of the backstop
    return haze;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create the Earth Core environment group
 */
/**
 * Overhead magma-cloud puffs. This is the particle counterpart to the canopy dome:
 * slower, darker smoke sheets with small lava-lit pockets, arranged above the path so
 * the chapter has a visible boiling "sky" instead of only background color.
 */
function createMagmaCloudDeck(uniforms, count, corridorHigh) {
    const bases = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    const coolSmoke = new THREE.Color(0x080712);
    const warmSmoke = new THREE.Color(0x2a0a05);
    for (let i = 0; i < count; i++) {
        const zT = Math.random();
        const x = (Math.random() - 0.5) * 140;
        const y = corridorHigh - 4 - Math.random() * 24;
        const z = 3 - 24 - zT * 150;
        bases[i * 3] = x;
        bases[i * 3 + 1] = y;
        bases[i * 3 + 2] = z;
        seeds[i] = Math.random();
        sizes[i] = 28 + Math.random() * 64;

        const color = coolSmoke.clone().lerp(warmSmoke, Math.random() * 0.8);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    const cloudMap = createCloudTexture();
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSeed: { array: seeds, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aSeed = attribute('aSeed', 'float');
    const aSize = attribute('aSize', 'float');
    const aColor = attribute('aColor', 'vec3');
    const { uTime, uPulseIntensity } = uniforms;

    const driftT = uTime.mul(0.045).add(aSeed.mul(TAU));
    const center = aBase.add(vec3(
        sin(driftT).mul(5.5),
        sin(driftT.mul(0.7)).mul(2.0),
        cos(driftT.mul(0.8)).mul(6.0),
    ));
    const worldSize = aSize.mul(uPulseIntensity.mul(0.08).add(1.0));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, worldSize);
    const sprite = texture(cloudMap, uv());
    const hotPocket = pow(sprite.a, 2.4)
        .mul(sin(uTime.mul(0.35).add(aSeed.mul(9.0))).mul(0.18).add(0.82));
    material.colorNode = aColor
        .add(vec3(0.42, 0.10, 0.025).mul(hotPocket).mul(0.42))
        .mul(uPulseIntensity.mul(0.08).add(1.0));
    material.opacityNode = sprite.a.mul(0.18).mul(sin(driftT.mul(0.5)).mul(0.12).add(0.88));
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;

    const deck = new THREE.Mesh(geometry, material);
    deck.name = 'magma-cloud-deck';
    deck.frustumCulled = false;
    deck.renderOrder = -88;
    return deck;
}

export function createEarthCoreEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'earth-core-environment';
    group.userData.chapterId = 1;
    group.userData.yStart = EARTH_CORE_CONFIG.yStart;
    group.userData.yEnd = EARTH_CORE_CONFIG.yEnd;
    const chapterRange = getChapterPathRange(1);
    const fallbackCenterY = (EARTH_CORE_CONFIG.yStart + EARTH_CORE_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    // Shared uniforms — TSL uniform nodes (settable .value, ticked by update()).
    // uDescent (0 vault-top → 1 at the lake) is driven from camera progress in
    // updateEarthCoreEnvironment to intensify the lake/lava-fall emission on descent.
    const uniforms = {
        uTime: uniform(0),
        uPulseIntensity: uniform(0),
        uDescent: uniform(0),
        // PERF (QW9): baked-bounce strength for the lit rock material. The 4 crater
        // accents + per-cluster magma-bounce PointLights were cut; this drives a baked
        // warm emissive floor on the molten-pocket/column material so the rock still
        // reads as warm-lit without per-fragment light loops. 1 = full bake (the look
        // the removed lights produced); a future adaptive controller can dial it.
        uBakedBounce: uniform(1),
    };
    group.userData.uniforms = uniforms;

    // Storage for elements
    const elements = {
        rockClusters: [],
        filaments: [],
    };
    group.userData.elements = elements;

    // 1. Create background sphere (enhanced with lava glow)
    const background = createVolcanoBackground(uniforms);
    group.add(background);
    const magmaCloudCanopy = createMagmaCloudCanopyTSL(uniforms.uTime, uniforms.uPulseIntensity);
    group.add(magmaCloudCanopy.mesh);
    group.userData.magmaCloudCanopy = magmaCloudCanopy.mesh;

    // 2. Create animated lava floor - THE MAIN FEATURE
    const lavaFloor = createLavaFloor(uniforms);
    group.add(lavaFloor);
    group.userData.lavaFloor = lavaFloor;

    // 3. Create volcanic crater rim - VOLUMETRIC PARTICLE SYSTEM
    const craterRim = createParticleCraterRim();
    group.add(craterRim);

    // 4. Background magma spheres are SUPPORT ONLY. Keep them small, off-path, and
    // sparse so level nodes + boulders stop competing with the lava-fall hero.
    const clusterCount = Math.min(options.particleCount ? Math.floor(options.particleCount / 180) : 2, 2);
    createVolcanicRockClusters(group, uniforms, elements, clusterCount);

    // 5. Ember STARS as background sparkle — cut 6000→1200, radius pulled to 25–60 so
    //    they read as a sparse depth field, not an orange soup.
    const starCount = Math.floor(options.particleCount ? Math.min(options.particleCount * 2.8, 1400) : 1200);
    const stars = createEmberStars(uniforms, starCount);
    group.add(stars);
    group.userData.stars = stars;

    // 6. Rising ember particles re-aimed into a few rising COLUMNS (ember-storm) rather
    //    than an even ring, clustered at the lava-fall splash + node shelves.
    const risingEmbers = createRisingEmbers(uniforms, 760);
    group.add(risingEmbers);
    group.userData.risingEmbers = risingEmbers;

    // 7. Create volcanic smoke/ash particles (trimmed 300→200 for the value cuts).
    const smoke = createVolcanicSmoke(uniforms, 320);
    group.add(smoke);
    group.userData.smoke = smoke;

    // The chapter group is anchored at the path centre below; derive the corridor's
    // local-space frame from that centre so the new corridor content (horizon band,
    // molten haze, level-node pockets) lines up with the spline the camera follows.
    const groupCenter = chapterRange?.center
        ? new THREE.Vector3(chapterRange.center.x, chapterCenterY, chapterRange.center.z)
        : new THREE.Vector3(0, chapterCenterY, 0);

    // 8. Magma horizon — §3.1: the 3 bands now read as the lake's FAR SHORE, aligned so
    //    their bright rim line sits at the lake surface (LAVA_LAKE_Y) instead of floating
    //    mid-air. The magma-horizon's bright rim is at uv.y≈0.32 of a 200-unit plane, so
    //    a band whose rim aligns to the lake has centerY = LAVA_LAKE_Y + 36*scaleY. This
    //    turns the bands into a continuous far-shore line under the assets.
    const corridorLow = (chapterRange ? chapterRange.start.y - groupCenter.y : -77) - 5;
    const corridorHigh = (chapterRange ? chapterRange.end.y - groupCenter.y : 77) + 20;
    const cloudDeckCount = Math.min(options.particleCount ? Math.floor(options.particleCount * 0.8) : 170, 220);
    const magmaCloudDeck = createMagmaCloudDeck(uniforms, cloudDeckCount, corridorHigh);
    group.add(magmaCloudDeck);
    group.userData.magmaCloudDeck = magmaCloudDeck;
    const horizonRimY = (scaleY) => LAVA_LAKE_Y + 36 * scaleY; // align rim to lake surface
    const farHorizon = createMagmaHorizonTSL(uniforms.uTime, uniforms.uPulseIntensity);
    farHorizon.mesh.position.set(-1.5, horizonRimY(1), 3 - 150);
    group.add(farHorizon.mesh);
    const lowHorizon = createMagmaHorizonTSL(uniforms.uTime, uniforms.uPulseIntensity);
    lowHorizon.mesh.position.set(-60, horizonRimY(0.55), 3 - 95);
    lowHorizon.mesh.scale.set(0.7, 0.55, 1);
    group.add(lowHorizon.mesh);
    // A MID-DEPTH magma glow band biased off-centre-left, aligned to the same far-shore
    // line so it reads as the lake's far edge sweeping behind the columns rather than a
    // floating wall. Cheap: reuses the horizon builder (one extra draw call).
    const midHorizon = createMagmaHorizonTSL(uniforms.uTime, uniforms.uPulseIntensity);
    midHorizon.mesh.position.set(60, horizonRimY(0.7), 3 - 118);
    midHorizon.mesh.scale.set(0.85, 0.7, 1);
    group.add(midHorizon.mesh);
    group.userData.horizons = [farHorizon.mesh, lowHorizon.mesh, midHorizon.mesh];

    // 9. Molten volumetric haze hugging the path along the whole corridor span.
    const hazeCount = Math.floor(options.particleCount ? Math.min(options.particleCount * 1.8, 340) : 300);
    const haze = createMoltenHaze(uniforms, hazeCount, corridorLow, corridorHigh);
    group.add(haze);
    group.userData.haze = haze;

    // 10. Molten "pockets" — a small obsidian shelf at each level node within this
    //     chapter so nodes frame mid-frame on a platform instead of floating in void.
    createMoltenPockets(group, uniforms, groupCenter);

    // 11. LAVA-FALL hero — staged as the chapter landmark, not another orange strip.
    // Two crossed planes form one volumetric fall so it reads from the moving camera,
    // seated into a horizontal splash decal on the lifted lake.
    const fallX = 24;
    const fallZ = 3 - 116;
    const fallScale = 2.75;
    const fallHeight = 220 * fallScale;
    const lavaFallGroup = new THREE.Group();
    lavaFallGroup.name = 'lava-fall-hero';

    const lavaFall = createLavaFallTSL(uniforms.uTime, uniforms.uPulseIntensity, uniforms.uDescent);
    lavaFall.mesh.scale.set(fallScale, fallScale, 1);
    lavaFall.mesh.position.set(0, fallHeight * 0.5, 0);
    lavaFall.mesh.renderOrder = -4;
    lavaFallGroup.add(lavaFall.mesh);

    const lavaFallCross = createLavaFallTSL(uniforms.uTime, uniforms.uPulseIntensity, uniforms.uDescent);
    lavaFallCross.mesh.scale.set(fallScale * 0.52, fallScale, 1);
    lavaFallCross.mesh.position.set(0, fallHeight * 0.5, 0);
    lavaFallCross.mesh.rotation.y = Math.PI / 2;
    lavaFallCross.mesh.renderOrder = -4;
    lavaFallGroup.add(lavaFallCross.mesh);

    lavaFallGroup.position.set(fallX, LAVA_LAKE_Y, fallZ);
    group.add(lavaFallGroup);
    group.userData.lavaFall = lavaFallGroup;

    const fallSplash = createLavaSplashDecal(92, 42, 0.42);
    fallSplash.position.set(fallX, LAVA_LAKE_Y + 0.55, fallZ);
    fallSplash.rotation.z = -0.18;
    group.add(fallSplash);
    group.userData.lavaFallSplash = fallSplash;

    // 12. God-ray shafts — 3–4 large low-opacity vertical cones above the lake, biased
    //     toward the lava-fall splash so the ember-storm reads as rising through light.
    const godRayConfigs = [
        { x: fallX + 2, z: fallZ + 6, scale: 1.35 }, // over the lava-fall splash
        { x: -34, z: 3 - 70, scale: 1.0 },
        { x: 14, z: 3 - 110, scale: 1.4 },
        { x: -8, z: 3 - 40, scale: 0.9 },
    ];
    const godRays = godRayConfigs.map((cfg) => {
        const cone = createGodRayConeTSL(uniforms.uTime, uniforms.uPulseIntensity);
        cone.mesh.position.set(cfg.x, LAVA_LAKE_Y + 60, cfg.z);
        cone.mesh.scale.set(cfg.scale, cfg.scale * 1.1, cfg.scale);
        cone.mesh.frustumCulled = false;
        group.add(cone.mesh);
        return cone.mesh;
    });
    group.userData.godRays = godRays;

    // 13. Silhouetted obsidian COLUMNS — §3.2/§3.3 staged repoussoir framing. The
    //     columns are now placed to BRACKET each frame edge ACROSS the descent: the
    //     chapter path is sampled at 3 points (top / mid / bottom of the drop) and a
    //     near-black pillar is anchored to the left and right of each, so a vertical
    //     element always holds each frame edge as the on-rails camera falls. Heights
    //     vary aggressively — a couple of 150+ GIANTS whose tops are lost in the ceiling
    //     haze (oppressive scale/implied height) among 70-tall framing pillars. Every
    //     column base rests AT the lake surface (base seated, not centred through it) and
    //     gets a contact-shadow AO decal (§5.1) so it grounds into the lake.
    const columnSpecs = [];
    const [chTStartForCols, chTEndForCols] = getActiveOdysseyChapterPositions();
    const bracketTs = [0.18, 0.62]; // fewer, cleaner brackets for open composition
    bracketTs.forEach((ftLocal, bi) => {
        const tGlobal = THREE.MathUtils.lerp(
            chTStartForCols ?? 0,
            chTEndForCols ?? 0.125,
            ftLocal,
        );
        const pt = getOdysseyPathPointAt(tGlobal);
        const localX = pt.x - groupCenter.x;
        const localZ = pt.z - groupCenter.z;
        // Push pillars OUT past the corridor edge so they frame, not clip, the camera.
        const edge = 50 + bi * 12;
        // Left edge: a framing pillar pushed outside the playable sightline.
        columnSpecs.push({
            x: localX - edge, z: localZ - 12 - bi * 24, r: 7.5 + bi, h: bi === 1 ? 142 : 104, giant: bi === 1,
        });
        // Right edge: counter-framing pillar, still outside the path/node silhouette.
        columnSpecs.push({
            x: localX + edge, z: localZ + 6 - bi * 22, r: 8 + bi, h: bi === 0 ? 132 : 108, giant: bi === 0,
        });
    });
    // One far filler only: depth cue without re-cluttering the middle of the screen.
    columnSpecs.push({
        x: -66, z: 3 - 118, r: 7.5, h: 112, giant: false,
    });

    const columns = columnSpecs.map((spec) => {
        const col = createObsidianColumnTSL(
            uniforms.uTime,
            uniforms.uPulseIntensity,
            spec.r,
            spec.h,
            uniforms.uBakedBounce,
        );
        // Seat the BASE at the lake surface (center = lake + h/2) so the column rises out
        // of the lake instead of passing half through it.
        col.mesh.position.set(spec.x, LAVA_LAKE_Y + spec.h * 0.5, spec.z);
        col.mesh.frustumCulled = false;
        group.add(col.mesh);

        // §5.1 contact-shadow AO decal at the lake line under the column base.
        const decal = createContactShadowDecalTSL(spec.r * 3.2);
        decal.mesh.position.set(spec.x, LAVA_LAKE_Y + 0.4, spec.z);
        decal.mesh.frustumCulled = false;
        group.add(decal.mesh);
        return col.mesh;
    });
    group.userData.columns = columns;

    // 13b. OPPRESSIVE walls/ceiling (§3.3) — a few large near-black slabs pressing the
    //      top of the corridor so the camera falls THROUGH a tight cathedral. Reuse the
    //      obsidian-column builder as wide, short, ceiling-hung slabs near-frame top. No
    //      contact decal (they hang from the ceiling, not the lake).
    const ceilingSpecs = [
        {
            x: -48, z: 3 - 70, r: 14, h: 22, // side ceiling mass, not over the node
        },
        {
            x: 54, z: 3 - 130, r: 16, h: 24, // far side ceiling mass
        },
    ];
    const ceilingSlabs = ceilingSpecs.map((spec) => {
        const slab = createObsidianColumnTSL(
            uniforms.uTime,
            uniforms.uPulseIntensity,
            spec.r,
            spec.h,
            uniforms.uBakedBounce,
        );
        // Hang from the top of the corridor (well above the lake), inverted so the wide
        // end reads as a ceiling vault pressing down.
        slab.mesh.position.set(spec.x, corridorHigh - spec.h * 0.4, spec.z);
        slab.mesh.rotation.z = Math.PI; // flare the wide end downward (ceiling vault)
        slab.mesh.frustumCulled = false;
        slab.mesh.name = 'ceiling-slab';
        group.add(slab.mesh);
        return slab.mesh;
    });
    group.userData.ceilingSlabs = ceilingSlabs;

    // 13c. Tiny SHARP near-camera embers (§3.3/§5.3 scale cue) — a small set of bright,
    //      crisp sparks seeded right on the path centreline so the eye has a known small
    //      size to measure the lake/columns against. Separate small system, capped.
    const sharpEmberCount = Math.min(options.particleCount ? Math.floor(options.particleCount / 5) : 72, 96);
    const sharpEmbers = createNearCameraEmbers(uniforms, sharpEmberCount, corridorLow, corridorHigh);
    group.add(sharpEmbers);
    group.userData.sharpEmbers = sharpEmbers;

    // 14. Setup enhanced volcanic lighting (incl. warm bounce on background spheres).
    setupVolcanicLighting(group);
    addMagmaSphereBounceLights(group, elements);

    // Record the chapter's spline t-span so update() can map global camera progress to
    // a local descent value (0 vault-top → 1 at the lake) with no per-frame allocation.
    const chapterPositions = getActiveOdysseyChapterPositions();
    group.userData.chapterTStart = chapterPositions[0] ?? 0;
    group.userData.chapterTEnd = chapterPositions[1] ?? 0.125;

    // Position the environment — anchor to the path's FULL centre (x, y, z), not
    // just Y, so the lava vault sits around the path and the path doesn't clip
    // through chapter geometry (mirrors mountain-peaks.js).
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterCenterY, chapterRange.center.z);
    } else {
        group.position.y = chapterCenterY;
    }

    return group;
}

/**
 * Create the opaque molten LAVA LAKE - the centerpiece of the chapter. The wide,
 * lowered, low-displacement opaque lake the camera looks ACROSS (validated TSL
 * builder). Glow sprites are dimmed/shrunk for the value hierarchy (~70% dark rock).
 */
function createLavaFloor(uniforms) {
    const group = new THREE.Group();
    group.name = 'lava-floor';

    // Main lava LAKE — wide (360 square), lifted (y=-10), opaque, NormalBlending lake the
    // camera looks across (not the old shard-y additive floor seen edge-on). Pass the
    // shared uTime/uPulseIntensity/uDescent TSL uniforms so animation ticks unchanged.
    const { mesh: lavaSurface } = createLavaLakeTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        uniforms.uDescent,
    );
    group.add(lavaSurface);

    // Dim, shrunk glow layers beneath (value hierarchy: scales 180/100→120/70,
    // opacity 0.35/0.5→0.18/0.28). Seated beneath the y=-10 lake.
    const glowTexture = createLavaGlowTexture();

    const ambientGlow = new THREE.Sprite(makeGlowSpriteMaterial(glowTexture, 0xff4400, 0.18));
    ambientGlow.scale.set(120, 120, 1);
    ambientGlow.position.y = LAVA_LAKE_Y - 2;
    ambientGlow.rotation.x = -Math.PI / 2;
    group.add(ambientGlow);

    const innerGlow = new THREE.Sprite(makeGlowSpriteMaterial(glowTexture, 0xffaa00, 0.28));
    innerGlow.scale.set(70, 70, 1);
    innerGlow.position.y = LAVA_LAKE_Y - 1;
    innerGlow.rotation.x = -Math.PI / 2;
    group.add(innerGlow);

    group.userData.glows = [ambientGlow, innerGlow];
    group.userData.surface = lavaSurface;

    return group;
}

/**
 * Horizontal additive splash at the lava-fall impact point. This is deliberately a
 * single grounded decal, not another floating orb, so the hero reads as meeting the
 * lake surface.
 */
function createLavaSplashDecal(width = 80, depth = 36, opacity = 0.36) {
    const texture = createLavaGlowTexture();
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xff6a18,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    material.userData.emitsBloom = true;

    const geometry = new THREE.PlaneGeometry(width, depth, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'lava-fall-splash';
    mesh.renderOrder = -3;
    mesh.frustumCulled = false;
    return mesh;
}

/**
 * Create volcanic crater rim with jagged rock formations
 */
/**
 * Create volcanic crater rim using Volumetric Particles
 * Replaces the mesh-based rim to avoid hard edges and lighting artifacts.
 */
function createParticleCraterRim() {
    const group = new THREE.Group();
    group.name = 'crater-rim-particles';

    // 1. Generate Particle Data
    const particleCount = 420;
    const bases = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    // Base color: Deeper, richer volcanic tone (Less blown out)
    const baseColor = new THREE.Color(0x5a1208); // Deep charred red
    const glowColor = new THREE.Color(0xb83208); // Muted orange-red

    const radiusBase = 55;
    const tubeRadius = 9;

    for (let i = 0; i < particleCount; i++) {
        // Distribute in a torus volume
        const angle = Math.random() * Math.PI * 2;

        // Random offset within the tube volume (horizontal width spread)
        const widthSpread = (Math.random() - 0.5) * tubeRadius * 3;

        const r = radiusBase + widthSpread;

        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        // Height variation - gently undulating
        const y = -3 + (Math.random() - 0.5) * 6;

        bases[i * 3] = x;
        bases[i * 3 + 1] = y;
        bases[i * 3 + 2] = z;

        // Color variation based on height
        // Lower particles = closer to lava = more orange/glow
        // Higher particles = cooler/darker
        const heightFactor = (y + 6) / 12; // 0 to 1 mapping approx
        const mixFactor = (1.0 - heightFactor) ** 2.0 * 0.6; // Bias towards bottom

        const pColor = baseColor.clone().lerp(glowColor, mixFactor);
        colors[i * 3] = pColor.r;
        colors[i * 3 + 1] = pColor.g;
        colors[i * 3 + 2] = pColor.b;
    }

    // 2. Material — instanced billboard "cloud" puffs (Points are 1px on WebGPU).
    const cloudMap = createCloudTexture();

    const geometry = makeQuadInstancedGeometry(particleCount, {
        aBase: { array: bases, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aColor = attribute('aColor', 'vec3');

    // Old constant point size of 25px -> a large world-space puff.
    const worldSize = float(14.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(aBase, worldSize);
    // Sample the soft cloud sprite; tint by per-particle color, fade at low opacity.
    const sprite = texture(cloudMap, uv());
    material.colorNode = aColor;
    material.opacityNode = sprite.a.mul(0.08);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;

    const particles = new THREE.Mesh(geometry, material);
    particles.name = 'crater-rim-cloud';
    particles.frustumCulled = false;
    group.add(particles);

    return group;
}

/**
 * Generate a soft radial gradient texture for cloud particles
 */
function createCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    // Soft white puff center
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    // Fade out
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.4)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    return new THREE.CanvasTexture(canvas);
}

/**
 * Volcanic background sphere (enhanced)
 */
function createVolcanoBackground(uniforms) {
    // Validated TSL builder sets name/renderOrder(-90)/BackSide/depthWrite=false and
    // shares in the chapter's uTime/uPulseIntensity uniforms so animation ticks unchanged.
    const { mesh: sphere } = createVolcanoBackgroundTSL(uniforms.uTime, uniforms.uPulseIntensity);
    return sphere;
}

/**
 * §3.4 — re-seat the obsidian geodes ON the lake in near/mid/far CLUSTERS (not a single
 * far ring): each boulder's base is tangent to the lake surface (center y = LAVA_LAKE_Y
 * + size) so it rests on the lake/islet, and gets a contact-shadow AO decal at the lake
 * line (§5.1). Lit geodes take the lake bounce + distance falloff so they ground with
 * depth. Count stays small (value hierarchy: ~70% dark rock).
 */
function createVolcanicRockClusters(group, uniforms, elements, count) {
    // Near / mid / far seats along the corridor (on the lake, off the path centreline so
    // the glowing path tube passes cleanly between them).
    const seats = [
        { x: -42, z: 3 - 72, depth: 'mid' },
        { x: 48, z: 3 - 132, depth: 'far' },
        { x: -58, z: 3 - 146, depth: 'far' },
    ];
    const sizeByDepth = { mid: 3.8, far: 3.0 };
    const jitterByDepth = { mid: 1.2, far: 0.9 };
    for (let i = 0; i < count; i++) {
        const seat = seats[i % seats.length];
        const size = sizeByDepth[seat.depth] + Math.random() * jitterByDepth[seat.depth];
        // Base tangent to the lake: center y = lake + size (boulder rests ON the lake).
        const position = new THREE.Vector3(seat.x, LAVA_LAKE_Y + size, seat.z);

        const cluster = createRockCluster(uniforms, position, size);
        group.add(cluster);
        elements.rockClusters.push(cluster);

        // §5.1 contact-shadow AO decal at the lake line under the boulder.
        const decal = createContactShadowDecalTSL(size * 2.6);
        decal.mesh.position.set(seat.x, LAVA_LAKE_Y + 0.3, seat.z);
        decal.mesh.frustumCulled = false;
        group.add(decal.mesh);
    }
}

/**
 * Create a single grounded geode: a solid LIT obsidian boulder with ONE small dim glow
 * sprite. Seated on the lake; the lit material takes the lake bounce + distance falloff.
 * @param {object} uniforms shared chapter uniforms
 * @param {THREE.Vector3} position world-local seat (center already tangent to the lake)
 * @param {number} size sphere radius (defaults preserved for back-compat callers)
 */
function createRockCluster(uniforms, position, size = 4 + Math.random() * 6) {
    const ballGroup = new THREE.Group();

    // Solid LIT obsidian boulder — validated TSL builder (smooth sphere silhouette,
    // dark albedo + emissive veins, lake-distance bounce), sharing the chapter uniforms
    // incl. uBakedBounce so it grounds with depth like the columns/shelves.
    const { mesh: coreMesh } = createRockClusterTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        size,
        uniforms.uBakedBounce,
    );
    ballGroup.add(coreMesh);

    // One small, dim corona glow only (was three stacked sprites — clutter).
    const glowTexture = createGlowTexture();
    const innerGlow = new THREE.Sprite(makeGlowSpriteMaterial(glowTexture, 0xff5a14, 0.055));
    innerGlow.scale.set(size * 2.1, size * 2.1, 1);
    ballGroup.add(innerGlow);

    ballGroup.position.copy(position);
    ballGroup.userData.glows = [innerGlow];
    ballGroup.userData.size = size;

    return ballGroup;
}

/**
 * Create radial glow texture
 */
function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 200, 100, 1.0)');
    gradient.addColorStop(0.2, 'rgba(255, 120, 50, 0.8)');
    gradient.addColorStop(0.4, 'rgba(200, 50, 20, 0.4)');
    gradient.addColorStop(0.7, 'rgba(100, 20, 10, 0.15)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    return new THREE.CanvasTexture(canvas);
}

/**
 * Create lava-specific glow texture (larger, softer)
 */
function createLavaGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 180, 80, 1.0)');
    gradient.addColorStop(0.15, 'rgba(255, 100, 30, 0.9)');
    gradient.addColorStop(0.35, 'rgba(200, 50, 10, 0.5)');
    gradient.addColorStop(0.6, 'rgba(100, 20, 0, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    return new THREE.CanvasTexture(canvas);
}

/**
 * Place a molten obsidian shelf "pocket" at each level node within this chapter so
 * the node frames mid-frame on a platform instead of floating in void. Level-node
 * positions are sampled from the spline and converted to chapter-local space.
 * @param {THREE.Group} group chapter group
 * @param {object} uniforms shared uniforms
 * @param {THREE.Vector3} groupCenter world-space anchor the group is positioned at
 */
function createMoltenPockets(group, uniforms, groupCenter) {
    // Level nodes for chapter 1 fall roughly within t ∈ [0, 0.10] along the spline
    // (see odyssey-layout DEFAULT_LEVEL_POSITIONS_BY_ID). Sample those and keep the
    // ones whose local Y sits inside the chapter's framed corridor.
    const nodeTs = [0.0, 0.019, 0.037, 0.056, 0.074, 0.093];
    const pockets = [];
    nodeTs.forEach((t, i) => {
        const pt = getOdysseyPathPointAt(t);
        const local = new THREE.Vector3(
            pt.x - groupCenter.x,
            pt.y - groupCenter.y,
            pt.z - groupCenter.z,
        );
        const size = 5 + (i % 3) * 1.5;
        const { mesh } = createMoltenPocketTSL(
            uniforms.uTime,
            uniforms.uPulseIntensity,
            size,
            uniforms.uBakedBounce,
        );
        // Seat the shelf as a LEDGE clearly to one side of and below the node. The side
        // offset (1.35×) exceeds the shelf radius, so the shelf never crosses the on-path
        // x≈0 line — the glowing path tube passes cleanly past it instead of skewering it.
        const sideSign = i % 2 === 0 ? 1 : -1;
        const shelfX = local.x + sideSign * (size * 1.35);
        const shelfY = local.y - size * 0.7;
        mesh.position.set(shelfX, shelfY, local.z);
        mesh.rotation.y = (i * 1.31) % TAU;
        mesh.name = `molten-pocket-${i}`;
        mesh.frustumCulled = false;
        group.add(mesh);
        pockets.push(mesh);

        // §5.1 contact-shadow AO decal nested on/under the shelf so the node reads as
        // resting on a grounded ledge, not floating.
        const decal = createContactShadowDecalTSL(size * 2.4);
        decal.mesh.position.set(shelfX, shelfY - size * 0.18, local.z);
        decal.mesh.frustumCulled = false;
        group.add(decal.mesh);
    });
    group.userData.pockets = pockets;
}

/**
 * PERF (QW9): the per-cluster magma-bounce PointLights (up to ~8) are REMOVED. WebGPU
 * forward lighting iterates every active light per lit fragment, and these lights only
 * washed the dark rock material (geodes themselves are unlit MeshBasic). Their warm
 * bounce now lives as a baked emissive/color floor on the molten-pocket/column material
 * (driven by `uniforms.uBakedBounce`), so the cavern still reads as a populated, warmly
 * lit space without the per-fragment light loop.
 *
 * The function and its `group.userData.bounceLights` key are preserved (now an empty
 * array) so the create flow + the update loop + any external reads stay compatible.
 * @param {THREE.Group} group chapter group
 * @param {object} elements element store containing rockClusters (unused; kept for API)
 */
// eslint-disable-next-line no-unused-vars
function addMagmaSphereBounceLights(group, elements) {
    group.userData.bounceLights = [];
}

/**
 * Setup enhanced volcanic lighting
 */
function setupVolcanicLighting(group) {
    // PERF (QW9): Earth Core is the OPENING chapter and was running up to ~14 PointLights
    // (lava key + glow + 4 crater accents + ≤8 magma-bounce). WebGPU forward lighting
    // loops EVERY active light per lit fragment, so the cost scaled with the count. The
    // only LIT surfaces here are the molten-pocket shelves + obsidian columns
    // (MeshStandardNodeMaterial); everything else is unlit MeshBasic. We keep just the
    // TWO key lights (lava key + one glow) and BAKE the removed accent/bounce warm fill
    // into that material's emissive/color floor (uBakedBounce) so the look holds with
    // ~10 fewer per-fragment light iterations.

    // Warm ambient — lifted 0.10→0.14 to recover a little of the global fill the four
    // accent lights gave the dark rock, while keeping the ~70% near-black value target.
    const ambient = new THREE.AmbientLight(0x0f0b18, 0.14); // cool-purple ambient light for cooler shadows (changed from warm 0x1a0600)
    group.add(ambient);
    group.userData.ambient = ambient;

    // KEY 1 — Central lava lake point light (main light source) — range 220→150 so the
    // light pools on the lake and the surrounding vault falls dark.
    const lavaLight = new THREE.PointLight(0xff5511, 2.9, 150);
    lavaLight.position.set(0, LAVA_LAKE_Y + 4, 0); // just above the lake
    group.add(lavaLight);
    group.userData.lavaLight = lavaLight;

    // KEY 2 — Secondary lava glow (softer, larger radius) — also absorbs the warm tint
    // the cut crater accents contributed, lifted 1.35→1.55.
    const lavaGlow = new THREE.PointLight(0xff7722, 1.55, 220);
    lavaGlow.position.set(0, LAVA_LAKE_Y + 2, 0);
    group.add(lavaGlow);
    group.userData.lavaGlow = lavaGlow;

    // The 4 crater-accent PointLights are removed (baked into uBakedBounce). Keep the
    // userData key as an empty array so the update loop + any external reads stay safe.
    group.userData.accentLights = [];
}

/**
 * Update Earth Core environment animations.
 * `camera` is part of the ChapterEnvironmentManager update contract (kept for API
 * parity); `cameraProgress` drives the descent uniform (0 vault-top → 1 at the lake).
 */
// eslint-disable-next-line no-unused-vars, max-len
export function updateEarthCoreEnvironment(group, delta, time, camera = null, cameraProgress = null, directorState = null) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // Descent drama — map the GLOBAL camera progress to this chapter's local 0→1 so the
    // lava lake + lava-fall emission intensify as the camera falls toward the lake.
    if (uniforms?.uDescent && cameraProgress != null) {
        const tStart = group.userData.chapterTStart ?? 0;
        const tEnd = group.userData.chapterTEnd ?? 0.125;
        const span = Math.max(tEnd - tStart, 1e-4);
        const local = THREE.MathUtils.clamp((cameraProgress - tStart) / span, 0, 1);
        uniforms.uDescent.value = local;
    }

    if (uniforms?.uPulseIntensity) {
        const audioPulse = directorState
            ? THREE.MathUtils.clamp((directorState.bass || 0) * 0.7 + (directorState.energy || 0) * 0.3, 0, 1)
            : 0;
        uniforms.uPulseIntensity.value = Math.max(
            uniforms.uPulseIntensity.value * Math.exp(-Math.max(0, delta) * 3.2),
            audioPulse,
        );
    }

    // Animate lava lake glow sprites (shrunk: scales 120/70 for the value hierarchy).
    const { lavaFloor } = group.userData;
    if (lavaFloor?.userData.glows) {
        const pulse = 1 + Math.sin(time * 1.2) * 0.15;
        const baseScales = [120, 70];
        lavaFloor.userData.glows.forEach((sprite, i) => {
            sprite.scale.setScalar((baseScales[i] ?? baseScales[0]) * pulse);
        });
    }

    // Animate lava lights
    const { lavaLight } = group.userData;
    if (lavaLight) {
        lavaLight.intensity = 4 + Math.sin(time * 2.5) * 1 + Math.sin(time * 4.3) * 0.5;
    }

    const { lavaGlow } = group.userData;
    if (lavaGlow) {
        lavaGlow.intensity = 2 + Math.sin(time * 1.8) * 0.5;
    }

    // Animate accent lights with flickering
    const { accentLights } = group.userData;
    if (accentLights) {
        accentLights.forEach((light, i) => {
            const flicker = Math.sin(time * 3 + i * 1.5) * 0.3
                + Math.sin(time * 7 + i * 2.5) * 0.15;
            light.intensity = 1.2 + flicker;
        });
    }

    // Flicker the magma-sphere bounce lights so the populated cavern feels alive.
    const { bounceLights } = group.userData;
    if (bounceLights) {
        bounceLights.forEach((light, i) => {
            const flicker = Math.sin(time * 2.4 + i * 1.7) * 0.18
                + Math.sin(time * 5.7 + i * 0.9) * 0.1;
            light.intensity = 0.55 + flicker;
        });
    }

    // Slow rotation of the (now sparse, distant) background geodes.
    const { elements } = group.userData;
    if (elements?.rockClusters) {
        elements.rockClusters.forEach((cluster, i) => {
            cluster.rotation.y += delta * 0.03 * ((i % 2) * 2 - 1);

            // Pulse the single dim corona glow sprite.
            if (cluster.userData.glows) {
                const pulse = 1 + Math.sin(time * 2 + i * 0.5) * 0.15;
                const baseScale = cluster.userData.size * 3;
                cluster.userData.glows.forEach((sprite) => {
                    sprite.scale.setScalar(baseScale * pulse);
                });
            }
        });
    }
}

export default {
    config: EARTH_CORE_CONFIG,
    create: createEarthCoreEnvironment,
    update: updateEarthCoreEnvironment,
};
