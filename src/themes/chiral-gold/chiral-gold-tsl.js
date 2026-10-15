/**
 * Chiral Gold — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function instead of being inlined at each call site;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is one tileable texture baked on the CPU, hashes are hash-without-sine;
 *  - the gold is a real metal and the only light in the hall is the studio it reflects: an HDR
 *    environment baked on the CPU (softboxes, strip lights, a scatter of pin lights) and prefiltered
 *    once. No scene lights, no shadows. It is lit by `cgStudioMetal`, which computes what three's
 *    MeshStandardNodeMaterial computes for metalness 1 under that light, without its general
 *    lighting model (a third of the node build: see the helper);
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    DFGLUT,
    Fn,
    abs,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cameraWorldMatrix,
    dot,
    float,
    fract,
    getRoughness,
    materialEnvIntensity,
    max,
    normalView,
    normalWorld,
    pmremTexture,
    positionViewDirection,
    pow,
    texture,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';

import {
    ALLOYS,
    COMET_SLOTS,
    PULSE_SLOTS,
    RIPPLE_SLOTS,
} from './chiral-gold-core.js';
import {
    NOISE_SEED, NOISE_SIZE, STUDIO_SEED, bakeNoise, bakeStudio,
} from './chiral-gold-bake.js';

export * from './chiral-gold-core.js';
// The CPU bakes are three-free (chiral-gold-bake.js): a first visit runs them in a worker.
export { NOISE_SIZE, STUDIO_LIGHTS } from './chiral-gold-bake.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const cgHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'cg_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const cgHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'cg_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const cgLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const cgMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const cgBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** World position → clip space, for parts that place their own vertices. */
export const cgClip = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── The noise texture ───────────────────────────────────────────────────────────

/**
 * A tileable RGBA texture: four decorrelated channels of periodic gradient noise (four octaves),
 * stretched to [0, 1]. Baked once (chiral-gold-bake.js); the brushing of the gold, the swell of the
 * water and the streaks in the light are all fetches of it.
 */
export function createNoiseTexture(seed = NOISE_SEED, size = NOISE_SIZE) {
    const n = size;
    const data = bakeNoise(seed, size);
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'chiral-gold-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── The studio ──────────────────────────────────────────────────────────────────

/**
 * The studio as an equirectangular HDR texture (half floats), baked once (chiral-gold-bake.js).
 * @param {number} [width=1024]  twice the height; the prefilter's cube faces are width / 4
 */
export function createStudioEquirect(width = 1024, seed = STUDIO_SEED) {
    const W = width;
    const H = width >> 1;
    const data = bakeStudio(width, seed);
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.name = 'chiral-gold-studio';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

/**
 * Every uniform the hall's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture, studio?: THREE.Texture }} textures
 */
export function createHallUniforms(textures) {
    const first = ALLOYS[0];
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Pixels a metre covers at one metre's depth, over the buffer's height (0.5 / tan(fov / 2)). */
        lens: uniform(1.37),
        /** 0..1.3: the chain's charge. The cores glow, the gold runs hot. */
        heat: uniform(0),
        /** Gain on everything that emits (the four-line hush pulls it down). */
        emit: uniform(1),
        /** A flare each tower holds after a strike (x = left, y = right). */
        flare: uniform(new THREE.Vector2(0, 0)),
        /** The alloy's three braid colours and its glow (scene-linear). */
        alloyA: uniform(new THREE.Vector3(...first.ribbons[0])),
        alloyB: uniform(new THREE.Vector3(...first.ribbons[1])),
        alloyC: uniform(new THREE.Vector3(...first.ribbons[2])),
        glow: uniform(new THREE.Vector3(...first.glow)),
        /** The alloy being poured out, and the height the pour has reached (level-up). */
        prevA: uniform(new THREE.Vector3(...first.ribbons[0])),
        prevB: uniform(new THREE.Vector3(...first.ribbons[1])),
        prevC: uniform(new THREE.Vector3(...first.ribbons[2])),
        pour: uniform(100),
        /** World x of the towers' axes (the right one; the left is its mirror), and their scale. */
        helixX: uniform(6.6),
        helixScale: uniform(1),
        /** Audio: (bass, mid, treble, beat), each 0..1. */
        audio: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** Pulses along the ribbons: (height, birth, strength, side). */
        pulseA: [],
        /** Rings on the water: (x, z, birth, strength) + colour. */
        rippleA: [],
        rippleC: [],
        /** The clear's surge across the water and through the towers: (birth, strength, lines, _). */
        surge: uniform(new THREE.Vector4(-100, 0, 1, 0)),
        /** The four-line strike: (birth, strength, _, _). */
        aurum: uniform(new THREE.Vector4(-100, 0, 0, 0)),
        /** Comets on the great ring: (birth, turns/s signed, strength, band). */
        cometA: [],
        noiseTex: textures.noise,
        /** The studio the gold reflects (the scene's environment too). */
        studioTex: textures.studio ?? null,
        // Read per drawn object, so one material serves every object of its kind (a material's node
        // build is paid once per material, and twice over here: the scene pass and the mirror):
        /** The tower an object belongs to: −1 left, +1 right (`object.userData.cgHand`). */
        hand: uniform(1).onObjectUpdate(({ object }) => object.userData.cgHand ?? 1),
        /** A ring band: (brush scale, arc span, arc start, comet lag) from `object.userData.cgBand`. */
        bandShape: uniform(new THREE.Vector4(1, 1, 0, 0)).onObjectUpdate(({ object }) => object.userData.cgBand?.shape),
        /** A ring band's alloy (0, 1, 2) and its spin (radians). */
        bandIndex: uniform(0).onObjectUpdate(({ object }) => object.userData.cgBand?.index),
        bandSpin: uniform(0).onObjectUpdate(({ object }) => object.userData.cgBand?.angle),
        /** The materials the parts share, made once per hall (see chiral-gold-helix.js, -ring.js). */
        shared: {},
    };
    for (let i = 0; i < PULSE_SLOTS; i++) u.pulseA.push(uniform(new THREE.Vector4(0, -100, 0, 0)));
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
        u.rippleA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.rippleC.push(uniform(new THREE.Vector3(1, 0.7, 0.3)));
    }
    for (let i = 0; i < COMET_SLOTS; i++) u.cometA.push(uniform(new THREE.Vector4(-100, 0, 0, 0)));
    u.noise = (st) => texture(u.noiseTex, st);
    u.metal = (albedo, roughness) => cgStudioMetal(u.studioTex, albedo, roughness);
    return u;
}

// ── The gold ────────────────────────────────────────────────────────────────────

/**
 * The studio's light off a metal of colour `albedo` (F0) and `roughness`: what three r186's
 * MeshStandardNodeMaterial computes for metalness 1 with this studio as the scene's environment
 * and no lights (PhysicalLightingModel.indirect: the prefiltered reflection times the split sum's
 * single scattering, read from three's own DFG table, plus Fdez-Agüera's multiple-scattering
 * energy lit by the irradiance; the scene's environment intensity and rotation still apply).
 * Without the general lighting model around it, a gold material's node build is about a third of
 * the time (Node: 29 → 9 ms; the hall had ten of them building 100-300 ms each on a page, one per
 * frame, while the theme came in, play-feel probe 2026-10-15).
 * @param {THREE.Texture} studio  the equirect the gold reflects
 * @param {Node} albedo     vec3, linear
 * @param {Node} roughnessIn  float (the material's roughness, before three's floor and AA)
 * @returns {Node} vec3, scene-linear
 */
export function cgStudioMetal(studio, albedo, roughnessIn) {
    // As the standard material: a floor of 0.0525, plus the geometry's own roughness (specular AA).
    const roughness = getRoughness({ roughness: float(roughnessIn) }).toVar('cgRoughness');
    const n = normalView;
    const dotNV = n.dot(positionViewDirection).clamp();
    const fab = DFGLUT({ roughness, dotNV }).toVar('cgDfg');
    const fssEss = albedo.mul(fab.x).add(fab.y);
    const ems = fab.x.add(fab.y).oneMinus();
    const favg = albedo.add(albedo.oneMinus().mul(0.047619));
    const fms = fssEss.mul(favg).div(ems.mul(favg).oneMinus());
    // The reflection leans toward the normal as the metal roughens (EnvironmentNode's radiance).
    const reflectVec = pow(roughness, 4.0).mix(positionViewDirection.negate().reflect(n), n).normalize()
        .transformDirection(cameraWorldMatrix);
    const radiance = pmremTexture(studio, reflectVec, roughness).rgb;
    const irradiance = pmremTexture(studio, normalWorld, float(1.0)).rgb;
    return radiance.mul(fssEss).add(fms.mul(ems).mul(irradiance)).mul(materialEnvIntensity);
}

/**
 * A material for the gold: unlit (the colour carries the studio's light and what the gold gives
 * off), opaque, out of the fog. Its colour is `u.metal(albedo, roughness).add(emission)`.
 * @param {string} name
 */
export function cgGoldMaterial(name) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.fog = false;
    material.userData.studioMetal = true;
    return material;
}

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function cgFxMaterial(name, { depthTest = true } = {}) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest,
        side: THREE.DoubleSide,
    });
    m.name = name;
    m.fog = false;
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.forceSinglePass = true;
    return m;
}

/**
 * A unit quad (xy in −0.5..0.5, uv 0..1) for `count` instances.
 * @param {number} count
 * @param {Record<string, [Float32Array, number]>} attributes  name → [data, itemSize]
 */
export function cgQuadGeometry(count, attributes = {}) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    Object.keys(attributes).forEach((name) => {
        const [data, itemSize] = attributes[name];
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    });
    geometry.instanceCount = count;
    return geometry;
}

/**
 * A strip (x in −0.5..0.5 in `segments` steps, y in −0.5..0.5, uv 0..1) for `count` instances:
 * a quad that can bend along its length.
 */
export function cgStripGeometry(count, segments, attributes = {}) {
    const geometry = new THREE.InstancedBufferGeometry();
    const position = [];
    const uvs = [];
    const index = [];
    for (let i = 0; i <= segments; i++) {
        const x = i / segments;
        position.push(x - 0.5, -0.5, 0, x - 0.5, 0.5, 0);
        uvs.push(x, 0, x, 1);
        if (i < segments) {
            const a = i * 2;
            index.push(a, a + 2, a + 3, a, a + 3, a + 1);
        }
    }
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    Object.keys(attributes).forEach((name) => {
        const [data, itemSize] = attributes[name];
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    });
    geometry.instanceCount = count;
    return geometry;
}

/** Wrap a finished part: unculled, static, ordered. `reflected` = drawn in the water's mirror. */
export function cgPart(name, geometry, material, renderOrder = 0, reflected = false) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    return {
        mesh, material, geometry, reflected,
    };
}
