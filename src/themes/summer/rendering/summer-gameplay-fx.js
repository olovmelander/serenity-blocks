/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Summer "Midsummer Promise" gameplay FX — renderer-only command sink.
 *
 * Forked and reskinned from serenity-warp-gameplay-fx.js: the pooled command
 * model, oldest-slot ring allocator, screen→world projection, compile-warmup, and
 * quality/reduced-motion lifecycle are proven and kept. What changed is the visual
 * language — Serenity Warp is neon/additive; Summer is pearly dew, petals, fresh
 * birch leaves, and five-petal wood-cranesbill flowers on NORMAL alpha blending,
 * with NO post-bloom dependency (plan §5, §7.1, §7.2).
 *
 * Three incremental draws (§7.2):
 *   1. Dew pool   — four pearly beads per lock reproducing the piece silhouette.
 *   2. Atlas pool — a shared billboard pool of wisps, gather petals/leaves, and the
 *                   seven-flower wreath lobes (analytic TSL shapes, no atlas image).
 *   3. Halo pool  — the restrained midnight-sun ellipse for combo 10+.
 *
 * The caller (theme wrapper or playground harness) owns event interpretation and
 * supplies commands from summer-gameplay-routing.js plus authoritative time.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    atan,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cos,
    float,
    length,
    max,
    mix,
    positionLocal,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

// Active instance budgets per quality tier (§7.2). The Extreme maximum is
// allocated once; quality changes only adjust active instanceCount.
export const SUMMER_GAMEPLAY_FX_LIMITS = Object.freeze({
    Minimal: Object.freeze({ dewBeads: 24, atlas: 48, halo: 1 }),
    Low: Object.freeze({ dewBeads: 32, atlas: 80, halo: 1 }),
    Medium: Object.freeze({ dewBeads: 40, atlas: 144, halo: 2 }),
    High: Object.freeze({ dewBeads: 48, atlas: 224, halo: 2 }),
    Ultra: Object.freeze({ dewBeads: 48, atlas: 272, halo: 2 }),
    Extreme: Object.freeze({ dewBeads: 48, atlas: 320, halo: 2 }),
});

const MAX = SUMMER_GAMEPLAY_FX_LIMITS.Extreme;
const CELLS_PER_SEAL = 4;
const MAX_SEALS = MAX.dewBeads / CELLS_PER_SEAL;
const MAX_COMMANDS = 48;
const TAU = Math.PI * 2;
const EPSILON = 0.0001;

const COMMAND_DEW = 1;
const COMMAND_WREATH = 2;

// Species discriminant carried on the atlas pool (§5.2). Petal/leaf share a
// teardrop silhouette; the flower is the five-petal wood-cranesbill signature.
const SPECIES_PETAL = 0;
const SPECIES_FLOWER = 1;

// A darker cool refractive dew body (reads against the pale sky by value, not
// additive intensity — §5.1); the bright rim and glint catch the warm sun.
const DEW_BODY = Object.freeze([0.34, 0.52, 0.60]);
const DEW_GLINT = Object.freeze([1.0, 0.95, 0.82]);

// Meadow flower colours the wreath lobes are drawn from (§5.2): white,
// buttercup-yellow, lupine-violet, restrained coral, fresh green.
const FLOWER_PALETTE = Object.freeze([
    Object.freeze([0.97, 0.97, 0.94]),
    Object.freeze([0.96, 0.80, 0.24]),
    Object.freeze([0.56, 0.49, 0.76]),
    Object.freeze([0.95, 0.55, 0.42]),
    Object.freeze([0.66, 0.74, 0.30]),
]);
// Fresh birch-leaf / silver-green gather elements.
const LEAF_COLOR = Object.freeze([0.62, 0.74, 0.36]);
const PETAL_COLOR = Object.freeze([0.96, 0.88, 0.78]);

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function normalizeQuality(value) {
    const quality = String(value || 'High').trim().toLowerCase();
    if (quality === 'minimal') return 'Minimal';
    if (quality === 'low') return 'Low';
    if (quality === 'medium') return 'Medium';
    if (quality === 'ultra') return 'Ultra';
    if (quality === 'extreme') return 'Extreme';
    return 'High';
}

function createQuadGeometry() {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
        0, 0, 1, 0, 1, 1, 0, 1,
    ], 2));
    return geometry;
}

function addAttribute(system, name, array, itemSize) {
    const instanceAttribute = new THREE.InstancedBufferAttribute(array, itemSize);
    instanceAttribute.setUsage(THREE.DynamicDrawUsage);
    system.geometry.setAttribute(name, instanceAttribute);
    system.attributes.push(instanceAttribute);
    return instanceAttribute;
}

function createNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.NormalBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.toneMapped = true; // sits in the meadow's direct-render grade, no bloom
    return material;
}

function createFallbackMaterial(vertexShader, fragmentShader) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uIntensity: { value: 1 },
            uMotion: { value: 1 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.NormalBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.toneMapped = true;
    return material;
}

function finishSystem(system, renderOrder) {
    system.mesh = new THREE.Mesh(system.geometry, system.material);
    system.mesh.name = system.name;
    system.mesh.frustumCulled = false;
    system.mesh.renderOrder = renderOrder;
    system.mesh.visible = false;
    return system;
}

function markAttributes(system) {
    for (let index = 0; index < system.attributes.length; index += 1) {
        system.attributes[index].needsUpdate = true;
    }
}

function setSystemTime(system, time, intensity, motion) {
    if (system.timeNode) {
        system.timeNode.value = time;
        system.intensityNode.value = intensity;
        system.motionNode.value = motion;
    } else {
        system.material.uniforms.uTime.value = time;
        system.material.uniforms.uIntensity.value = intensity;
        system.material.uniforms.uMotion.value = motion;
    }
}

function createPoolState(count) {
    return { active: new Uint8Array(count), end: new Float64Array(count) };
}

// ── Dew pool ────────────────────────────────────────────────────────────────
// Four pearly beads per seal reproduce the locked piece's occupied cells. Reuses
// Serenity Warp's phase-seal billboard (view-space centre + cell offset + local
// quad) with a dew-bead SDF and normal alpha instead of a neon box outline.
function createDewSystem(isWebGPU) {
    const count = MAX.dewBeads;
    const system = {
        name: 'SummerDewSeals',
        geometry: createQuadGeometry(),
        attributes: [],
        state: createPoolState(MAX_SEALS),
        origin: new Float32Array(count * 3),
        cell: new Float32Array(count * 2),
        // aTiming = birth, invLife, cellSize, alpha
        timing: new Float32Array(count * 4),
    };
    for (let i = 0; i < count; i += 1) system.timing[i * 4 + 1] = 1;
    addAttribute(system, 'aOrigin', system.origin, 3);
    addAttribute(system, 'aCell', system.cell, 2);
    addAttribute(system, 'aTiming', system.timing, 4);
    system.geometry.instanceCount = count;

    if (isWebGPU) {
        const uTime = uniform(0);
        const uIntensity = uniform(1);
        const uMotion = uniform(1);
        const material = createNodeMaterial();
        material.vertexNode = Fn(() => {
            const origin = attribute('aOrigin', 'vec3');
            const cell = attribute('aCell', 'vec2');
            const timing = attribute('aTiming', 'vec4');
            const age = uTime.sub(timing.x).mul(timing.y).clamp(0.0, 1.0);
            // Beads press in (0-70ms) then relax slightly outward; still when motion off.
            const lift = mix(float(0.92), float(1.06), smoothstep(0.0, 0.42, age));
            const settle = mix(float(1.0), lift, uMotion);
            const viewPosition = cameraViewMatrix.mul(vec4(origin, 1.0)).toVar();
            const offset = cell.mul(timing.z.mul(1.15))
                .add(positionLocal.xy.mul(timing.z.mul(0.5))).mul(settle);
            viewPosition.x.addAssign(offset.x);
            viewPosition.y.addAssign(offset.y);
            return cameraProjectionMatrix.mul(viewPosition);
        })();
        material.colorNode = Fn(() => {
            const timing = attribute('aTiming', 'vec4');
            const age = uTime.sub(timing.x).mul(timing.y);
            const p = uv().sub(0.5);
            const d = length(p).mul(2.0);
            // Crisp refractive droplet: darker cool body, bright meniscus rim, sharp glint.
            const disc = smoothstep(0.94, 0.80, d);
            const rim = max(smoothstep(0.94, 0.70, d).sub(smoothstep(0.70, 0.52, d)), float(0.0));
            const glint = smoothstep(0.20, 0.0, length(uv().sub(vec2(0.38, 0.64))));
            const fade = smoothstep(0.0, 0.10, age)
                .mul(float(1.0).sub(smoothstep(0.74, 1.0, age)));
            const alpha = disc.mul(0.55).add(rim.mul(1.0)).add(glint.mul(0.9))
                .mul(fade)
                .mul(timing.w)
                .mul(uIntensity)
                .clamp(0.0, 1.0);
            const color = mix(vec3(...DEW_BODY), vec3(0.93, 0.98, 1.0), rim)
                .add(vec3(...DEW_GLINT).mul(glint.mul(0.85)));
            return vec4(color, alpha);
        })();
        system.material = material;
        system.timeNode = uTime;
        system.intensityNode = uIntensity;
        system.motionNode = uMotion;
    } else {
        system.material = createFallbackMaterial(`
            attribute vec3 aOrigin;
            attribute vec2 aCell;
            attribute vec4 aTiming;
            uniform float uTime;
            uniform float uMotion;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            void main() {
                vUv = uv;
                vAge = (uTime - aTiming.x) * aTiming.y;
                vAlpha = aTiming.w;
                float age = clamp(vAge, 0.0, 1.0);
                float lift = mix(0.92, 1.06, smoothstep(0.0, 0.42, age));
                float settle = mix(1.0, lift, uMotion);
                vec4 viewPosition = viewMatrix * vec4(aOrigin, 1.0);
                vec2 offset = (aCell * aTiming.z * 1.15 + position.xy * aTiming.z * 0.5) * settle;
                viewPosition.xy += offset;
                gl_Position = projectionMatrix * viewPosition;
            }
        `, `
            uniform float uIntensity;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            void main() {
                vec2 p = vUv - 0.5;
                float d = length(p) * 2.0;
                float disc = smoothstep(0.94, 0.80, d);
                float rim = max(smoothstep(0.94, 0.70, d) - smoothstep(0.70, 0.52, d), 0.0);
                float glint = smoothstep(0.20, 0.0, length(vUv - vec2(0.38, 0.64)));
                float fade = smoothstep(0.0, 0.10, vAge) * (1.0 - smoothstep(0.74, 1.0, vAge));
                float alpha = clamp((disc * 0.55 + rim * 1.0 + glint * 0.9) * fade * vAlpha * uIntensity, 0.0, 1.0);
                vec3 color = mix(vec3(${DEW_BODY.join(', ')}), vec3(0.93, 0.98, 1.0), rim)
                    + vec3(${DEW_GLINT.join(', ')}) * (glint * 0.85);
                gl_FragColor = vec4(color, alpha);
            }
        `);
    }
    return finishSystem(system, 30);
}

// ── Atlas pool ──────────────────────────────────────────────────────────────
// Shared billboard pool: wisps (lock), gather petals/leaves, and wreath flowers.
// Camera-facing quad drifts from centre along a control vector, tumbling and
// blooming in; species picks between teardrop (petal/leaf) and five-petal flower.
function createAtlasSystem(isWebGPU) {
    const count = MAX.atlas;
    const system = {
        name: 'SummerPetalAtlas',
        geometry: createQuadGeometry(),
        attributes: [],
        state: createPoolState(count),
        center: new Float32Array(count * 3),
        control: new Float32Array(count * 4), // xyz drift target + w seed
        timing: new Float32Array(count * 4), // birth, invLife, size, species
        color: new Float32Array(count * 3),
        alpha: new Float32Array(count),
    };
    for (let i = 0; i < count; i += 1) system.timing[i * 4 + 1] = 1;
    addAttribute(system, 'aCenter', system.center, 3);
    addAttribute(system, 'aControl', system.control, 4);
    addAttribute(system, 'aTiming', system.timing, 4);
    addAttribute(system, 'aColor', system.color, 3);
    addAttribute(system, 'aAlpha', system.alpha, 1);
    system.geometry.instanceCount = count;

    if (isWebGPU) {
        const uTime = uniform(0);
        const uIntensity = uniform(1);
        const uMotion = uniform(1);
        const material = createNodeMaterial();
        material.vertexNode = Fn(() => {
            const center = attribute('aCenter', 'vec3');
            const control = attribute('aControl', 'vec4');
            const timing = attribute('aTiming', 'vec4');
            const age = uTime.sub(timing.x).mul(timing.y).clamp(0.0, 1.0);
            const ease = smoothstep(0.0, 1.0, age);
            const seed = control.w;
            const drift = control.xyz.mul(ease).mul(uMotion);
            const worldCenter = center.add(drift);
            const viewPosition = cameraViewMatrix.mul(vec4(worldCenter, 1.0)).toVar();
            const bloom = smoothstep(0.0, 0.26, age);
            const size = timing.z.mul(bloom);
            const angle = seed.mul(TAU).add(uTime.mul(0.9).add(seed.mul(6.0)).mul(uMotion));
            const c = cos(angle);
            const s = sin(angle);
            const lx = positionLocal.x.mul(c).sub(positionLocal.y.mul(s));
            const ly = positionLocal.x.mul(s).add(positionLocal.y.mul(c));
            viewPosition.x.addAssign(lx.mul(size));
            viewPosition.y.addAssign(ly.mul(size));
            return cameraProjectionMatrix.mul(viewPosition);
        })();
        material.colorNode = Fn(() => {
            const timing = attribute('aTiming', 'vec4');
            const color = attribute('aColor', 'vec3');
            const instAlpha = attribute('aAlpha', 'float');
            const age = uTime.sub(timing.x).mul(timing.y);
            const species = timing.w;
            const p = uv().sub(0.5);
            const r = length(p).mul(2.0);
            // Teardrop petal/leaf: a vertical squashed ellipse.
            const leaf = smoothstep(0.98, 0.66, length(vec2(p.x.mul(2.4), p.y.mul(1.18))).mul(2.0));
            // Five-petal flower via a polar rose threshold.
            const angle = atan(p.y, p.x);
            const petalEdge = float(0.60).add(cos(angle.mul(5.0)).mul(0.30));
            const flowerBody = smoothstep(petalEdge, petalEdge.sub(0.16), r);
            const flowerCore = smoothstep(0.26, 0.0, r);
            const flowerAlpha = max(flowerBody, flowerCore.mul(0.9));
            const shapeAlpha = mix(leaf, flowerAlpha, species);
            const tint = mix(color, vec3(0.99, 0.95, 0.86), flowerCore.mul(species).mul(0.7));
            const fade = smoothstep(0.0, 0.12, age)
                .mul(float(1.0).sub(smoothstep(0.68, 1.0, age)));
            const alpha = shapeAlpha.mul(fade).mul(instAlpha).mul(uIntensity).clamp(0.0, 1.0);
            return vec4(tint, alpha);
        })();
        system.material = material;
        system.timeNode = uTime;
        system.intensityNode = uIntensity;
        system.motionNode = uMotion;
    } else {
        system.material = createFallbackMaterial(`
            attribute vec3 aCenter;
            attribute vec4 aControl;
            attribute vec4 aTiming;
            attribute vec3 aColor;
            attribute float aAlpha;
            uniform float uTime;
            uniform float uMotion;
            varying vec2 vUv;
            varying float vAge;
            varying float vSpecies;
            varying vec3 vColor;
            varying float vInstAlpha;
            void main() {
                vUv = uv;
                vAge = (uTime - aTiming.x) * aTiming.y;
                vSpecies = aTiming.w;
                vColor = aColor;
                vInstAlpha = aAlpha;
                float age = clamp(vAge, 0.0, 1.0);
                float ease = smoothstep(0.0, 1.0, age);
                float seed = aControl.w;
                vec3 worldCenter = aCenter + aControl.xyz * ease * uMotion;
                vec4 viewPosition = viewMatrix * vec4(worldCenter, 1.0);
                float bloom = smoothstep(0.0, 0.26, age);
                float size = aTiming.z * bloom;
                float angle = seed * 6.2831853 + (uTime * 0.9 + seed * 6.0) * uMotion;
                float c = cos(angle);
                float s = sin(angle);
                vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
                viewPosition.xy += q * size;
                gl_Position = projectionMatrix * viewPosition;
            }
        `, `
            uniform float uIntensity;
            varying vec2 vUv;
            varying float vAge;
            varying float vSpecies;
            varying vec3 vColor;
            varying float vInstAlpha;
            void main() {
                vec2 p = vUv - 0.5;
                float r = length(p) * 2.0;
                float leaf = smoothstep(0.98, 0.66, length(vec2(p.x * 2.4, p.y * 1.18)) * 2.0);
                float angle = atan(p.y, p.x);
                float petalEdge = 0.60 + cos(angle * 5.0) * 0.30;
                float flowerBody = smoothstep(petalEdge, petalEdge - 0.16, r);
                float flowerCore = smoothstep(0.26, 0.0, r);
                float flowerAlpha = max(flowerBody, flowerCore * 0.9);
                float shapeAlpha = mix(leaf, flowerAlpha, vSpecies);
                vec3 tint = mix(vColor, vec3(0.99, 0.95, 0.86), flowerCore * vSpecies * 0.7);
                float fade = smoothstep(0.0, 0.12, vAge) * (1.0 - smoothstep(0.68, 1.0, vAge));
                float alpha = clamp(shapeAlpha * fade * vInstAlpha * uIntensity, 0.0, 1.0);
                gl_FragColor = vec4(tint, alpha);
            }
        `);
    }
    return finishSystem(system, 31);
}

// ── Halo pool ───────────────────────────────────────────────────────────────
// One broad translucent golden ellipse behind the wreath, transparent centre so
// board contrast is unchanged. Peaks once, decays slowly (§5.3).
function createHaloSystem(isWebGPU) {
    const count = MAX.halo;
    const system = {
        name: 'SummerMidnightSunHalo',
        geometry: createQuadGeometry(),
        attributes: [],
        state: createPoolState(count),
        origin: new Float32Array(count * 3),
        timing: new Float32Array(count * 4), // birth, invLife, radius, alpha
    };
    for (let i = 0; i < count; i += 1) system.timing[i * 4 + 1] = 1;
    addAttribute(system, 'aOrigin', system.origin, 3);
    addAttribute(system, 'aTiming', system.timing, 4);
    system.geometry.instanceCount = count;

    if (isWebGPU) {
        const uTime = uniform(0);
        const uIntensity = uniform(1);
        const uMotion = uniform(1);
        const material = createNodeMaterial();
        material.vertexNode = Fn(() => {
            const origin = attribute('aOrigin', 'vec3');
            const timing = attribute('aTiming', 'vec4');
            const age = uTime.sub(timing.x).mul(timing.y).clamp(0.0, 1.0);
            const grow = mix(float(0.82), float(1.0), smoothstep(0.0, 0.5, age));
            const scale = mix(float(1.0), grow, uMotion).mul(timing.z);
            const viewPosition = cameraViewMatrix.mul(vec4(origin, 1.0)).toVar();
            viewPosition.x.addAssign(positionLocal.x.mul(scale));
            viewPosition.y.addAssign(positionLocal.y.mul(scale.mul(0.66)));
            return cameraProjectionMatrix.mul(viewPosition);
        })();
        material.colorNode = Fn(() => {
            const timing = attribute('aTiming', 'vec4');
            const age = uTime.sub(timing.x).mul(timing.y);
            const d = length(uv().sub(0.5)).mul(2.0);
            // Soft golden fill that stays transparent through the middle.
            const halo = smoothstep(1.0, 0.28, d).mul(smoothstep(0.10, 0.42, d));
            const fade = smoothstep(0.0, 0.16, age)
                .mul(float(1.0).sub(smoothstep(0.55, 1.0, age)));
            const alpha = halo.mul(fade).mul(timing.w).mul(uIntensity).clamp(0.0, 0.7);
            return vec4(vec3(1.0, 0.86, 0.58), alpha);
        })();
        system.material = material;
        system.timeNode = uTime;
        system.intensityNode = uIntensity;
        system.motionNode = uMotion;
    } else {
        system.material = createFallbackMaterial(`
            attribute vec3 aOrigin;
            attribute vec4 aTiming;
            uniform float uTime;
            uniform float uMotion;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            void main() {
                vUv = uv;
                vAge = (uTime - aTiming.x) * aTiming.y;
                vAlpha = aTiming.w;
                float age = clamp(vAge, 0.0, 1.0);
                float grow = mix(0.82, 1.0, smoothstep(0.0, 0.5, age));
                float scale = mix(1.0, grow, uMotion) * aTiming.z;
                vec4 viewPosition = viewMatrix * vec4(aOrigin, 1.0);
                viewPosition.xy += vec2(position.x * scale, position.y * scale * 0.66);
                gl_Position = projectionMatrix * viewPosition;
            }
        `, `
            uniform float uIntensity;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            void main() {
                float d = length(vUv - 0.5) * 2.0;
                float halo = smoothstep(1.0, 0.28, d) * smoothstep(0.10, 0.42, d);
                float fade = smoothstep(0.0, 0.16, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
                float alpha = clamp(halo * fade * vAlpha * uIntensity, 0.0, 0.7);
                gl_FragColor = vec4(vec3(1.0, 0.86, 0.58), alpha);
            }
        `);
    }
    return finishSystem(system, 29);
}

function createCommand() {
    return {
        active: false,
        type: 0,
        serial: 0,
        dueTime: 0,
        x: 0,
        y: 0,
        z: 0,
        life: 1,
        intensity: 1,
        tier: 1,
        lobeTarget: 0,
        halo: false,
        wispCount: 0,
        seed: 0,
        cells: new Float32Array(CELLS_PER_SEAL * 2),
    };
}

export class SummerGameplayFX {
    constructor({
        scene,
        camera,
        isWebGPU = true,
        quality = 'High',
        reducedMotion = false,
        intensity = 1,
        effectPlaneZ = 3,
    } = {}) {
        if (!scene || !camera) throw new Error('SummerGameplayFX requires a scene and camera');
        this.scene = scene;
        this.camera = camera;
        this.isWebGPU = isWebGPU === true;
        this.quality = normalizeQuality(quality);
        this.limits = SUMMER_GAMEPLAY_FX_LIMITS[this.quality];
        this.reducedMotion = reducedMotion === true;
        this.intensity = clamp(finiteOr(intensity, 1), 0, 2);
        this.effectPlaneZ = finiteOr(effectPlaneZ, 3);
        this.time = 0;
        this.initialized = false;
        this.disposed = false;
        this.commandSerial = 0;
        this.activeCount = 0;
        this.warmupPending = true;
        this.warmupFinalized = false;

        this.colorScratch = new THREE.Color();
        this.projectPointScratch = new THREE.Vector3();
        this.projectNdcScratch = new THREE.Vector2();
        this.projectRaycaster = new THREE.Raycaster();
        this.projectPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.effectPlaneZ);

        this.commands = new Array(MAX_COMMANDS);
        for (let index = 0; index < MAX_COMMANDS; index += 1) this.commands[index] = createCommand();

        this.group = new THREE.Group();
        this.group.name = 'SummerGameplayFX';
        this.group.matrixAutoUpdate = false;
        this.group.visible = false;

        this.dew = createDewSystem(this.isWebGPU);
        this.atlas = createAtlasSystem(this.isWebGPU);
        this.halo = createHaloSystem(this.isWebGPU);
        this.systems = [this.dew, this.atlas, this.halo];
        this.init();
    }

    init() {
        if (this.initialized || this.disposed) return this;
        for (let index = 0; index < this.systems.length; index += 1) {
            this.group.add(this.systems[index].mesh);
        }
        this.scene.add(this.group);
        this.initialized = true;
        this._applyInstanceBudgets();
        return this;
    }

    setQuality(quality) {
        const normalized = normalizeQuality(quality);
        if (normalized === this.quality) return;
        this.quality = normalized;
        this.limits = SUMMER_GAMEPLAY_FX_LIMITS[normalized];
        this._applyInstanceBudgets();
        this._trimOutsideBudgets();
    }

    setReducedMotion(enabled) {
        this.reducedMotion = enabled === true;
        const motion = this.reducedMotion ? 0 : 1;
        const master = this.intensity * (this.reducedMotion ? 0.58 : 1);
        for (let index = 0; index < this.systems.length; index += 1) {
            setSystemTime(this.systems[index], this.time, master, motion);
        }
    }

    setIntensity(intensity) {
        this.intensity = clamp(finiteOr(intensity, 1), 0, 2);
        const master = this.intensity * (this.reducedMotion ? 0.58 : 1);
        for (let index = 0; index < this.systems.length; index += 1) {
            setSystemTime(this.systems[index], this.time, master, this.reducedMotion ? 0 : 1);
        }
    }

    /** Accept a command produced by summer-gameplay-routing.js. */
    enqueue(command) {
        if (this.disposed || !command || typeof command !== 'object') return false;
        const type = command.type === 'wreath' || command.type === COMMAND_WREATH
            ? COMMAND_WREATH
            : COMMAND_DEW;
        const slot = this._claimCommand(type, finiteOr(command.delay, 0));
        if (!slot) return false;
        this._readOrigin(slot, command);
        slot.intensity = clamp(finiteOr(command.intensity, 1), 0, 2);
        slot.life = clamp(finiteOr(command.durationMs, 600) / 1000, 0.12, 3);
        slot.seed = (slot.serial * 0.61803398875) % 1;
        if (type === COMMAND_DEW) {
            slot.wispCount = clamp(Math.floor(finiteOr(command.wispCount, 0)), 0, 12);
            this._readCells(slot.cells, command);
        } else {
            slot.tier = clamp(Math.floor(finiteOr(command.tier, 1)), 1, 5);
            slot.lobeTarget = clamp(Math.floor(finiteOr(command.lobeTarget, 2)), 2, 7);
            slot.halo = command.halo === true;
        }
        return true;
    }

    update(time) {
        if (this.disposed || !this.initialized) return false;
        this.time = Math.max(this.time, finiteOr(time, this.time));
        this._flushCommands(this.time);
        this._expireSystems(this.time);

        // One-frame warmup so both pipelines compile before the first event.
        if (this.warmupPending) {
            const master = this.activeCount > 0 ? this.intensity * (this.reducedMotion ? 0.58 : 1) : 0;
            for (let index = 0; index < this.systems.length; index += 1) {
                this.systems[index].mesh.visible = true;
                setSystemTime(this.systems[index], this.time, master, this.reducedMotion ? 0 : 1);
            }
            this.group.visible = true;
            this.warmupPending = false;
            return true;
        }
        if (!this.warmupFinalized) {
            this._applyInstanceBudgets();
            this.warmupFinalized = true;
        }

        if (this.activeCount === 0) {
            this.group.visible = false;
            return false;
        }
        const master = this.intensity * (this.reducedMotion ? 0.58 : 1);
        this.group.visible = master > EPSILON;
        for (let index = 0; index < this.systems.length; index += 1) {
            const system = this.systems[index];
            if (system.mesh.visible) {
                setSystemTime(system, this.time, master, this.reducedMotion ? 0 : 1);
            }
        }
        return this.group.visible;
    }

    hasActiveEffects() {
        if (this.activeCount > 0) return true;
        for (let index = 0; index < this.commands.length; index += 1) {
            if (this.commands[index].active) return true;
        }
        return false;
    }

    prepareForCompile() {
        if (this.disposed) return () => {};
        const priorCounts = new Int32Array(this.systems.length);
        for (let index = 0; index < this.systems.length; index += 1) {
            priorCounts[index] = this.systems[index].geometry.instanceCount;
            this.systems[index].geometry.instanceCount = Math.max(1, priorCounts[index]);
            this.systems[index].mesh.visible = true;
        }
        this.group.visible = true;
        let restored = false;
        return () => {
            if (restored || this.disposed) return;
            restored = true;
            for (let index = 0; index < this.systems.length; index += 1) {
                this.systems[index].geometry.instanceCount = priorCounts[index];
            }
            this.group.visible = this.activeCount > 0;
        };
    }

    getDebugState() {
        return {
            quality: this.quality,
            reducedMotion: this.reducedMotion,
            intensity: this.intensity,
            activeEffects: this.activeCount,
            backend: this.isWebGPU ? 'webgpu' : 'webgl',
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene.remove(this.group);
        for (let index = 0; index < this.systems.length; index += 1) {
            this.systems[index].geometry.dispose();
            this.systems[index].material.dispose();
        }
        this.group.clear();
        for (let index = 0; index < this.commands.length; index += 1) this.commands[index].active = false;
        this.activeCount = 0;
        this.initialized = false;
    }

    cleanup() {
        this.dispose();
    }

    // ── internals ────────────────────────────────────────────────────────────

    _claimCommand(type, delay) {
        if (this.disposed || this.intensity <= EPSILON) return null;
        let candidate = null;
        let oldestSerial = Number.POSITIVE_INFINITY;
        for (let index = 0; index < this.commands.length; index += 1) {
            const command = this.commands[index];
            if (!command.active) { candidate = command; break; }
            if (command.serial < oldestSerial) { oldestSerial = command.serial; candidate = command; }
        }
        if (!candidate) return null;
        candidate.active = true;
        candidate.type = type;
        this.commandSerial += 1;
        candidate.serial = this.commandSerial;
        candidate.dueTime = this.time + clamp(finiteOr(delay, 0) / 1000, 0, 10);
        return candidate;
    }

    _readOrigin(command, options) {
        const origin = options.origin || null;
        let world = options.worldOrigin || null;
        if (!world && origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) world = origin;
        if (world && Number.isFinite(world.x) && Number.isFinite(world.y)) {
            command.x = world.x;
            command.y = world.y;
            command.z = finiteOr(world.z, this.effectPlaneZ);
            return;
        }
        // Dew seals ride the safe side lane; wreaths sit on the board-normalized origin.
        const normalized = command.type === COMMAND_DEW
            ? (origin?.sideLane?.normalized || origin?.normalized)
            : origin?.normalized;
        if (normalized && Number.isFinite(normalized.x) && Number.isFinite(normalized.y)) {
            this._projectNormalizedOrigin(command, normalized.x, normalized.y);
            return;
        }
        const position = origin?.position || options.position || null;
        if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
            command.x = position.x;
            command.y = position.y;
            command.z = finiteOr(position.z, this.effectPlaneZ);
            return;
        }
        command.x = 0;
        command.y = 0;
        command.z = this.effectPlaneZ;
    }

    _projectNormalizedOrigin(command, normalizedX, normalizedY) {
        this.projectNdcScratch.set(
            clamp(normalizedX, 0, 1) * 2 - 1,
            1 - clamp(normalizedY, 0, 1) * 2,
        );
        this.camera.updateMatrixWorld?.();
        this.projectRaycaster.setFromCamera(this.projectNdcScratch, this.camera);
        const hit = this.projectRaycaster.ray.intersectPlane(this.projectPlane, this.projectPointScratch);
        if (hit) {
            command.x = hit.x;
            command.y = hit.y;
            command.z = hit.z;
            return;
        }
        command.x = this.projectNdcScratch.x * 8;
        command.y = this.projectNdcScratch.y * 5;
        command.z = this.effectPlaneZ;
    }

    _readCells(target, options) {
        const cells = options.glyph?.cells || options.cells;
        let written = 0;
        let sumX = 0;
        let sumY = 0;
        if (Array.isArray(cells)) {
            for (let index = 0; index < cells.length && written < CELLS_PER_SEAL; index += 1) {
                const cell = cells[index];
                const x = finiteOr(cell?.x, 0);
                // Board Y grows downward; flip so the seal reads upright in world space.
                const y = -finiteOr(cell?.y, 0);
                target[written * 2] = x;
                target[written * 2 + 1] = y;
                sumX += x;
                sumY += y;
                written += 1;
            }
        }
        if (written !== CELLS_PER_SEAL) {
            const preset = [0, 0, 1, 0, 2, 0, 1, -1]; // T fallback
            written = CELLS_PER_SEAL;
            sumX = 0;
            sumY = 0;
            for (let index = 0; index < CELLS_PER_SEAL; index += 1) {
                target[index * 2] = preset[index * 2];
                target[index * 2 + 1] = preset[index * 2 + 1];
                sumX += preset[index * 2];
                sumY += preset[index * 2 + 1];
            }
        }
        const centerX = sumX / CELLS_PER_SEAL;
        const centerY = sumY / CELLS_PER_SEAL;
        for (let index = 0; index < CELLS_PER_SEAL; index += 1) {
            target[index * 2] -= centerX;
            target[index * 2 + 1] -= centerY;
        }
    }

    _flushCommands(time) {
        for (let index = 0; index < this.commands.length; index += 1) {
            const command = this.commands[index];
            if (!command.active || command.dueTime > time) continue;
            if (command.type === COMMAND_DEW) this._stampDew(command, command.dueTime);
            else this._stampWreath(command, command.dueTime);
            command.active = false;
        }
    }

    _acquireSlot(system, limit, time) {
        if (limit <= 0) return -1;
        let candidate = -1;
        let soonestEnd = Number.POSITIVE_INFINITY;
        for (let index = 0; index < limit; index += 1) {
            if (!system.state.active[index] || system.state.end[index] <= time) return index;
            if (system.state.end[index] < soonestEnd) { soonestEnd = system.state.end[index]; candidate = index; }
        }
        return candidate;
    }

    _activateSlot(system, slot, endTime) {
        if (!system.state.active[slot]) this.activeCount += 1;
        system.state.active[slot] = 1;
        system.state.end[slot] = endTime;
        system.mesh.visible = true;
    }

    _stampDew(command, time) {
        const system = this.dew;
        const sealLimit = Math.floor(this.limits.dewBeads / CELLS_PER_SEAL);
        const slot = this._acquireSlot(system, sealLimit, time);
        if (slot < 0) return;
        const cellSize = 0.5;
        const inverseLife = 1 / command.life;
        for (let cell = 0; cell < CELLS_PER_SEAL; cell += 1) {
            const instance = slot * CELLS_PER_SEAL + cell;
            const originOffset = instance * 3;
            const cellOffset = instance * 2;
            system.origin[originOffset] = command.x;
            system.origin[originOffset + 1] = command.y;
            system.origin[originOffset + 2] = command.z;
            system.cell[cellOffset] = command.cells[cell * 2];
            system.cell[cellOffset + 1] = command.cells[cell * 2 + 1];
            const timingOffset = instance * 4;
            system.timing[timingOffset] = time;
            system.timing[timingOffset + 1] = inverseLife;
            system.timing[timingOffset + 2] = cellSize;
            system.timing[timingOffset + 3] = 0.95 * command.intensity;
        }
        this._activateSlot(system, slot, time + command.life);
        markAttributes(system);
        // Wisps lift from the seal corners — the material a later combo gathers.
        this._spawnWisps(command, time);
    }

    _spawnWisps(command, time) {
        if (command.wispCount <= 0) return;
        const life = command.life * 1.6;
        for (let i = 0; i < command.wispCount; i += 1) {
            const angle = command.seed * TAU + (i * TAU) / command.wispCount;
            const spread = 0.7 + ((i * 13) % 7) / 10;
            const isLeaf = i % 3 === 0;
            this._stampAtlas(
                command.x + Math.cos(angle) * 0.4 * spread,
                command.y + Math.sin(angle) * 0.4 * spread,
                command.z,
                Math.cos(angle) * 0.6,
                1.1 + spread * 0.5,
                0,
                time + (i % 4) * 0.02,
                life,
                0.42 + (i % 3) * 0.05,
                isLeaf ? SPECIES_PETAL : SPECIES_PETAL,
                isLeaf ? LEAF_COLOR : PETAL_COLOR,
                command.intensity * 0.85,
            );
        }
    }

    _stampWreath(command, time) {
        const lobes = command.lobeTarget;
        const radius = 1.7 + command.tier * 0.22;
        // Seven-flower crown lobes on a ring, newest lobe last (staggered bloom).
        for (let i = 0; i < lobes; i += 1) {
            const angle = -Math.PI / 2 + (i * TAU) / 7; // reserve the seven positions
            const color = FLOWER_PALETTE[i % FLOWER_PALETTE.length];
            this._stampAtlas(
                command.x + Math.cos(angle) * radius,
                command.y + Math.sin(angle) * radius,
                command.z,
                0,
                0,
                0,
                time + i * 0.05,
                command.life,
                0.72 + command.tier * 0.03,
                SPECIES_FLOWER,
                color,
                command.intensity,
            );
        }
        // Gather petals/leaves streaming from the outer band toward each lobe —
        // the ring-dance chase (§5.2).
        const gather = this.reducedMotion ? 0 : Math.min(lobes * 3, 18);
        for (let i = 0; i < gather; i += 1) {
            const angle = command.seed * TAU + (i * 2.39996323);
            const start = radius * 1.9;
            const sx = command.x + Math.cos(angle) * start;
            const sy = command.y + Math.sin(angle) * start;
            const isLeaf = i % 2 === 0;
            this._stampAtlas(
                sx,
                sy,
                command.z,
                (command.x - sx) * 0.7,
                (command.y - sy) * 0.7,
                0,
                time + (i % 5) * 0.03,
                command.life * 0.7,
                0.34 + (i % 3) * 0.04,
                SPECIES_PETAL,
                isLeaf ? LEAF_COLOR : PETAL_COLOR,
                command.intensity * 0.8,
            );
        }
        if (command.halo) this._stampHalo(command, time);
    }

    _stampAtlas(x, y, z, cx, cy, cz, birth, life, size, species, color, alpha) {
        const system = this.atlas;
        const slot = this._acquireSlot(system, this.limits.atlas, birth);
        if (slot < 0) return;
        const offset3 = slot * 3;
        const offset4 = slot * 4;
        system.center[offset3] = x;
        system.center[offset3 + 1] = y;
        system.center[offset3 + 2] = z;
        system.control[offset4] = cx;
        system.control[offset4 + 1] = cy;
        system.control[offset4 + 2] = cz;
        system.control[offset4 + 3] = (slot * 0.61803398875) % 1;
        system.timing[offset4] = birth;
        system.timing[offset4 + 1] = 1 / life;
        system.timing[offset4 + 2] = size;
        system.timing[offset4 + 3] = species;
        system.color[offset3] = color[0];
        system.color[offset3 + 1] = color[1];
        system.color[offset3 + 2] = color[2];
        system.alpha[slot] = clamp(finiteOr(alpha, 1), 0, 1);
        this._activateSlot(system, slot, birth + life);
        markAttributes(system);
    }

    _stampHalo(command, time) {
        const system = this.halo;
        const slot = this._acquireSlot(system, this.limits.halo, time);
        if (slot < 0) return;
        const offset3 = slot * 3;
        const offset4 = slot * 4;
        system.origin[offset3] = command.x;
        system.origin[offset3 + 1] = command.y;
        system.origin[offset3 + 2] = command.z - 0.2; // sit just behind the wreath
        system.timing[offset4] = time;
        system.timing[offset4 + 1] = 1 / (command.life * 1.1);
        system.timing[offset4 + 2] = 5.4;
        system.timing[offset4 + 3] = 0.9 * command.intensity;
        this._activateSlot(system, slot, time + command.life * 1.1);
        markAttributes(system);
    }

    _expireSystems(time) {
        let activeCount = 0;
        for (let s = 0; s < this.systems.length; s += 1) {
            const system = this.systems[s];
            const limit = this._systemLimit(system);
            let systemActive = false;
            for (let slot = 0; slot < limit; slot += 1) {
                if (system.state.active[slot] && system.state.end[slot] <= time) {
                    system.state.active[slot] = 0;
                }
                if (system.state.active[slot]) { activeCount += 1; systemActive = true; }
            }
            system.mesh.visible = systemActive && this.intensity > EPSILON;
        }
        this.activeCount = activeCount;
    }

    _systemLimit(system) {
        if (system === this.dew) return Math.floor(this.limits.dewBeads / CELLS_PER_SEAL);
        if (system === this.atlas) return this.limits.atlas;
        return this.limits.halo;
    }

    _applyInstanceBudgets() {
        this.dew.geometry.instanceCount = this.limits.dewBeads;
        this.atlas.geometry.instanceCount = this.limits.atlas;
        this.halo.geometry.instanceCount = this.limits.halo;
    }

    _trimOutsideBudgets() {
        for (let s = 0; s < this.systems.length; s += 1) {
            const system = this.systems[s];
            const limit = this._systemLimit(system);
            for (let slot = limit; slot < system.state.active.length; slot += 1) {
                system.state.active[slot] = 0;
            }
        }
        this._expireSystems(this.time);
    }
}

export function createSummerGameplayFX(options) {
    return new SummerGameplayFX(options);
}

export default SummerGameplayFX;
