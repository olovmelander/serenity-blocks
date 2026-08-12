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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
    createRockClusterMaterialTSL,
    createObsidianColumnTSL,
    createMagmaHorizonTSL,
    createMoltenHazeMaterialTSL,
    createMoltenPocketTSL,
    createMoltenPocketMaterialTSL,
    createContactShadowDecalTSL,
    createFirstHeartTSL,
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
const EARTH_CORE_WORLD_UP = new THREE.Vector3(0, 1, 0);
const EARTH_CORE_FALLBACK_FORWARD = new THREE.Vector3(0, 0, 1);

function createEarthCoreStaging(groupCenter, localT) {
    const sample = (ft) => {
        const p = getOdysseyPathPointAt(localT(THREE.MathUtils.clamp(ft, 0, 1)));
        return new THREE.Vector3(
            p.x - groupCenter.x,
            p.y - groupCenter.y,
            p.z - groupCenter.z,
        );
    };

    const frame = (ft) => {
        const center = sample(ft);
        const ahead = sample(Math.min(1, ft + 0.06));
        const behind = sample(Math.max(0, ft - 0.06));
        const tangent = ahead.clone().sub(behind).normalize();
        const forward = new THREE.Vector3(tangent.x, 0, tangent.z);
        if (forward.lengthSq() < 1e-4) {
            forward.copy(EARTH_CORE_FALLBACK_FORWARD);
        } else {
            forward.normalize();
        }
        const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
        return {
            center,
            tangent,
            forward,
            right,
            up: EARTH_CORE_WORLD_UP,
        };
    };

    const at = (ft, {
        lateral = 0,
        forward = 0,
        up = 0,
    } = {}) => {
        const f = frame(ft);
        return f.center.clone()
            .addScaledVector(f.right, lateral)
            .addScaledVector(f.forward, forward)
            .addScaledVector(EARTH_CORE_WORLD_UP, up);
    };

    const lakeAt = (ft, {
        lateral = 0,
        forward = 0,
        lift = 0,
    } = {}) => {
        const p = at(ft, { lateral, forward });
        p.y = LAVA_LAKE_Y + lift;
        return p;
    };

    return {
        sample,
        frame,
        at,
        lakeAt,
        localT,
    };
}

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
function makeGlowSpriteMaterial(map, colorHex, opacity, uOpacity = null) {
    const material = new THREE.SpriteNodeMaterial();
    const sprite = texture(map, uv());
    material.colorNode = sprite.rgb.mul(vec3(new THREE.Color(colorHex)));
    material.opacityNode = uOpacity
        ? sprite.a.mul(opacity).mul(uOpacity)
        : sprite.a.mul(opacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    if (uOpacity) material.uniforms = { uOpacity }; // ecotone crossfade bridge
    return material;
}

/**
 * PERF (share-material): build ONE contact-shadow decal MESH from a SHARED decal
 * material. Every decal (column / geode / pocket) was its own createContactShadowDecalTSL
 * call — i.e. a distinct MeshBasicNodeMaterial node graph, hence a distinct cold-start
 * pipeline (~21). The decal material is constant (colorNode = uShadow, opacityNode =
 * pow(1-dist,2)·uOpacity from uv()) and is NEVER mutated per-mesh, so the node graph is
 * byte-identical across every site. Reusing one material across all decals collapses
 * those pipelines to ONE with zero pixel change: the per-mesh geometry size and transform
 * are unchanged (the opacity feather samples uv(), independent of the world size). The
 * geometry stays per-size — only the MATERIAL is shared, so draw order is identical.
 * @param {number} size flat plane edge (PlaneGeometry(size,size)) — unchanged per site
 * @param {THREE.Material} sharedMaterial the one shared decal material
 */
function makeSharedContactDecal(size, sharedMaterial) {
    const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
    geometry.rotateX(-Math.PI / 2); // lay flat on the lake/ledge (matches the TSL builder)
    const mesh = new THREE.Mesh(geometry, sharedMaterial);
    mesh.name = 'contact-shadow';
    mesh.renderOrder = 6; // after the lake, stable enough to read as contact AO
    return mesh;
}

/**
 * Volcanic smoke/ash — instanced billboards rising and expanding from the lava.
 * Mirrors the old smoke Points (position + aRandom/aSize/aSpeed), animated entirely
 * from uTime so the update loop is unchanged.
 */
function createVolcanicSmoke(uniforms, count, staging = null) {
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);
    const speeds = new Float32Array(count);

    const columns = staging
        ? [
            { point: staging.lakeAt(0.78, { lateral: 0, forward: 0 }), spread: 18 },
            { point: staging.lakeAt(0.30, { lateral: -14, forward: 5 }), spread: 15 },
            { point: staging.lakeAt(0.14, { lateral: 8, forward: 4 }), spread: 18 },
            { point: staging.lakeAt(0.58, { lateral: -24, forward: 10 }), spread: 22 },
        ].map((entry) => ({
            x: entry.point.x,
            z: entry.point.z,
            spread: entry.spread,
        }))
        : [
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
    // Seam: the ash whitens into rising STEAM as the waterline nears (1→2 Steam Quench).
    const smokeColor = smokeBase.add(lavaTint);
    material.colorNode = mix(smokeColor, vec3(0.32, 0.4, 0.44), uniforms.uSeam.mul(0.75));
    const glow = spriteGlowMask(0.72);
    const fadeIn = smoothstep(0.02, 0.16, lifeProgress);
    material.opacityNode = glow.mul(oneMinus(lifeProgress).mul(0.46).add(0.04))
        .mul(fadeIn)
        .mul(uniforms.uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;
    material.uniforms = { uOpacity: uniforms.uOpacity }; // ecotone crossfade bridge

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
    // Packed [phase, speed] per instance — one vec2 attribute instead of two floats, to
    // keep this billboard's WebGPU vertex-buffer count at 8 (the max) rather than 9.
    const twinkle = new Float32Array(count * 2);
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
        twinkle[i * 2] = Math.random() * TAU; // phase
        twinkle[i * 2 + 1] = 2 + Math.random() * 4; // speed
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
        aTwinkle: { array: twinkle, itemSize: 2 },
        aBrightness: { array: brightnesses, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aTwinkle = attribute('aTwinkle', 'vec2'); // x: phase, y: speed
    const aBrightness = attribute('aBrightness', 'float');
    const aColor = attribute('aColor', 'vec3');
    const { uTime, uPulseIntensity } = uniforms;

    const twinkleOsc = sin(uTime.mul(aTwinkle.y).add(aTwinkle.x)).mul(0.3).add(0.7);
    const brightness = aBrightness.mul(twinkleOsc).mul(uPulseIntensity.mul(0.5).add(1.0));

    const worldSize = aSize.mul(uPulseIntensity.mul(0.3).add(1.0)).mul(0.16);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(aBase, worldSize);
    // Soft glow with a hot white core (smoothstep on dist).
    const p = uv().sub(0.5);
    const dist = p.length().mul(2.0);
    const glow = pow(clamp(oneMinus(dist), 0.0, 1.0), 1.5);
    const core = smoothstep(0.2, 0.0, dist.mul(0.5));
    const hotColor = mix(aColor, vec3(1.0, 0.95, 0.85), core.mul(0.5));
    const steamColor = vec3(0.72, 0.88, 0.95).mul(glow).mul(brightness.mul(0.72));
    material.colorNode = mix(hotColor.mul(glow).mul(brightness), steamColor, uniforms.uSeam.mul(0.92));
    material.opacityNode = glow.mul(brightness).mul(uniforms.uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity: uniforms.uOpacity }; // ecotone crossfade bridge

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
function createRisingEmbers(uniforms, count, staging = null) {
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);

    // Column centres: lava-fall splash, node-shelf clusters, and side smoke banks.
    const columns = staging
        ? [
            { point: staging.lakeAt(0.78, { lateral: 0, forward: 0 }), spread: 14 },
            { point: staging.lakeAt(0.28, { lateral: -14, forward: 4 }), spread: 11 },
            { point: staging.lakeAt(0.12, { lateral: 8, forward: 3 }), spread: 12 },
            { point: staging.lakeAt(0.56, { lateral: -22, forward: 8 }), spread: 16 },
        ].map((entry) => ({
            x: entry.point.x,
            z: entry.point.z,
            spread: entry.spread,
        }))
        : [
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
    // Seam: the ember columns thin and WHITEN into rising steam (1→2 Steam Quench).
    const steamColor = vec3(0.72, 0.86, 0.9).mul(glow).mul(0.55);
    material.colorNode = mix(hotColor.mul(glow), steamColor, uniforms.uSeam.mul(0.85));
    material.opacityNode = glow.mul(alpha)
        .mul(oneMinus(uniforms.uSeam.mul(0.35)))
        .mul(uniforms.uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity: uniforms.uOpacity }; // ecotone crossfade bridge

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

    // Seam: near sparks whiten into steam flecks with the rest of the quench.
    const steamSpark = vec3(0.75, 0.88, 0.92).mul(glow).mul(0.6);
    material.colorNode = mix(hotColor.mul(glow), steamSpark, uniforms.uSeam.mul(0.85));
    material.opacityNode = glow.mul(life.mul(0.7).add(0.3))
        .mul(oneMinus(uniforms.uSeam.mul(0.3)))
        .mul(uniforms.uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true; // brightest near sparks bloom (capped by glow)
    material.uniforms = { uOpacity: uniforms.uOpacity }; // ecotone crossfade bridge

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
        // WAVE 3b: haze puff half-extent cut ~30% — the haze is a near-camera additive
        // layer whose cost is pure fill; smaller puffs, same count, same motion.
        sizes[i] = (11 + Math.random() * 16) * (1.0 - yT * 0.45);
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSeed: { array: seeds, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
    });

    const { material } = createMoltenHazeMaterialTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        { uOpacity: uniforms.uOpacity },
    );
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
        // WAVE 3b: deck puffs 28-92u -> 18-60u. After the count cut the deck was still the
        // largest per-puff fill in the chapter; area scales with the square of this number.
        sizes[i] = 18 + Math.random() * 42;

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
    material.opacityNode = sprite.a.mul(0.18)
        .mul(sin(driftT.mul(0.5)).mul(0.12).add(0.88))
        .mul(uniforms.uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;
    material.uniforms = { uOpacity: uniforms.uOpacity }; // ecotone crossfade bridge

    const deck = new THREE.Mesh(geometry, material);
    deck.name = 'magma-cloud-deck';
    deck.frustumCulled = false;
    deck.renderOrder = -88;
    deck.userData.ownedTexture = cloudMap; // OD-11: TSL-node-bound, surfaced for eviction disposal
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
    const chapterAnchorY = chapterRange?.start.y ?? chapterCenterY;
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
        // Seam choreography (0 until ~86% of the chapter, 1 at the 1→2 boundary):
        // drives the lake-vein quench, ember→steam shift, geode sink-and-fade, and the
        // First Heart's blackbody walk-down. Chapter-authored, distinct from uOpacity.
        uSeam: uniform(0),
        // Manager-driven ecotone crossfade bridge: every fading material multiplies its
        // opacityNode by this ONE shared uniform and exposes it via material.uniforms,
        // so _collectOpacityTargets reaches TSL materials (fixes the 16→17 confetti pop
        // and the magma assets bleeding into frames 17–19).
        uOpacity: uniform(1),
        // PERF (QW9): baked-bounce strength for the lit rock material. The 4 crater
        // accents + per-cluster magma-bounce PointLights were cut; this drives a baked
        // warm emissive floor on the molten-pocket/column material so the rock still
        // reads as warm-lit without per-fragment light loops. 1 = full bake (the look
        // the removed lights produced); a future adaptive controller can dial it.
        uBakedBounce: uniform(1),
    };
    group.userData.uniforms = uniforms;

    // OD-11: TSL-node-bound textures (bound only via texture() nodes, never as material
    // .map / uniform .value) are invisible to the traverse in _freeEnvironmentResources,
    // so they leak on chapter eviction. Sub-factories surface each on their carrier's
    // userData.ownedTexture; a sweep near the end of the builder collects them (deduped)
    // into this array, which eviction disposes. clusterGlowTexture is pushed directly.
    group.userData.ownedTextures = [];

    // Storage for elements
    const elements = {
        rockClusters: [],
        moltenPockets: [],
        filaments: [],
        seamBoulders: [],
    };
    group.userData.elements = elements;

    // PERF (share-material): build ONE contact-shadow decal material reused by every
    // column / geode / molten-pocket decal below. Each createContactShadowDecalTSL call
    // was a distinct pipeline (~21 cold-start compiles); the decal material is a constant
    // node graph (uShadow color + uv()-feathered opacity·uOpacity), never mutated per
    // mesh, so one shared material renders every decal pixel-identically. (The mesh
    // geometry stays per-size; only the material is shared — draw order is unchanged.)
    const sharedDecalMaterial = createContactShadowDecalTSL(1, uniforms.uOpacity).material;

    // PERF (share-material): build ONE lava-fall material + geometry reused by the two
    // crossed hero planes AND every cluster tether-stream. All createLavaFallTSL call
    // sites use byte-identical args (uTime/uPulseIntensity/uDescent/uOpacity) and the
    // identical PlaneGeometry(96,220), and the material carries NO positionNode and is
    // never mutated per mesh (only per-mesh transform / group .visible vary), so reuse is
    // pixel-identical and collapses up to ~4 lava-fall pipelines to one.
    const sharedLavaFall = createLavaFallTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        uniforms.uDescent,
        { uOpacity: uniforms.uOpacity },
    );

    // PERF (share-material): ONE dim corona-glow sprite material for every geode cluster.
    // Each cluster built its own makeGlowSpriteMaterial(0xff5a14, 0.055) SpriteNodeMaterial
    // (identical args → identical node graph → a redundant pipeline per cluster). The
    // material is never mutated per sprite (update() only sets sprite.scale, a transform),
    // so sharing it across all clusters is pixel-identical.
    const clusterGlowTexture = createGlowTexture();
    group.userData.ownedTextures.push(clusterGlowTexture); // OD-11: TSL-node-bound, register for eviction disposal
    const sharedClusterGlowMaterial = makeGlowSpriteMaterial(clusterGlowTexture, 0xff5a14, 0.055, uniforms.uOpacity);

    // The chapter group is anchored at the path centre; derive the corridor's
    // local-space frame EARLY so the lake basins, colonnade walls, geode chapel, and
    // the First Heart all line up with the spline the camera follows.
    const groupCenter = chapterRange?.center
        ? new THREE.Vector3(chapterRange.center.x, chapterAnchorY, chapterRange.center.z)
        : new THREE.Vector3(0, chapterAnchorY, 0);
    const corridorLow = (chapterRange ? chapterRange.start.y - groupCenter.y : -77) - 5;
    const corridorHigh = (chapterRange ? chapterRange.end.y - groupCenter.y : 77) + 20;
    const [chapterTStart, chapterTEnd] = getActiveOdysseyChapterPositions();
    const localT = (ft) => THREE.MathUtils.lerp(chapterTStart ?? 0, chapterTEnd ?? 0.125, ft);
    const staging = createEarthCoreStaging(groupCenter, localT);
    group.userData.stagingFrames = Array.from({ length: 19 }, (_, i) => ({
        frame: i + 1,
        global: Number((i * 0.005).toFixed(3)),
        local: Number((i * 0.005 / Math.max((chapterTEnd ?? 0.125) - (chapterTStart ?? 0), 1e-4)).toFixed(3)),
    }));

    // 1. Create background sphere (enhanced with lava glow)
    const background = createVolcanoBackground(uniforms);
    group.add(background);
    const magmaCloudCanopy = createMagmaCloudCanopyTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        { uOpacity: uniforms.uOpacity },
    );
    group.add(magmaCloudCanopy.mesh);
    group.userData.magmaCloudCanopy = magmaCloudCanopy.mesh;

    // 2. Create animated lava floor - THE MAIN FEATURE. The molten BASINS (plan:
    // legacy-floor revival) are sampled from the path so the "lava surf" beats sit
    // under the camera corridor: one at the entry breach, one under the mid-chapter
    // beat, one on the final approach.
    const basins = [0.05, 0.42, 0.8].map((ft, i) => {
        const pt = staging.lakeAt(ft, { forward: [2, 4, 6][i] });
        return {
            x: THREE.MathUtils.clamp(pt.x, -150, 150),
            z: THREE.MathUtils.clamp(pt.z, -150, 150),
            r: [30, 38, 34][i],
        };
    });
    const lavaFloor = createLavaFloor(uniforms, basins);
    group.add(lavaFloor);
    group.userData.lavaFloor = lavaFloor;

    // 3. Create volcanic crater rim - VOLUMETRIC PARTICLE SYSTEM
    const craterRim = createParticleCraterRim(uniforms);
    group.add(craterRim);

    // 4. Geode CLUSTERS (plan item 4): small/medium/large grading with satellites and
    // tether-streams replaces the old two-sphere repetition. Cap raised 2→6 under the
    // quality-preset budget; every seat is pushed clear of the spline (frame-07 fix).
    const clusterCount = Math.min(options.particleCount ? Math.floor(options.particleCount / 110) : 5, 6);
    createVolcanicRockClusters(group, uniforms, elements, clusterCount, groupCenter, staging, {
        sharedDecalMaterial,
        sharedLavaFall,
        sharedClusterGlowMaterial,
    });

    // 5. Ember STARS as background sparkle — cut 6000→1200, radius pulled to 25–60 so
    //    they read as a sparse depth field, not an orange soup.
    const starCount = Math.floor(options.particleCount ? Math.min(options.particleCount * 2.8, 1050) : 900);
    const stars = createEmberStars(uniforms, starCount);
    group.add(stars);
    group.userData.stars = stars;

    // 6. Rising ember particles re-aimed into a few rising COLUMNS (ember-storm) rather
    //    than an even ring, clustered at the lava-fall splash + node shelves.
    const risingEmbers = createRisingEmbers(uniforms, 570, staging);
    group.add(risingEmbers);
    group.userData.risingEmbers = risingEmbers;

    // 7. Create volcanic smoke/ash particles (trimmed 300→200 for the value cuts).
    const smoke = createVolcanicSmoke(uniforms, 200, staging);
    group.add(smoke);
    group.userData.smoke = smoke;

    // 8. Magma horizon — §3.1: the 3 bands now read as the lake's FAR SHORE, aligned so
    //    their bright rim line sits at the lake surface (LAVA_LAKE_Y) instead of floating
    //    mid-air. The magma-horizon's bright rim is at uv.y≈0.32 of a 200-unit plane, so
    //    a band whose rim aligns to the lake has centerY = LAVA_LAKE_Y + 36*scaleY. This
    //    turns the bands into a continuous far-shore line under the assets.
    // WAVE 3b — deck density 140 -> 56: the deck is the second-largest additive fill layer
    // after the canopy (140 sizeable billboard puffs overhead), and the canopy already owns
    // the vault reading after 3a. Fewer, unchanged puffs keeps the broken-cloud look; count
    // is the fill lever that does not change any per-puff appearance.
    const cloudDeckCount = Math.min(options.particleCount ? Math.floor(options.particleCount * 0.4) : 56, 56);
    const magmaCloudDeck = createMagmaCloudDeck(uniforms, cloudDeckCount, corridorHigh);
    group.add(magmaCloudDeck);
    group.userData.magmaCloudDeck = magmaCloudDeck;
    const horizonRimY = (scaleY) => LAVA_LAKE_Y + 36 * scaleY; // align rim to lake surface
    const farHorizon = createMagmaHorizonTSL(uniforms.uTime, uniforms.uPulseIntensity, { uOpacity: uniforms.uOpacity });
    const farHorizonPos = staging.at(0.86, { lateral: 0, forward: 20 });
    farHorizon.mesh.position.set(farHorizonPos.x, horizonRimY(1), farHorizonPos.z);
    group.add(farHorizon.mesh);
    // Reuse the far-horizon material + geometry for the low/mid bands: the additive graph is
    // byte-identical (same uniforms) and only the transform differs, so 3 magma-horizon
    // pipelines collapse to 1 (cold-start compile win, zero visual change — the bands are
    // static, never mutated per-material in update()).
    // WAVE 3b — the low/mid horizon DUPES are deleted, not merged. They were two additional
    // full-width additive planes stacked in front of the same far-shore line: measured
    // fill-bound on Lane B (57-58 ms flat across 131->84 draws), full-frame transparent
    // layers are exactly the spend, and the far shore still reads from the one farHorizon
    // band. Their pipeline had already been collapsed into farHorizon's material, so the
    // compile cost was never theirs — only the fill was.
    group.userData.horizons = [farHorizon.mesh];

    // 9. Molten volumetric haze hugging the path along the whole corridor span.
    // WAVE 3b: haze 225 -> 112. Near-camera additive billboards are the textbook iGPU fill
    // spend (the Cosmic Noir lesson), and the haze hugs the rail — always at the lens. Half
    // the count with the already-shrunk puffs keeps the smoke reading; the removed half was
    // overlapping coverage, not visible structure.
    const hazeCount = Math.floor(options.particleCount ? Math.min(options.particleCount * 0.9, 128) : 112);
    const haze = createMoltenHaze(uniforms, hazeCount, corridorLow, corridorHigh);
    group.add(haze);
    group.userData.haze = haze;

    // 10. Molten "pockets" — a small obsidian shelf at each level node within this
    //     chapter so nodes frame mid-frame on a platform instead of floating in void.
    const moltenPockets = createMoltenPockets(group, uniforms, groupCenter, sharedDecalMaterial);
    elements.moltenPockets.push(...moltenPockets);
    elements.seamBoulders.push(...moltenPockets);

    // 11. LAVA-FALL hero — staged as the chapter landmark, not another orange strip.
    // Two crossed planes form one volumetric fall so it reads from the moving camera,
    // seated into a horizontal splash decal on the lifted lake.
    const fallStation = 0.72;
    const fallFrame = staging.frame(fallStation);
    const fallBase = staging.lakeAt(fallStation, { lateral: 8, forward: 10 });
    const fallScale = 0.28;
    const fallHeight = 220 * fallScale;
    const lavaFallGroup = new THREE.Group();
    lavaFallGroup.name = 'lava-fall-hero';

    // The hero plane IS the pre-built sharedLavaFall mesh; the crossed plane reuses its
    // material + geometry (share-material: only transform/rotation differ, no positionNode,
    // never mutated per mesh — the group toggles .visible, the material animates via shared
    // uniforms). Two lava-fall pipelines collapse to one.
    const lavaFall = sharedLavaFall;
    lavaFall.mesh.scale.set(fallScale, fallScale, 1);
    lavaFall.mesh.position.set(0, fallHeight * 0.5, 0);
    lavaFall.mesh.renderOrder = -4;
    lavaFallGroup.add(lavaFall.mesh);

    const lavaFallCrossMesh = new THREE.Mesh(sharedLavaFall.geometry, sharedLavaFall.material);
    lavaFallCrossMesh.name = 'lava-fall';
    lavaFallCrossMesh.scale.set(fallScale * 0.52, fallScale, 1);
    lavaFallCrossMesh.position.set(0, fallHeight * 0.5, 0);
    lavaFallCrossMesh.rotation.y = Math.PI / 2;
    lavaFallCrossMesh.renderOrder = -4;
    lavaFallGroup.add(lavaFallCrossMesh);

    lavaFallGroup.position.copy(fallBase);
    lavaFallGroup.rotation.y = Math.atan2(fallFrame.forward.x, fallFrame.forward.z);
    lavaFallGroup.visible = false;
    group.add(lavaFallGroup);
    group.userData.lavaFall = lavaFallGroup;

    const fallSplash = createLavaSplashDecal(72, 34, 0.44);
    fallSplash.position.set(fallBase.x, LAVA_LAKE_Y + 0.55, fallBase.z);
    fallSplash.rotation.z = -0.18;
    fallSplash.visible = false;
    group.add(fallSplash);
    group.userData.lavaFallSplash = fallSplash;

    // 12. God-ray shafts — 3–4 large low-opacity vertical cones above the lake, biased
    //     toward the lava-fall splash so the ember-storm reads as rising through light.
    const godRayConfigs = [
        { pos: staging.lakeAt(fallStation, { lateral: 0, forward: 0 }), scale: 1.15 },
        { pos: staging.lakeAt(0.42, { lateral: -18, forward: 8 }), scale: 1.0 },
        { pos: staging.lakeAt(0.62, { lateral: 14, forward: 10 }), scale: 1.4 },
        { pos: staging.lakeAt(0.18, { lateral: -8, forward: 5 }), scale: 0.9 },
    ];
    // Build the god-ray cone material + geometry ONCE and reuse across all 4 shafts: the
    // additive graph is identical and only the transform / per-mesh visibility differ (the
    // lava-fall shaft toggles .visible, never its material), so 4 god-ray pipelines collapse
    // to 1 (cold-start compile win, zero visual change).
    const sharedGodRay = createGodRayConeTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        { uOpacity: uniforms.uOpacity },
    );
    const godRays = godRayConfigs.map((cfg, index) => {
        const mesh = index === 0
            ? sharedGodRay.mesh
            : new THREE.Mesh(sharedGodRay.geometry, sharedGodRay.material);
        mesh.position.set(cfg.pos.x, LAVA_LAKE_Y + 60, cfg.pos.z);
        mesh.scale.set(cfg.scale, cfg.scale * 1.1, cfg.scale);
        mesh.frustumCulled = false;
        group.add(mesh);
        return mesh;
    });
    group.userData.godRays = godRays;
    // WAVE 6 — THE CRACK PRE-SEED, through geometry that already exists. The light-language
    // flip (warm key below -> cool key above) must START before the quench so the veil is a
    // flash, not a hue cut. Rather than new shaft cards, the chapter's own god-ray cones walk
    // their tint from ember toward the quench's cool vapour as the seam engages: zero new
    // draws, zero new materials, and the colour comes from the shipped STEAM_COOL so the
    // pre-seed and the occluder cannot drift apart.
    group.userData.godRayTint = {
        uniform: sharedGodRay.material.userData.uniforms.uTint,
        warm: new THREE.Color(0xff8a2e),
        cool: new THREE.Color(0x9fc4d8), // STEAM_COOL pulled toward steel so it stays a HINT
        scratch: new THREE.Color(),
    };
    group.userData.lavaFallRevealables = [lavaFallGroup, fallSplash, godRays[0]];

    // 12b. THE FIRST HEART — the chapter's hero / destination landmark (plan item 1):
    // a white-hot caldera fissure seated past the chapter's end, dead on the rail's
    // vanishing line, visible from frame 01 and growing across the whole descent. The
    // white-hot #ffe6b0 tier belongs to it exclusively (palette law).
    const heart = createFirstHeartTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        uniforms.uDescent,
        { uSeam: uniforms.uSeam, uOpacity: uniforms.uOpacity },
    );
    heart.mesh.position.copy(staging.at(1.0, { lateral: 0, forward: 86, up: 42 }));
    const heartBaseScale = 6;
    heart.mesh.scale.set(heartBaseScale, heartBaseScale, 1);
    group.add(heart.mesh);
    group.userData.firstHeart = heart.mesh;
    group.userData.firstHeartBaseScale = heartBaseScale;

    // Ch1 BOOT-WARP saver: ONE shared isColumn=true molten material for the colonnade walls, the
    // selenite chamber shell, the obsidian columns AND the ceiling slabs — all byte-identical (only
    // geometry/transform differ; uniforms are shared/constant), so the chapter's heaviest graph
    // (moltenRockField, ~28 snoise3/frag) compiles ONCE at boot instead of once per site. Those
    // duplicate cold pipeline compiles (~2.7s each) were a root of the boot-warp BeginFrame-
    // starvation freeze. Same pattern the chapter already uses for the decal/god-ray/horizon mats.
    const sharedColumnMaterial = createMoltenPocketMaterialTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        uniforms.uBakedBounce,
        true,
    ).material;

    // 12c. Basalt colonnade WALLS (plan asset 3): 6–8 clustered hex-column groups per
    // side, 55–90 units off-path, size-graded 60→160, continuous along the corridor —
    // the cavern walls that fix the 08–13 emptiness. ONE merged geometry / draw call
    // (Fingal's Cave colonnade grammar; respects the <100 draw-call budget).
    const colonnade = createColonnadeWalls(uniforms, staging, sharedColumnMaterial);
    group.add(colonnade);
    group.userData.colonnade = colonnade;

    // 12d. Selenite geode CHAPEL (plan asset 4) — the mid-chapter beat filling the
    // 08–11 dead zone: translucent crystal beams off the right of the rail, backlit by
    // a molten pocket beneath, framed by a dark basalt shell.
    createSeleniteChamber(group, uniforms, staging, sharedColumnMaterial);

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
    const columnStations = [0.14, 0.42, 0.70, 0.86];
    columnStations.forEach((ftLocal, bi) => {
        const left = staging.lakeAt(ftLocal, {
            lateral: -(22 + bi * 3.5),
            forward: bi % 2 === 0 ? 2 : 7,
        });
        const right = staging.lakeAt(ftLocal, {
            lateral: 24 + bi * 4,
            forward: bi % 2 === 0 ? 8 : 1,
        });
        columnSpecs.push({
            x: left.x,
            z: left.z,
            r: 6.8 + bi * 0.7,
            h: bi === 1 ? 142 : 96 + bi * 8,
            giant: bi === 1,
        });
        columnSpecs.push({
            x: right.x,
            z: right.z,
            r: 7.2 + bi * 0.65,
            h: bi === 0 ? 132 : 98 + bi * 6,
            giant: bi === 0,
        });
    });
    // One far filler only: depth cue without re-cluttering the middle of the screen.
    const fillerColumn = staging.lakeAt(0.78, { lateral: -34, forward: 16 });
    columnSpecs.push({
        x: fillerColumn.x, z: fillerColumn.z, r: 7.5, h: 112, giant: false,
    });

    // Columns + ceiling slabs reuse the hoisted sharedColumnMaterial (built above so the colonnade
    // + selenite shell share it too) — the isColumn=true graph compiles once for the whole chapter.

    const columns = columnSpecs.map((spec) => {
        const col = createObsidianColumnTSL(
            uniforms.uTime,
            uniforms.uPulseIntensity,
            spec.r,
            spec.h,
            uniforms.uBakedBounce,
            sharedColumnMaterial,
        );
        // Seat the BASE at the lake surface (center = lake + h/2) so the column rises out
        // of the lake instead of passing half through it.
        col.mesh.position.set(spec.x, LAVA_LAKE_Y + spec.h * 0.5, spec.z);
        col.mesh.frustumCulled = false;
        group.add(col.mesh);

        // §5.1 contact-shadow AO decal at the lake line under the column base.
        // (share-material: per-size geometry + the ONE shared decal material.)
        const decalMesh = makeSharedContactDecal(spec.r * 3.2, sharedDecalMaterial);
        decalMesh.position.set(spec.x, LAVA_LAKE_Y + 0.4, spec.z);
        decalMesh.frustumCulled = false;
        group.add(decalMesh);
        return col.mesh;
    });
    group.userData.columns = columns;

    // 13b. OPPRESSIVE walls/ceiling (§3.3) — a few large near-black slabs pressing the
    //      top of the corridor so the camera falls THROUGH a tight cathedral. Reuse the
    //      obsidian-column builder as wide, short, ceiling-hung slabs near-frame top. No
    //      contact decal (they hang from the ceiling, not the lake).
    const ceilingSpecs = [
        {
            pos: staging.at(0.34, { lateral: -28, forward: 10, up: 0 }),
            r: 14,
            h: 22,
        },
        {
            pos: staging.at(0.72, { lateral: 30, forward: 14, up: 0 }),
            r: 16,
            h: 24,
        },
    ];
    const ceilingSlabs = ceilingSpecs.map((spec) => {
        const slab = createObsidianColumnTSL(
            uniforms.uTime,
            uniforms.uPulseIntensity,
            spec.r,
            spec.h,
            uniforms.uBakedBounce,
            sharedColumnMaterial,
        );
        // Hang from the top of the corridor (well above the lake), inverted so the wide
        // end reads as a ceiling vault pressing down.
        slab.mesh.position.set(spec.pos.x, corridorHigh - spec.h * 0.4, spec.pos.z);
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
    group.userData.visibilityTargets = {
        firstHeart: group.userData.firstHeart,
        lavaFall: group.userData.lavaFall,
        seleniteChapel: group.userData.seleniteChamber,
        geodeClusters: elements.rockClusters,
        seamBoulders: elements.seamBoulders,
    };

    // Position the environment: X/Z stay centered on the chapter, but Y is anchored to
    // the chapter ENTRY. The fixed Odyssey camera starts near the first node; anchoring
    // the lava lake to the chapter midpoint put the lake and column bases ~70 units above
    // frame 01, so the player saw undersides instead of the lake.
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterAnchorY, chapterRange.center.z);
    } else {
        group.position.y = chapterAnchorY;
    }

    // OD-11: sweep the graph and collect every sub-factory's surfaced userData.ownedTexture
    // (deduped) into the chapter root's ownedTextures. These are TSL-node-bound canvas
    // textures the material/uniform traverse in _freeEnvironmentResources cannot see, so
    // eviction only frees them if they are registered here. (clusterGlowTexture was pushed
    // directly at its creation site; the shared lava-glow texture is added once.)
    group.traverse((o) => {
        const tex = o.userData?.ownedTexture;
        if (tex && tex.isTexture && !group.userData.ownedTextures.includes(tex)) {
            group.userData.ownedTextures.push(tex);
        }
    });

    // ── WAVE 3b: MERGE THE CONTACT-SHADOW DECALS — 20 draws → 1, provably safe ──
    // The Wave 3b inventory counted 20 'contact-shadow' meshes: the single largest drawable
    // family in the chapter. They already share ONE material (the pipeline collapse above),
    // every one is parented directly to the group with a static transform, and the material
    // reads only uv() — no positionLocal-dependent shading — so baking each mesh's transform
    // into its geometry and merging is pixel-identical by construction. (The columns and
    // molten pockets are NOT merged for exactly the inverse reason: their shading is driven
    // by positionLocal, which a bake would redefine.)
    {
        const decals = [];
        group.children.forEach((child) => {
            if (child.name === 'contact-shadow') decals.push(child);
        });
        if (decals.length > 1) {
            const baked = decals.map((mesh) => {
                mesh.updateMatrix();
                const geo = mesh.geometry.clone();
                geo.applyMatrix4(mesh.matrix);
                return geo;
            });
            const mergedGeo = mergeGeometries(baked, false);
            baked.forEach((g) => g.dispose());
            if (mergedGeo) {
                decals.forEach((mesh) => {
                    group.remove(mesh);
                    mesh.geometry.dispose();
                });
                const mergedDecals = new THREE.Mesh(mergedGeo, decals[0].material);
                mergedDecals.name = 'contact-shadow';
                mergedDecals.renderOrder = 6;
                group.add(mergedDecals);
                group.userData.ownedGeometries = group.userData.ownedGeometries || [];
                group.userData.ownedGeometries.push(mergedGeo);
            }
        }
    }

    return group;
}

/**
 * Create the opaque molten LAVA LAKE - the centerpiece of the chapter. The wide,
 * lowered, low-displacement opaque lake the camera looks ACROSS (validated TSL
 * builder). Glow sprites are dimmed/shrunk for the value hierarchy (~70% dark rock).
 */
function createLavaFloor(uniforms, basins = []) {
    const group = new THREE.Group();
    group.name = 'lava-floor';

    // Main lava LAKE — wide (360 square), lifted (y=-10), opaque, NormalBlending lake the
    // camera looks across. The basin list revives the legacy floor's molten-sea reads
    // (rolling swells, #ffffaa vein cores, pulse-reactive hot spots) inside designated
    // pools only; uSeam quenches every vein silvery-blue→teal across the 1→2 boundary.
    const { mesh: lavaSurface } = createLavaLakeTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        uniforms.uDescent,
        { basins, uSeam: uniforms.uSeam },
    );
    group.add(lavaSurface);

    // Dim, shrunk glow layers beneath (value hierarchy: opacity 0.18/0.28 globally) —
    // the legacy 0.35/0.5 under-glow radiance returns only over the molten basins.
    const glowTexture = createLavaGlowTexture();

    const ambientGlow = new THREE.Sprite(
        makeGlowSpriteMaterial(glowTexture, 0xff4400, 0.18, uniforms.uOpacity),
    );
    ambientGlow.userData.baseScale = 120;
    ambientGlow.position.y = LAVA_LAKE_Y - 2;
    group.add(ambientGlow);

    const innerGlow = new THREE.Sprite(
        makeGlowSpriteMaterial(glowTexture, 0xffaa00, 0.28, uniforms.uOpacity),
    );
    innerGlow.userData.baseScale = 70;
    innerGlow.position.y = LAVA_LAKE_Y - 1;
    group.add(innerGlow);

    const glows = [ambientGlow, innerGlow];

    // Basin corona glows — the legacy radiance over each molten pool: a warm heat-haze
    // halo hovering just ABOVE the surface line (camera-facing, so it reads over the
    // opaque lake instead of being depth-culled beneath it).
    basins.forEach((basin) => {
        const basinGlow = new THREE.Sprite(
            makeGlowSpriteMaterial(glowTexture, 0xffb347, 0.34, uniforms.uOpacity),
        );
        basinGlow.userData.baseScale = basin.r * 2.2;
        basinGlow.position.set(basin.x, LAVA_LAKE_Y + 1.6, basin.z);
        group.add(basinGlow);
        glows.push(basinGlow);
    });

    glows.forEach((sprite) => {
        sprite.scale.set(sprite.userData.baseScale, sprite.userData.baseScale, 1);
    });

    group.userData.glows = glows;
    group.userData.surface = lavaSurface;
    // OD-11: ONE lava-glow texture is shared by every glow sprite here (all bound via
    // texture() nodes in makeGlowSpriteMaterial), so surface it once for eviction disposal.
    group.userData.ownedTexture = glowTexture;

    return group;
}

/**
 * Horizontal additive splash at the lava-fall impact point. This is deliberately a
 * single grounded decal, not another floating orb, so the hero reads as meeting the
 * lake surface.
 */
function createLavaSplashDecal(width = 80, depth = 36, opacity = 0.36) {
    const splashTexture = createLavaGlowTexture();
    const material = new THREE.MeshBasicMaterial({
        map: splashTexture,
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
function createParticleCraterRim(uniforms) {
    const group = new THREE.Group();
    group.name = 'crater-rim-particles';

    // 1. Generate Particle Data
    const particleCount = 300;
    const bases = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    // Base color: Deeper, richer volcanic tone (Less blown out)
    const baseColor = new THREE.Color(0x5a1208); // Deep charred red
    const glowColor = new THREE.Color(0xb83208); // Muted orange-red

    const radiusBase = 95;
    const tubeRadius = 14;

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

    // Keep the crater rim as distant haze, not camera-near magma boulders.
    const worldSize = float(5.5);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(aBase, worldSize);
    // Sample the soft cloud sprite; tint by per-particle color, fade at low opacity.
    const sprite = texture(cloudMap, uv());
    material.colorNode = aColor;
    material.opacityNode = sprite.a.mul(0.055).mul(uniforms.uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity: uniforms.uOpacity }; // ecotone crossfade bridge

    const particles = new THREE.Mesh(geometry, material);
    particles.name = 'crater-rim-cloud';
    particles.frustumCulled = false;
    group.add(particles);

    group.userData.ownedTexture = cloudMap; // OD-11: TSL-node-bound, surfaced for eviction disposal
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
function createVolcanicRockClusters(group, uniforms, elements, count, groupCenter, staging, shared = {}) {
    const { sharedDecalMaterial, sharedLavaFall, sharedClusterGlowMaterial } = shared;
    // SMALL/MEDIUM/LARGE-graded seats along the corridor (plan: radii ~2/4/6) so no two
    // consecutive encounters repeat the old small-left/large-right two-sphere
    // composition. Seats rest on the lake, off the path centreline, and are pushed
    // clear of the spline (the frame-07 near-clip fix).
    const seats = [
        {
            ft: 0.10, side: -1, lateral: 38, forward: 10, size: 0.7,
        },
        {
            ft: 0.24, side: 1, lateral: 44, forward: 11, size: 0.9,
        },
        {
            ft: 0.38, side: -1, lateral: 48, forward: 14, size: 0.8,
        },
        {
            ft: 0.60, side: 1, lateral: 56, forward: 16, size: 1.2,
        },
        {
            ft: 0.74, side: -1, lateral: 52, forward: 14, size: 0.9, seam: true,
        },
        {
            ft: 0.84, side: 1, lateral: 64, forward: 18, size: 0.6, seam: true,
        },
    ];
    // ONE shared material for every cluster (same node graph → one pipeline), carrying
    // the seam fade + camera-proximity fade + manager ecotone bridge.
    const { material } = createRockClusterMaterialTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        uniforms.uBakedBounce,
        { uSeam: uniforms.uSeam, uOpacity: uniforms.uOpacity },
    );
    for (let i = 0; i < count; i++) {
        const spec = seats[i % seats.length];
        const size = spec.size + (i % 2) * 0.15;
        const stagedSeat = staging.lakeAt(spec.ft, {
            lateral: spec.side * spec.lateral,
            forward: spec.forward,
        });
        const seat = {
            x: stagedSeat.x,
            z: stagedSeat.z,
        };
        pushSeatClearOfPath(seat, size, groupCenter);
        // Base tangent to the lake: center y = lake + size (boulder rests ON the lake).
        const position = new THREE.Vector3(seat.x, LAVA_LAKE_Y + size, seat.z);

        const cluster = createRockCluster(uniforms, position, size, material, {
            sharedLavaFall,
            sharedClusterGlowMaterial,
        });
        cluster.name = `volcanic-geode-cluster-${i}`;
        cluster.userData.stageFt = spec.ft;
        cluster.userData.seamRemnant = Boolean(spec.seam);
        group.add(cluster);
        elements.rockClusters.push(cluster);
        if (spec.seam) {
            elements.seamBoulders.push(cluster);
        }

        // §5.1 contact-shadow AO decal at the lake line under the boulder.
        // (share-material: per-size geometry + the ONE shared decal material.)
        const decalMesh = makeSharedContactDecal(size * 2.6, sharedDecalMaterial);
        decalMesh.position.set(seat.x, LAVA_LAKE_Y + 0.3, seat.z);
        decalMesh.frustumCulled = false;
        group.add(decalMesh);
    }
}

/**
 * Plan item 5 (frame-07 near-clip fix): enforce a minimum radial clearance between an
 * asset seat and the camera spline. Samples the chapter's path span once at placement
 * time (create-time only — zero per-frame cost) and pushes the seat outward along the
 * offending direction if it sits closer than radius + margin.
 */
function pushSeatClearOfPath(seat, radius, groupCenter) {
    const [tStart, tEnd] = getActiveOdysseyChapterPositions();
    let nearestD2 = Infinity;
    let nx = 0;
    let nz = 0;
    for (let i = 0; i <= 24; i += 1) {
        const pt = getOdysseyPathPointAt(THREE.MathUtils.lerp(tStart ?? 0, tEnd ?? 0.125, i / 24));
        const dx = seat.x - (pt.x - groupCenter.x);
        const dz = seat.z - (pt.z - groupCenter.z);
        const d2 = dx * dx + dz * dz;
        if (d2 < nearestD2) {
            nearestD2 = d2;
            nx = dx;
            nz = dz;
        }
    }
    const clearance = radius + 9;
    const d = Math.sqrt(nearestD2);
    if (d < clearance && d > 1e-3) {
        const push = (clearance - d) / d;
        seat.x += nx * push;
        seat.z += nz * push;
    }
}

/**
 * Plan asset 3 — basalt colonnade WALLS: clustered 5–7-sided hex prisms (Fingal's Cave
 * jointing) at seven stations per side along the corridor, size-graded 60→160, bases
 * seated at the lake. Every prism merges into ONE geometry so the entire colonnade
 * costs a single draw call under the column material (charred silhouette, lake-lit
 * fresnel rim + emissive veining).
 */
function createColonnadeWalls(uniforms, staging, sharedMaterial) {
    const stations = [0.06, 0.18, 0.32, 0.46, 0.62, 0.74, 0.85];
    const prismGeometries = [];
    stations.forEach((ft, si) => {
        [-1, 1].forEach((side) => {
            const edge = 55 + ((si * 7 + (side > 0 ? 11 : 0)) % 36); // 55–90 off-path
            const visibleEdge = Math.min(edge, 46);
            const base = staging.lakeAt(ft, {
                lateral: side * visibleEdge,
                forward: (side > 0 ? 8 : -2) + si * 1.5,
            });
            const clusterHeight = 60 + (si / (stations.length - 1)) * 100; // 60→160
            const prismCount = 3 + (si % 2);
            for (let pi = 0; pi < prismCount; pi += 1) {
                const h = clusterHeight * (0.55 + Math.random() * 0.5);
                const r = 4.5 + Math.random() * 3.5;
                const sides = 5 + Math.floor(Math.random() * 3); // 5–7-sided jointing
                const prism = new THREE.CylinderGeometry(r * 0.85, r, h, sides, 1);
                prism.translate(
                    base.x + (Math.random() - 0.5) * r * 4.0,
                    LAVA_LAKE_Y + h * 0.5, // base seated at the lake surface
                    base.z + (Math.random() - 0.5) * r * 4.0,
                );
                prismGeometries.push(prism);
            }
        });
    });
    const merged = mergeGeometries(prismGeometries, false);
    prismGeometries.forEach((g) => g.dispose());
    // Reuse the hoisted shared isColumn=true material (no per-site compile).
    const mesh = new THREE.Mesh(merged, sharedMaterial);
    mesh.name = 'basalt-colonnade-walls';
    mesh.frustumCulled = false;
    return mesh;
}

/**
 * Plan asset 4 — the selenite geode CHAPEL: translucent crystal beams off the right of
 * the rail at the mid-chapter dead zone, backlit by a molten pocket beneath, framed by
 * a dark basalt shell, with one warm corona so it reads from across the cavern.
 */
function createSeleniteChamber(group, uniforms, staging, sharedColumnMaterial) {
    const station = 0.45;
    const frame = staging.frame(station);
    const chapelPosition = staging.at(station, { lateral: 16, forward: -2, up: 32 });

    const chamber = new THREE.Group();
    chamber.name = 'selenite-geode-chamber';

    // Selenite crystal beams removed per user request (2026-08): the chapel keeps its warm
    // molten-pocket backlight, basalt shell and corona sprite (the group the tests + visibility
    // targets reference), just without the gypsum blades. createSeleniteCrystalsTSL is now unused
    // (left exported in earth-core.tsl.js as harmless dead code; no shared material depends on it).

    // Molten pocket beneath — the warm backlight that used to make the selenite glow; kept as the
    // chamber's warm heart.
    const pocket = createMoltenPocketTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        4.4,
        uniforms.uBakedBounce,
        { uOpacity: uniforms.uOpacity, uSeam: uniforms.uSeam },
    );
    pocket.mesh.position.y = -3.2;
    chamber.add(pocket.mesh);

    // Dark basalt SHELL framing the chapel (a broken arc of hex prisms, one draw).
    const shellGeometries = [];
    for (let i = 0; i < 5; i += 1) {
        const h = 18 + i * 4.5;
        const shellPrism = new THREE.CylinderGeometry(3.8, 4.8, h, 6, 1);
        const angle = -1.05 + i * 0.52;
        shellPrism.translate(
            Math.cos(angle) * 11,
            h * 0.5 - 3,
            Math.sin(angle) * 8 - 3,
        );
        shellGeometries.push(shellPrism);
    }
    const shellGeometry = mergeGeometries(shellGeometries, false);
    shellGeometries.forEach((g) => g.dispose());
    // Reuse the hoisted shared isColumn=true material (the shell is byte-identical to the columns).
    const shell = new THREE.Mesh(shellGeometry, sharedColumnMaterial);
    shell.name = 'selenite-chamber-shell';
    chamber.add(shell);

    // One warm corona so the chapel reads from across the cavern.
    const chapelCoronaTexture = createGlowTexture();
    const glow = new THREE.Sprite(
        makeGlowSpriteMaterial(chapelCoronaTexture, 0xff8a3a, 0.28, uniforms.uOpacity),
    );
    glow.scale.set(38, 38, 1);
    glow.position.set(0, 4, 0);
    glow.userData.ownedTexture = chapelCoronaTexture; // OD-11: TSL-node-bound, surfaced for eviction disposal
    chamber.add(glow);

    chamber.position.copy(chapelPosition);
    chamber.rotation.y = Math.atan2(frame.forward.x, frame.forward.z);
    chamber.userData.stageFt = station;
    chamber.traverse((child) => { child.frustumCulled = false; });
    group.add(chamber);
    group.userData.seleniteChamber = chamber;
}

/**
 * Create a single grounded geode CLUSTER: a solid LIT obsidian boulder (plus, for the
 * larger seats, merged satellite shards and one thin magma tether-stream) with ONE
 * small dim glow sprite. Seated on the lake; the shared cluster material takes the
 * lake bounce + distance falloff + seam/proximity fades.
 * @param {object} uniforms shared chapter uniforms
 * @param {THREE.Vector3} position world-local seat (center already tangent to the lake)
 * @param {number} size core sphere radius (small ~2 / medium ~4 / large ~6)
 * @param {THREE.Material} material shared cluster material (one pipeline for all seats)
 * @param {object} [shared] shared sub-assets: sharedLavaFall (tether mat+geo) +
 *   sharedClusterGlowMaterial (one corona material reused across all clusters).
 */
function createRockCluster(uniforms, position, size, material, shared = {}) {
    const { sharedLavaFall, sharedClusterGlowMaterial } = shared;
    const ballGroup = new THREE.Group();

    // Merged geode: the core boulder plus (for the larger seats) 3–4 small satellite
    // shards orbiting it — one geometry, one draw call, ONE shared cluster material
    // (dark albedo + emissive veins + lake bounce + seam/proximity fades).
    const partGeometries = [new THREE.SphereGeometry(size, 24, 24)];
    const satelliteCount = size >= 4.5 ? 3 + Math.floor(Math.random() * 2) : 0;
    let firstSatellite = null;
    for (let s = 0; s < satelliteCount; s += 1) {
        const satSize = 0.8 + Math.random() * 0.8;
        const angle = (s / satelliteCount) * TAU + Math.random() * 0.8;
        const orbit = size * (1.7 + Math.random() * 0.9);
        const sat = new THREE.SphereGeometry(satSize, 18, 18);
        const sx = Math.cos(angle) * orbit;
        const sy = -size * 0.35 + Math.random() * size * 0.9;
        const sz = Math.sin(angle) * orbit;
        sat.translate(sx, sy, sz);
        partGeometries.push(sat);
        if (!firstSatellite) firstSatellite = new THREE.Vector3(sx, sy, sz);
    }
    const geometry = partGeometries.length > 1
        ? mergeGeometries(partGeometries, false)
        : partGeometries[0];
    if (partGeometries.length > 1) partGeometries.forEach((g) => g.dispose());
    const coreMesh = new THREE.Mesh(geometry, material);
    ballGroup.add(coreMesh);

    // Thin ropy magma TETHER-STREAM connecting the core to its nearest satellite —
    // a scaled-down lava-fall ribbon, per the plan's cluster grammar. (share-material:
    // reuses the chapter's ONE lava-fall material + geometry; only this mesh's transform
    // differs, the material is never mutated per mesh.)
    if (firstSatellite) {
        const tetherMesh = sharedLavaFall
            ? new THREE.Mesh(sharedLavaFall.geometry, sharedLavaFall.material)
            : createLavaFallTSL(
                uniforms.uTime,
                uniforms.uPulseIntensity,
                uniforms.uDescent,
                { uOpacity: uniforms.uOpacity },
            ).mesh;
        tetherMesh.name = 'lava-fall';
        const from = new THREE.Vector3(0, size * 0.4, 0);
        const tetherDir = new THREE.Vector3().subVectors(firstSatellite, from);
        const dist = tetherDir.length();
        tetherMesh.position.copy(from).addScaledVector(tetherDir, 0.5);
        tetherMesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            tetherDir.normalize(),
        );
        tetherMesh.scale.set(0.045, dist / 220, 1);
        ballGroup.add(tetherMesh);
    }

    // One small, dim corona glow only (was three stacked sprites — clutter).
    // (share-material: the ONE shared cluster-corona sprite material reused per cluster.)
    const innerGlow = new THREE.Sprite(
        sharedClusterGlowMaterial
        ?? makeGlowSpriteMaterial(createGlowTexture(), 0xff5a14, 0.055, uniforms.uOpacity),
    );
    innerGlow.scale.set(size * 2.1, size * 2.1, 1);
    ballGroup.add(innerGlow);

    ballGroup.position.copy(position);
    ballGroup.userData.glows = [innerGlow];
    ballGroup.userData.size = size;

    return ballGroup;
}

/**
 * Create radial glow texture. The canvas raster is memoized at module scope (startup
 * micro-win: this is called from multiple build sites); the THREE.CanvasTexture itself
 * is fresh per call so per-environment disposal can never poison a later session.
 */
let _glowCanvas = null;
function createGlowTexture() {
    if (!_glowCanvas) {
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
        _glowCanvas = canvas;
    }

    return new THREE.CanvasTexture(_glowCanvas);
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
 * @param {THREE.Material} [sharedDecalMaterial] the ONE shared contact-shadow material
 */
function createMoltenPockets(group, uniforms, groupCenter, sharedDecalMaterial = null) {
    // Level nodes for chapter 1 fall roughly within t ∈ [0, 0.10] along the spline
    // (see odyssey-layout DEFAULT_LEVEL_POSITIONS_BY_ID). Sample those and keep the
    // ones whose local Y sits inside the chapter's framed corridor.
    const nodeTs = [0.0, 0.019, 0.037, 0.056, 0.074, 0.093];
    const pockets = [];
    // ONE shared isColumn=false molten material across all 6 pockets (remake plan boot-reveal
    // saver): the heaviest graph (moltenRockField) now compiles ONCE instead of 6× on the first
    // reveal render. Pockets keep individual geometry + meshes (seam-sink test reads per-object
    // position.y); only the material object is shared. uOpacity is threaded so the ecotone
    // opacity bridge still reaches it (earth-core-environment.test.js).
    const sharedPocketMaterial = createMoltenPocketMaterialTSL(
        uniforms.uTime,
        uniforms.uPulseIntensity,
        uniforms.uBakedBounce,
        { isColumn: false, uOpacity: uniforms.uOpacity, uSeam: uniforms.uSeam },
    ).material;
    nodeTs.forEach((t, i) => {
        const pt = getOdysseyPathPointAt(t);
        const local = new THREE.Vector3(
            pt.x - groupCenter.x,
            pt.y - groupCenter.y,
            pt.z - groupCenter.z,
        );
        const size = [2.35, 2.75, 2.2, 2.9, 2.35, 2.05][i] ?? 2.4;
        const { mesh } = createMoltenPocketTSL(
            uniforms.uTime,
            uniforms.uPulseIntensity,
            size,
            uniforms.uBakedBounce,
            { uOpacity: uniforms.uOpacity, uSeam: uniforms.uSeam, material: sharedPocketMaterial },
        );
        // Seat the shelf as a LEDGE clearly to one side of and below the node. The side
        // offset (1.35×) exceeds the shelf radius, so the shelf never crosses the on-path
        // x≈0 line — the glowing path tube passes cleanly past it instead of skewering it.
        const sideSign = i % 2 === 0 ? 1 : -1;
        const shelfX = local.x + sideSign * (size * 2.7 + 2.0);
        const shelfY = local.y - size * 1.05 - 0.9;
        mesh.position.set(shelfX, shelfY, local.z + sideSign * 0.6);
        mesh.scale.set(1.0, 0.66, 0.82);
        mesh.rotation.y = (i * 1.31) % TAU;
        mesh.name = `molten-pocket-${i}`;
        mesh.frustumCulled = false;
        mesh.userData.size = size;
        mesh.userData.nodePocket = true;
        mesh.userData.seamRemnant = true;
        mesh.userData.seamSinkDepth = size * 3.4 + 6;
        mesh.userData.baseScale = mesh.scale.clone();
        group.add(mesh);
        pockets.push(mesh);

        // §5.1 contact-shadow AO decal nested on/under the shelf so the node reads as
        // resting on a grounded ledge, not floating. (share-material: per-size geometry +
        // the ONE shared decal material.)
        const decalMesh = sharedDecalMaterial
            ? makeSharedContactDecal(size * 2.4, sharedDecalMaterial)
            : (() => {
                const d = createContactShadowDecalTSL(size * 2.4, uniforms.uOpacity);
                return d.mesh;
            })();
        decalMesh.position.set(shelfX, shelfY - size * 0.18, local.z);
        decalMesh.frustumCulled = false;
        group.add(decalMesh);
    });
    group.userData.pockets = pockets;
    return pockets;
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
    // The last ~22% of the chapter is the authored SEAM band (uSeam): lake-vein quench,
    // ember→steam shift, geode sink, and the First Heart's blackbody walk-down.
    if (uniforms?.uDescent && cameraProgress != null) {
        const tStart = group.userData.chapterTStart ?? 0;
        const tEnd = group.userData.chapterTEnd ?? 0.125;
        const span = Math.max(tEnd - tStart, 1e-4);
        const local = THREE.MathUtils.clamp((cameraProgress - tStart) / span, 0, 1);
        group.userData.localProgress = local;
        group.userData.cameraProgress = cameraProgress;
        uniforms.uDescent.value = local;
        const tintRig = group.userData.godRayTint;
        if (tintRig && uniforms.uSeam) {
            // Ease with the seam's own value so the walk and the quench share one clock.
            const w = uniforms.uSeam.value;
            tintRig.uniform.value.copy(tintRig.scratch.copy(tintRig.warm).lerp(tintRig.cool, w));
        }
        if (uniforms.uSeam) {
            uniforms.uSeam.value = Math.max(
                THREE.MathUtils.smoothstep(local, 0.70, 0.86),
                THREE.MathUtils.smoothstep(cameraProgress, 0.074, 0.086),
            );
        }
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

    // Animate lava lake glow sprites (per-sprite base scales incl. the basin coronas).
    const { lavaFloor } = group.userData;
    if (lavaFloor?.userData.glows) {
        const pulse = 1 + Math.sin(time * 1.2) * 0.15;
        lavaFloor.userData.glows.forEach((sprite) => {
            sprite.scale.setScalar((sprite.userData.baseScale ?? 100) * pulse);
        });
    }

    // The First Heart breathes at 0.2 Hz and gutters down across the seam band (its
    // color walk-down happens in-shader; the scale settles as the waterline rises).
    const heart = group.userData.firstHeart;
    if (heart) {
        const seam = uniforms?.uSeam ? uniforms.uSeam.value : 0;
        const localProgress = group.userData.localProgress ?? 0;
        const cameraProgressNow = group.userData.cameraProgress ?? 0;
        const tEnd = group.userData.chapterTEnd ?? 0.093;
        const globalQuench = Math.max(
            THREE.MathUtils.smoothstep(cameraProgressNow, tEnd - 0.018, tEnd - 0.010),
            THREE.MathUtils.smoothstep(cameraProgressNow, 0.078, 0.083),
        );
        const heartQuench = Math.max(
            seam,
            globalQuench,
            THREE.MathUtils.smoothstep(localProgress, 0.78, 0.84),
        );
        const base = group.userData.firstHeartBaseScale ?? 44;
        const breathe = 1 + Math.sin(time * 1.2566) * 0.06;
        heart.scale.setScalar(base * breathe * (1 - heartQuench * 0.92));
        heart.visible = heartQuench < 0.98;
    }

    const { lavaFallRevealables } = group.userData;
    if (lavaFallRevealables?.length) {
        const localProgress = group.userData.localProgress ?? 0;
        const seam = uniforms?.uSeam ? uniforms.uSeam.value : 0;
        const reveal = THREE.MathUtils.smoothstep(localProgress, 0.45, 0.61);
        const visible = reveal > 0.04 && seam < 0.98;
        lavaFallRevealables.forEach((object, i) => {
            if (!object) return;
            object.visible = visible;
            if (i === 0) {
                object.scale.setScalar(THREE.MathUtils.lerp(0.72, 1, reveal));
            }
        });
    }

    const seam = uniforms?.uSeam ? uniforms.uSeam.value : 0;
    const occluderVisible = seam < 0.94;
    if (group.userData.colonnade) group.userData.colonnade.visible = occluderVisible;
    group.userData.columns?.forEach((column) => {
        column.visible = occluderVisible;
    });
    group.userData.ceilingSlabs?.forEach((slab) => {
        slab.visible = occluderVisible;
    });

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

    // Slow rotation of the geode clusters + the seam SINK: across the out-transition
    // every boulder settles into the lake while its material fades in-shader, so no
    // magma sphere survives past the frame-18 equivalent.
    const { elements } = group.userData;
    if (elements?.rockClusters) {
        const seam = uniforms?.uSeam ? uniforms.uSeam.value : 0;
        const localProgress = group.userData.localProgress ?? 0;
        const sinkables = [
            ...(elements.rockClusters ?? []),
            ...(elements.moltenPockets ?? []),
        ];
        sinkables.forEach((cluster, i) => {
            cluster.rotation.y += delta * 0.03 * ((i % 2) * 2 - 1);
            if (cluster.userData.baseY === undefined) {
                cluster.userData.baseY = cluster.position.y;
            }
            const sinkDepth = cluster.userData.seamSinkDepth ?? ((cluster.userData.size ?? 4) * 2 + 5);
            const seamSink = cluster.userData.seamRemnant
                ? Math.max(
                    seam,
                    THREE.MathUtils.smoothstep(localProgress, 0.55, 0.76),
                    THREE.MathUtils.smoothstep(group.userData.cameraProgress ?? 0, 0.078, 0.083),
                )
                : seam;
            cluster.position.y = cluster.userData.baseY - seamSink * sinkDepth;
            if (cluster.userData.baseScale) {
                cluster.scale.copy(cluster.userData.baseScale)
                    .multiplyScalar(THREE.MathUtils.lerp(1, 0.08, seamSink));
            }
            cluster.visible = seamSink < 0.98;

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
