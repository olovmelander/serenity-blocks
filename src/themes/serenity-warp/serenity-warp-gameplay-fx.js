/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Serenity Warp gameplay-only effects.
 *
 * This module deliberately owns no event subscriptions, render loop, renderer,
 * or post-processing. A theme/controller supplies world-space commands and the
 * authoritative elapsed time. All drawables are fixed-size instanced pools.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    exp,
    float,
    length,
    max,
    min,
    mix,
    positionLocal,
    sin,
    smoothstep,
    uniform,
    uv,
    vec3,
    vec4,
} from 'three/tsl';

export const SERENITY_WARP_GAMEPLAY_FX_LIMITS = Object.freeze({
    Low: Object.freeze({
        seals: 4,
        rings: 2,
        nodes: 5,
        links: 5,
        ellipses: 1,
        streaks: 0,
    }),
    Medium: Object.freeze({
        seals: 8,
        rings: 4,
        nodes: 10,
        links: 12,
        ellipses: 2,
        streaks: 24,
    }),
    High: Object.freeze({
        seals: 12,
        rings: 6,
        nodes: 14,
        links: 20,
        ellipses: 4,
        streaks: 48,
    }),
});

const MAX = SERENITY_WARP_GAMEPLAY_FX_LIMITS.High;
const MAX_COMMANDS = 48;
const CELLS_PER_SEAL = 4;
// The seal renders on an FX plane ~36–38u from the camera; a cell must be this large in
// world units to read at ~10–12% of screen height instead of the old sub-pixel speck.
const DEFAULT_SEAL_CELL_SIZE = 3.4;
const COMMAND_PHASE_SEAL = 1;
const COMMAND_RING = 2;
const COMMAND_GATE = 3;
const COMMAND_STREAKS = 4;
const GATE_STANDARD = 0;
const GATE_MOBIUS = 1;
const GATE_PERFECT_CLEAR = 2;
const STAGE_ECHO = 1;
const STAGE_CONSTELLATION = 2;
const STAGE_APERTURE = 3;
const STAGE_SEVENFOLD = 4;
const TAU = Math.PI * 2;
const EPSILON = 0.0001;

const PIECE_COLORS = Object.freeze({
    I: 0x52ef32,
    O: 0xffa31a,
    T: 0x536dff,
    S: 0x35e6ef,
    Z: 0xff3b30,
    J: 0xffe23d,
    L: 0xd33bea,
    GARBAGE: 0x6e658f,
});

const SPECTRUM = Object.freeze([
    Object.freeze([0.32, 0.94, 0.20]),
    Object.freeze([1.00, 0.64, 0.10]),
    Object.freeze([1.00, 0.23, 0.19]),
    Object.freeze([0.83, 0.23, 0.92]),
    Object.freeze([0.33, 0.43, 1.00]),
    Object.freeze([0.21, 0.90, 0.94]),
    Object.freeze([1.00, 0.89, 0.24]),
]);

const SHAPE_CELLS = Object.freeze({
    I: Object.freeze([-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0]),
    O: Object.freeze([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
    T: Object.freeze([-1, 0, 0, 0, 1, 0, 0, -1]),
    S: Object.freeze([-1, 0, 0, 0, 0, -1, 1, -1]),
    Z: Object.freeze([-1, -1, 0, -1, 0, 0, 1, 0]),
    J: Object.freeze([-1, -1, -1, 0, 0, 0, 1, 0]),
    L: Object.freeze([1, -1, -1, 0, 0, 0, 1, 0]),
    GARBAGE: Object.freeze([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
});

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function normalizeQuality(value) {
    const quality = String(value || 'High').toLowerCase();
    if (quality === 'minimal' || quality === 'low') return 'Low';
    if (quality === 'medium') return 'Medium';
    return 'High';
}

function createQuadGeometry(yFrom = -1, yTo = 1) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -1, yFrom, 0,
        1, yFrom, 0,
        1, yTo, 0,
        -1, yTo, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
        0, 0,
        1, 0,
        1, 1,
        0, 1,
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
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.toneMapped = false;
    material.userData.emitsBloom = true;
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
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.toneMapped = false;
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
    return {
        active: new Uint8Array(count),
        end: new Float64Array(count),
    };
}

function createPackedTiming(count, thirdDefault = 0, fourthDefault = 0) {
    const timing = new Float32Array(count * 4);
    for (let index = 0; index < count; index += 1) {
        const offset = index * 4;
        timing[offset + 1] = 1;
        timing[offset + 2] = thirdDefault;
        timing[offset + 3] = fourthDefault;
    }
    return timing;
}

function writePackedTiming(system, index, birth, invLife, third, fourth) {
    const offset = index * 4;
    system.timing[offset] = birth;
    system.timing[offset + 1] = invLife;
    system.timing[offset + 2] = third;
    system.timing[offset + 3] = fourth;
}

function writePackedVisual(system, index, alpha, red, green, blue) {
    const offset = index * 4;
    system.visual[offset] = alpha;
    system.visual[offset + 1] = red;
    system.visual[offset + 2] = green;
    system.visual[offset + 3] = blue;
}

function createPhaseSealSystem(isWebGPU) {
    const count = MAX.seals * CELLS_PER_SEAL;
    const system = {
        name: 'SerenityWarpPhaseSeals',
        geometry: createQuadGeometry(),
        attributes: [],
        state: createPoolState(MAX.seals),
        origin: new Float32Array(count * 3),
        cell: new Float32Array(count * 2),
        birth: new Float32Array(count),
        invLife: new Float32Array(count).fill(1),
        size: new Float32Array(count),
        alpha: new Float32Array(count),
        color: new Float32Array(count * 3),
        timing: createPackedTiming(count),
    };
    addAttribute(system, 'aOrigin', system.origin, 3);
    addAttribute(system, 'aCell', system.cell, 2);
    addAttribute(system, 'aTiming', system.timing, 4);
    addAttribute(system, 'aColor', system.color, 3);
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
            const animatedSettle = mix(
                float(1.12),
                float(1.0),
                smoothstep(0.11, 0.29, age),
            );
            const settle = mix(float(1.0), animatedSettle, uMotion);
            const viewPosition = cameraViewMatrix.mul(vec4(origin, 1.0)).toVar();
            const offset = cell.mul(timing.z.mul(1.08))
                .add(positionLocal.xy.mul(timing.z.mul(0.5))).mul(settle);
            viewPosition.x.addAssign(offset.x);
            viewPosition.y.addAssign(offset.y);
            return cameraProjectionMatrix.mul(viewPosition);
        })();
        const colorNode = Fn(() => {
            const timing = attribute('aTiming', 'vec4');
            const color = attribute('aColor', 'vec3');
            const age = uTime.sub(timing.x).mul(timing.y);
            // Phase Seal v2 — a SOLID rounded-rect stamp of the piece cell (filled body +
            // bright piece-tinted rim + centre core glow + soft halo), replacing the old
            // hollow wireframe that read as a debug glitch. Reads as light without bloom.
            const p = uv().sub(0.5).mul(2.0);
            const q = abs(p).sub(0.80);
            const d = length(max(q, float(0.0))).add(min(max(q.x, q.y), float(0.0))).sub(0.16);
            const body = float(1.0).sub(smoothstep(-0.02, 0.06, d));
            const innerBody = float(1.0).sub(smoothstep(-0.02, 0.06, d.add(0.06)));
            const rim = max(body.sub(innerBody), float(0.0));
            const halo = exp(max(d, float(0.0)).mul(-7.0)).mul(0.6);
            const core = float(1.0).sub(smoothstep(-0.55, 0.0, d)).mul(0.5);
            const fade = smoothstep(0.0, 0.08, age)
                .mul(float(1.0).sub(smoothstep(0.82, 1.0, age)));
            const snap = float(1.0).sub(smoothstep(0.0, 0.1, age));
            const bodyBright = body.mul(0.95).add(core);
            const rimBright = rim.mul(float(1.4).add(snap.mul(1.4)));
            const glowBright = halo.mul(0.6);
            const rimColor = mix(color, vec3(1.0, 1.0, 1.0), 0.35);
            const env = fade.mul(timing.w).mul(uIntensity);
            const rgb = color.mul(bodyBright.add(glowBright))
                .add(rimColor.mul(rimBright)).mul(env);
            const alpha = bodyBright.add(rimBright).add(glowBright).mul(env).clamp(0.0, 1.0);
            return vec4(rgb, alpha);
        })();
        material.colorNode = colorNode;
        material.emissiveNode = colorNode.rgb;
        system.material = material;
        system.timeNode = uTime;
        system.intensityNode = uIntensity;
        system.motionNode = uMotion;
    } else {
        system.material = createFallbackMaterial(`
            attribute vec3 aOrigin;
            attribute vec2 aCell;
            attribute vec4 aTiming;
            attribute vec3 aColor;
            uniform float uTime;
            uniform float uMotion;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                vUv = uv;
                vAge = (uTime - aTiming.x) * aTiming.y;
                vAlpha = aTiming.w;
                vColor = aColor;
                float age = clamp(vAge, 0.0, 1.0);
                float animatedSettle = mix(1.12, 1.0, smoothstep(0.11, 0.29, age));
                float settle = mix(1.0, animatedSettle, uMotion);
                vec4 viewPosition = viewMatrix * vec4(aOrigin, 1.0);
                vec2 offset = (
                    aCell * aTiming.z * 1.08 + position.xy * aTiming.z * 0.5
                ) * settle;
                viewPosition.xy += offset;
                gl_Position = projectionMatrix * viewPosition;
            }
        `, `
            uniform float uIntensity;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                vec2 p = (vUv - 0.5) * 2.0;
                vec2 q = abs(p) - vec2(0.80);
                float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.16;
                float body = 1.0 - smoothstep(-0.02, 0.06, d);
                float innerBody = 1.0 - smoothstep(-0.02, 0.06, d + 0.06);
                float rim = max(body - innerBody, 0.0);
                float halo = exp(max(d, 0.0) * -7.0) * 0.6;
                float core = (1.0 - smoothstep(-0.55, 0.0, d)) * 0.5;
                float fade = smoothstep(0.0, 0.08, vAge)
                    * (1.0 - smoothstep(0.82, 1.0, vAge));
                float snap = 1.0 - smoothstep(0.0, 0.1, vAge);
                float bodyBright = body * 0.95 + core;
                float rimBright = rim * (1.4 + snap * 1.4);
                float glowBright = halo * 0.6;
                vec3 rimColor = mix(vColor, vec3(1.0), 0.35);
                float env = fade * vAlpha * uIntensity;
                vec3 rgb = (vColor * (bodyBright + glowBright) + rimColor * rimBright) * env;
                float alpha = clamp((bodyBright + rimBright + glowBright) * env, 0.0, 1.0);
                gl_FragColor = vec4(rgb, alpha);
            }
        `);
    }
    return finishSystem(system, 24);
}

function createRingSystem(isWebGPU) {
    const count = MAX.rings;
    const system = {
        name: 'SerenityWarpSealRings',
        geometry: createQuadGeometry(),
        attributes: [],
        state: createPoolState(count),
        origin: new Float32Array(count * 3),
        birth: new Float32Array(count),
        invLife: new Float32Array(count).fill(1),
        radius: new Float32Array(count),
        width: new Float32Array(count).fill(0.05),
        alpha: new Float32Array(count),
        color: new Float32Array(count * 3),
        timing: createPackedTiming(count, 0, 0.05),
        visual: new Float32Array(count * 4),
    };
    addAttribute(system, 'aOrigin', system.origin, 3);
    addAttribute(system, 'aTiming', system.timing, 4);
    addAttribute(system, 'aVisual', system.visual, 4);
    system.geometry.instanceCount = count;

    if (isWebGPU) {
        const uTime = uniform(0);
        const uIntensity = uniform(1);
        const uMotion = uniform(1);
        const material = createNodeMaterial();
        material.vertexNode = Fn(() => {
            const origin = attribute('aOrigin', 'vec3');
            const timing = attribute('aTiming', 'vec4');
            const viewPosition = cameraViewMatrix.mul(vec4(origin, 1.0)).toVar();
            const offset = positionLocal.xy.mul(timing.z);
            viewPosition.x.addAssign(offset.x);
            viewPosition.y.addAssign(offset.y);
            return cameraProjectionMatrix.mul(viewPosition);
        })();
        const colorNode = Fn(() => {
            const timing = attribute('aTiming', 'vec4');
            const visual = attribute('aVisual', 'vec4');
            const age = uTime.sub(timing.x).mul(timing.y);
            const distance = length(positionLocal.xy);
            const radiusProgress = mix(
                float(0.72),
                age.clamp(0.0, 1.0),
                uMotion,
            );
            const ring = float(1.0).sub(
                smoothstep(0.0, timing.w, abs(distance.sub(radiusProgress))),
            );
            const fade = smoothstep(0.0, 0.08, age)
                .mul(float(1.0).sub(smoothstep(0.62, 1.0, age)));
            const brightness = ring.mul(fade).mul(visual.x)
                .mul(uIntensity).clamp(0.0, 2.0);
            return vec4(visual.yzw.mul(brightness), brightness.clamp(0.0, 1.0));
        })();
        material.colorNode = colorNode;
        material.emissiveNode = colorNode.rgb;
        system.material = material;
        system.timeNode = uTime;
        system.intensityNode = uIntensity;
        system.motionNode = uMotion;
    } else {
        system.material = createFallbackMaterial(`
            attribute vec3 aOrigin;
            attribute vec4 aTiming;
            attribute vec4 aVisual;
            uniform float uTime;
            varying vec2 vUv;
            varying float vAge;
            varying float vWidth;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                vUv = uv;
                vAge = (uTime - aTiming.x) * aTiming.y;
                vWidth = aTiming.w;
                vAlpha = aVisual.x;
                vColor = aVisual.yzw;
                vec4 viewPosition = viewMatrix * vec4(aOrigin, 1.0);
                viewPosition.xy += position.xy * aTiming.z;
                gl_Position = projectionMatrix * viewPosition;
            }
        `, `
            uniform float uIntensity;
            uniform float uMotion;
            varying vec2 vUv;
            varying float vAge;
            varying float vWidth;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                float distanceFromCenter = length(vUv * 2.0 - 1.0);
                float radiusProgress = mix(0.72, clamp(vAge, 0.0, 1.0), uMotion);
                float ring = 1.0 - smoothstep(
                    0.0,
                    vWidth,
                    abs(distanceFromCenter - radiusProgress)
                );
                float fade = smoothstep(0.0, 0.08, vAge)
                    * (1.0 - smoothstep(0.62, 1.0, vAge));
                float brightness = clamp(ring * fade * vAlpha * uIntensity, 0.0, 2.0);
                gl_FragColor = vec4(vColor * brightness, clamp(brightness, 0.0, 1.0));
            }
        `);
    }
    return finishSystem(system, 23);
}

function createNodeSystem(isWebGPU) {
    const count = MAX.nodes;
    const system = {
        name: 'SerenityWarpSpectrumNodes',
        geometry: createQuadGeometry(),
        attributes: [],
        state: createPoolState(count),
        origin: new Float32Array(count * 3),
        birth: new Float32Array(count),
        invLife: new Float32Array(count).fill(1),
        size: new Float32Array(count),
        alpha: new Float32Array(count),
        color: new Float32Array(count * 3),
        timing: createPackedTiming(count),
    };
    addAttribute(system, 'aOrigin', system.origin, 3);
    addAttribute(system, 'aTiming', system.timing, 4);
    addAttribute(system, 'aColor', system.color, 3);
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
            const animatedPulse = sin(age.mul(18.0)).mul(0.06).add(1.0);
            const pulse = mix(float(1.0), animatedPulse, uMotion);
            const viewPosition = cameraViewMatrix.mul(vec4(origin, 1.0)).toVar();
            const offset = positionLocal.xy.mul(timing.z.mul(pulse));
            viewPosition.x.addAssign(offset.x);
            viewPosition.y.addAssign(offset.y);
            return cameraProjectionMatrix.mul(viewPosition);
        })();
        const colorNode = Fn(() => {
            const timing = attribute('aTiming', 'vec4');
            const color = attribute('aColor', 'vec3');
            const age = uTime.sub(timing.x).mul(timing.y);
            const distance = length(uv().sub(0.5)).mul(2.0);
            const glow = exp(distance.mul(distance).mul(-3.8));
            const core = float(1.0).sub(smoothstep(0.0, 0.48, distance)).mul(0.75);
            const fade = smoothstep(0.0, 0.1, age)
                .mul(float(1.0).sub(smoothstep(0.66, 1.0, age)));
            const brightness = glow.add(core).mul(fade).mul(timing.w)
                .mul(uIntensity)
                .clamp(0.0, 2.0);
            return vec4(color.mul(brightness), brightness.clamp(0.0, 1.0));
        })();
        material.colorNode = colorNode;
        material.emissiveNode = colorNode.rgb;
        system.material = material;
        system.timeNode = uTime;
        system.intensityNode = uIntensity;
        system.motionNode = uMotion;
    } else {
        system.material = createFallbackMaterial(`
            attribute vec3 aOrigin;
            attribute vec4 aTiming;
            attribute vec3 aColor;
            uniform float uTime;
            uniform float uMotion;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                vUv = uv;
                vAge = (uTime - aTiming.x) * aTiming.y;
                vAlpha = aTiming.w;
                vColor = aColor;
                float animatedPulse = sin(clamp(vAge, 0.0, 1.0) * 18.0) * 0.06 + 1.0;
                float pulse = mix(1.0, animatedPulse, uMotion);
                vec4 viewPosition = viewMatrix * vec4(aOrigin, 1.0);
                viewPosition.xy += position.xy * aTiming.z * pulse;
                gl_Position = projectionMatrix * viewPosition;
            }
        `, `
            uniform float uIntensity;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                float distanceFromCenter = length(vUv - 0.5) * 2.0;
                float glow = exp(-3.8 * distanceFromCenter * distanceFromCenter);
                float core = (1.0 - smoothstep(0.0, 0.48, distanceFromCenter)) * 0.75;
                float fade = smoothstep(0.0, 0.1, vAge)
                    * (1.0 - smoothstep(0.66, 1.0, vAge));
                float brightness = clamp((glow + core) * fade
                    * vAlpha * uIntensity, 0.0, 2.0);
                gl_FragColor = vec4(vColor * brightness, clamp(brightness, 0.0, 1.0));
            }
        `);
    }
    return finishSystem(system, 26);
}

function createLinkSystem(isWebGPU) {
    const count = MAX.links;
    const system = {
        name: 'SerenityWarpSpectrumLinks',
        geometry: createQuadGeometry(0, 1),
        attributes: [],
        state: createPoolState(count),
        pointA: new Float32Array(count * 3),
        pointB: new Float32Array(count * 3),
        birth: new Float32Array(count),
        invLife: new Float32Array(count).fill(1),
        width: new Float32Array(count).fill(0.05),
        alpha: new Float32Array(count),
        color: new Float32Array(count * 3),
        timing: createPackedTiming(count, 0.05),
    };
    addAttribute(system, 'aPointA', system.pointA, 3);
    addAttribute(system, 'aPointB', system.pointB, 3);
    addAttribute(system, 'aTiming', system.timing, 4);
    addAttribute(system, 'aColor', system.color, 3);
    system.geometry.instanceCount = count;

    if (isWebGPU) {
        const uTime = uniform(0);
        const uIntensity = uniform(1);
        const uMotion = uniform(1);
        const material = createNodeMaterial();
        material.vertexNode = Fn(() => {
            const pointA = attribute('aPointA', 'vec3');
            const pointB = attribute('aPointB', 'vec3');
            const timing = attribute('aTiming', 'vec4');
            const age = uTime.sub(timing.x).mul(timing.y);
            const animatedReveal = smoothstep(0.0, 0.30, age);
            const reveal = mix(float(1.0), animatedReveal, uMotion);
            const direction = pointB.sub(pointA).toVar();
            const directionLength = length(direction);
            const directionNormal = direction.div(max(directionLength, float(EPSILON)));
            const perpendicular = vec3(directionNormal.y.negate(), directionNormal.x, 0.0);
            const along = positionLocal.y.mul(reveal);
            const worldPosition = pointA.add(direction.mul(along))
                .add(perpendicular.mul(positionLocal.x.mul(timing.z.mul(0.5))));
            return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldPosition, 1.0)));
        })();
        const colorNode = Fn(() => {
            const timing = attribute('aTiming', 'vec4');
            const color = attribute('aColor', 'vec3');
            const age = uTime.sub(timing.x).mul(timing.y);
            const across = abs(uv().x.sub(0.5)).mul(2.0);
            const line = float(1.0).sub(smoothstep(0.0, 1.0, across));
            const fade = smoothstep(0.0, 0.12, age)
                .mul(float(1.0).sub(smoothstep(0.62, 1.0, age)));
            const brightness = line.mul(fade).mul(timing.w)
                .mul(uIntensity).clamp(0.0, 1.7);
            return vec4(color.mul(brightness), brightness.clamp(0.0, 1.0));
        })();
        material.colorNode = colorNode;
        material.emissiveNode = colorNode.rgb;
        system.material = material;
        system.timeNode = uTime;
        system.intensityNode = uIntensity;
        system.motionNode = uMotion;
    } else {
        system.material = createFallbackMaterial(`
            attribute vec3 aPointA;
            attribute vec3 aPointB;
            attribute vec4 aTiming;
            attribute vec3 aColor;
            uniform float uTime;
            uniform float uMotion;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                vUv = uv;
                vAge = (uTime - aTiming.x) * aTiming.y;
                vAlpha = aTiming.w;
                vColor = aColor;
                float animatedReveal = smoothstep(0.0, 0.30, vAge);
                float reveal = mix(1.0, animatedReveal, uMotion);
                vec3 direction = aPointB - aPointA;
                float directionLength = length(direction);
                vec3 directionNormal = direction / max(directionLength, 0.0001);
                vec3 perpendicular = vec3(-directionNormal.y, directionNormal.x, 0.0);
                vec3 worldPosition = aPointA + direction * position.y * reveal
                    + perpendicular * position.x * aTiming.z * 0.5;
                gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
            }
        `, `
            uniform float uIntensity;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                float line = 1.0 - smoothstep(0.0, 1.0, abs(vUv.x - 0.5) * 2.0);
                float fade = smoothstep(0.0, 0.12, vAge)
                    * (1.0 - smoothstep(0.62, 1.0, vAge));
                float brightness = clamp(line * fade * vAlpha * uIntensity, 0.0, 1.7);
                gl_FragColor = vec4(vColor * brightness, clamp(brightness, 0.0, 1.0));
            }
        `);
    }
    return finishSystem(system, 25);
}

function createEllipseSystem(isWebGPU) {
    const count = MAX.ellipses;
    const system = {
        name: 'SerenityWarpSpectrumEllipses',
        geometry: createQuadGeometry(),
        attributes: [],
        state: createPoolState(count),
        origin: new Float32Array(count * 3),
        birth: new Float32Array(count),
        invLife: new Float32Array(count).fill(1),
        extent: new Float32Array(count * 2),
        width: new Float32Array(count).fill(0.05),
        alpha: new Float32Array(count),
        color: new Float32Array(count * 3),
        timing: createPackedTiming(count, 0.05),
    };
    addAttribute(system, 'aOrigin', system.origin, 3);
    addAttribute(system, 'aExtent', system.extent, 2);
    addAttribute(system, 'aTiming', system.timing, 4);
    addAttribute(system, 'aColor', system.color, 3);
    system.geometry.instanceCount = count;

    if (isWebGPU) {
        const uTime = uniform(0);
        const uIntensity = uniform(1);
        const uMotion = uniform(1);
        const material = createNodeMaterial();
        material.vertexNode = Fn(() => {
            const origin = attribute('aOrigin', 'vec3');
            const timing = attribute('aTiming', 'vec4');
            const extent = attribute('aExtent', 'vec2');
            const age = uTime.sub(timing.x).mul(timing.y).clamp(0.0, 1.0);
            const animatedScale = mix(
                float(0.76),
                float(1.12),
                smoothstep(0.0, 0.82, age),
            );
            const scale = mix(float(1.0), animatedScale, uMotion);
            const viewPosition = cameraViewMatrix.mul(vec4(origin, 1.0)).toVar();
            const offset = positionLocal.xy.mul(extent).mul(scale);
            viewPosition.x.addAssign(offset.x);
            viewPosition.y.addAssign(offset.y);
            return cameraProjectionMatrix.mul(viewPosition);
        })();
        const colorNode = Fn(() => {
            const timing = attribute('aTiming', 'vec4');
            const color = attribute('aColor', 'vec3');
            const age = uTime.sub(timing.x).mul(timing.y);
            const distance = length(positionLocal.xy);
            const ring = float(1.0).sub(
                smoothstep(0.0, timing.z, abs(distance.sub(0.82))),
            );
            const fade = smoothstep(0.0, 0.10, age)
                .mul(float(1.0).sub(smoothstep(0.68, 1.0, age)));
            const brightness = ring.mul(fade).mul(timing.w)
                .mul(uIntensity).clamp(0.0, 1.8);
            return vec4(color.mul(brightness), brightness.clamp(0.0, 1.0));
        })();
        material.colorNode = colorNode;
        material.emissiveNode = colorNode.rgb;
        system.material = material;
        system.timeNode = uTime;
        system.intensityNode = uIntensity;
        system.motionNode = uMotion;
    } else {
        system.material = createFallbackMaterial(`
            attribute vec3 aOrigin;
            attribute vec2 aExtent;
            attribute vec4 aTiming;
            attribute vec3 aColor;
            uniform float uTime;
            uniform float uMotion;
            varying vec2 vLocal;
            varying float vAge;
            varying float vWidth;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                vLocal = position.xy;
                vAge = (uTime - aTiming.x) * aTiming.y;
                vWidth = aTiming.z;
                vAlpha = aTiming.w;
                vColor = aColor;
                float animatedScale = mix(
                    0.76,
                    1.12,
                    smoothstep(0.0, 0.82, clamp(vAge, 0.0, 1.0))
                );
                float scale = mix(1.0, animatedScale, uMotion);
                vec4 viewPosition = viewMatrix * vec4(aOrigin, 1.0);
                viewPosition.xy += position.xy * aExtent * scale;
                gl_Position = projectionMatrix * viewPosition;
            }
        `, `
            uniform float uIntensity;
            varying vec2 vLocal;
            varying float vAge;
            varying float vWidth;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                float ring = 1.0 - smoothstep(0.0, vWidth, abs(length(vLocal) - 0.82));
                float fade = smoothstep(0.0, 0.10, vAge)
                    * (1.0 - smoothstep(0.68, 1.0, vAge));
                float brightness = clamp(ring * fade * vAlpha * uIntensity, 0.0, 1.8);
                gl_FragColor = vec4(vColor * brightness, clamp(brightness, 0.0, 1.0));
            }
        `);
    }
    return finishSystem(system, 24);
}

function createStreakSystem(isWebGPU) {
    const count = MAX.streaks;
    const system = {
        name: 'SerenityWarpSpectrumStreaks',
        geometry: createQuadGeometry(0, 1),
        attributes: [],
        state: createPoolState(count),
        pointA: new Float32Array(count * 3),
        pointB: new Float32Array(count * 3),
        birth: new Float32Array(count),
        invLife: new Float32Array(count).fill(1),
        width: new Float32Array(count).fill(0.05),
        alpha: new Float32Array(count),
        color: new Float32Array(count * 3),
        timing: createPackedTiming(count, 0.05),
    };
    addAttribute(system, 'aPointA', system.pointA, 3);
    addAttribute(system, 'aPointB', system.pointB, 3);
    addAttribute(system, 'aTiming', system.timing, 4);
    addAttribute(system, 'aColor', system.color, 3);
    system.geometry.instanceCount = count;

    if (isWebGPU) {
        const uTime = uniform(0);
        const uIntensity = uniform(1);
        const uMotion = uniform(1);
        const material = createNodeMaterial();
        material.vertexNode = Fn(() => {
            const pointA = attribute('aPointA', 'vec3');
            const pointB = attribute('aPointB', 'vec3');
            const timing = attribute('aTiming', 'vec4');
            const age = uTime.sub(timing.x).mul(timing.y).clamp(0.0, 1.0);
            const head = smoothstep(0.0, 0.82, age);
            const tail = max(head.sub(0.20), float(0.0));
            const along = mix(tail, head, positionLocal.y);
            const direction = pointB.sub(pointA).toVar();
            const directionLength = length(direction);
            const directionNormal = direction.div(max(directionLength, float(EPSILON)));
            const perpendicular = vec3(directionNormal.y.negate(), directionNormal.x, 0.0);
            const worldPosition = pointA.add(direction.mul(along))
                .add(perpendicular.mul(positionLocal.x.mul(timing.z.mul(0.5))));
            return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldPosition, 1.0)));
        })();
        const colorNode = Fn(() => {
            const timing = attribute('aTiming', 'vec4');
            const color = attribute('aColor', 'vec3');
            const age = uTime.sub(timing.x).mul(timing.y);
            const across = abs(uv().x.sub(0.5)).mul(2.0);
            const beam = float(1.0).sub(smoothstep(0.0, 1.0, across));
            const alongFade = smoothstep(0.0, 0.24, uv().y);
            const fade = smoothstep(0.0, 0.06, age)
                .mul(float(1.0).sub(smoothstep(0.72, 1.0, age)));
            const brightness = beam.mul(alongFade).mul(fade).mul(timing.w)
                .mul(uIntensity)
                .clamp(0.0, 1.5);
            return vec4(color.mul(brightness), brightness.clamp(0.0, 1.0));
        })();
        material.colorNode = colorNode;
        material.emissiveNode = colorNode.rgb;
        system.material = material;
        system.timeNode = uTime;
        system.intensityNode = uIntensity;
        system.motionNode = uMotion;
    } else {
        system.material = createFallbackMaterial(`
            attribute vec3 aPointA;
            attribute vec3 aPointB;
            attribute vec4 aTiming;
            attribute vec3 aColor;
            uniform float uTime;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                vUv = uv;
                vAge = (uTime - aTiming.x) * aTiming.y;
                vAlpha = aTiming.w;
                vColor = aColor;
                float age = clamp(vAge, 0.0, 1.0);
                float head = smoothstep(0.0, 0.82, age);
                float tail = max(head - 0.20, 0.0);
                float along = mix(tail, head, position.y);
                vec3 direction = aPointB - aPointA;
                float directionLength = length(direction);
                vec3 directionNormal = direction / max(directionLength, 0.0001);
                vec3 perpendicular = vec3(-directionNormal.y, directionNormal.x, 0.0);
                vec3 worldPosition = aPointA + direction * along
                    + perpendicular * position.x * aTiming.z * 0.5;
                gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
            }
        `, `
            uniform float uIntensity;
            varying vec2 vUv;
            varying float vAge;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                float beam = 1.0 - smoothstep(0.0, 1.0, abs(vUv.x - 0.5) * 2.0);
                float alongFade = smoothstep(0.0, 0.24, vUv.y);
                float fade = smoothstep(0.0, 0.06, vAge)
                    * (1.0 - smoothstep(0.72, 1.0, vAge));
                float brightness = clamp(beam * alongFade * fade
                    * vAlpha * uIntensity, 0.0, 1.5);
                gl_FragColor = vec4(vColor * brightness, clamp(brightness, 0.0, 1.0));
            }
        `);
    }
    return finishSystem(system, 25);
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
        r: 1,
        g: 1,
        b: 1,
        intensity: 1,
        life: 1,
        size: 1,
        radiusX: 1,
        radiusY: 1,
        width: 0.08,
        alpha: 1,
        count: 0,
        tier: 1,
        phase: 0,
        gateVariant: GATE_STANDARD,
        stage: STAGE_ECHO,
        cells: new Float32Array(CELLS_PER_SEAL * 2),
    };
}

/**
 * Renderer-only command sink. The caller owns gameplay event interpretation and
 * world/screen mapping; convenience aliases are supplied for common commands.
 */
export class SerenityWarpGameplayFX {
    constructor({
        scene,
        camera,
        isWebGPU = true,
        quality = 'High',
        reducedMotion = false,
        intensity = 1,
        effectPlaneZ = 4,
    } = {}) {
        if (!scene || !camera) {
            throw new Error('SerenityWarpGameplayFX requires a scene and camera');
        }
        this.scene = scene;
        this.camera = camera;
        this.isWebGPU = isWebGPU === true;
        this.quality = normalizeQuality(quality);
        this.limits = SERENITY_WARP_GAMEPLAY_FX_LIMITS[this.quality];
        this.reducedMotion = reducedMotion === true;
        this.intensity = clamp(finiteOr(intensity, 1), 0, 2);
        this.effectPlaneZ = finiteOr(effectPlaneZ, 4);
        this.time = 0;
        this.initialized = false;
        this.disposed = false;
        this.commandSerial = 0;
        this.activeCount = 0;
        this.colorScratch = new THREE.Color();
        this.projectPointScratch = new THREE.Vector3();
        this.projectNdcScratch = new THREE.Vector2();
        this.projectRaycaster = new THREE.Raycaster();
        this.projectPlane = new THREE.Plane(
            new THREE.Vector3(0, 0, 1),
            -this.effectPlaneZ,
        );
        this.gateNodeXScratch = new Float32Array(7);
        this.gateNodeYScratch = new Float32Array(7);
        this.warmupPending = true;
        this.warmupFinalized = false;

        this.commands = new Array(MAX_COMMANDS);
        for (let index = 0; index < MAX_COMMANDS; index += 1) {
            this.commands[index] = createCommand();
        }

        this.group = new THREE.Group();
        this.group.name = 'SerenityWarpGameplayFX';
        this.group.userData.isSerenityWarpGameplayFX = true;
        this.group.matrixAutoUpdate = false;
        this.group.visible = false;

        this.phaseSeals = createPhaseSealSystem(this.isWebGPU);
        this.rings = createRingSystem(this.isWebGPU);
        this.nodes = createNodeSystem(this.isWebGPU);
        this.links = createLinkSystem(this.isWebGPU);
        this.ellipses = createEllipseSystem(this.isWebGPU);
        this.streaks = createStreakSystem(this.isWebGPU);
        this.systems = [
            this.phaseSeals,
            this.rings,
            this.nodes,
            this.links,
            this.ellipses,
            this.streaks,
        ];
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
        this._armCompileWarmup();
        return this;
    }

    setQuality(quality) {
        const normalized = normalizeQuality(quality);
        if (normalized === this.quality) return;
        this.quality = normalized;
        this.limits = SERENITY_WARP_GAMEPLAY_FX_LIMITS[normalized];
        this._applyInstanceBudgets();
        this._trimOutsideBudgets();
        this._refreshVisibility();
    }

    setReducedMotion(enabled) {
        this.reducedMotion = enabled === true;
        if (this.reducedMotion) {
            this._deactivateSystem(this.streaks);
            this._shortenForReducedMotion();
        }
        this._applyInstanceBudgets();
        this._refreshVisibility();
        const motion = this.reducedMotion ? 0 : 1;
        const masterIntensity = this.intensity * (this.reducedMotion ? 0.58 : 1);
        for (let index = 0; index < this.systems.length; index += 1) {
            setSystemTime(this.systems[index], this.time, masterIntensity, motion);
        }
    }

    setIntensity(intensity) {
        this.intensity = clamp(finiteOr(intensity, 1), 0, 2);
        this._refreshVisibility();
        const masterIntensity = this.intensity * (this.reducedMotion ? 0.58 : 1);
        for (let index = 0; index < this.systems.length; index += 1) {
            setSystemTime(
                this.systems[index],
                this.time,
                masterIntensity,
                this.reducedMotion ? 0 : 1,
            );
        }
    }

    /**
     * Generic controller entry point. Explicit renderer commands are preferred;
     * gameplay aliases exist to keep integration terse.
     */
    trigger(kind, options = {}) {
        if (this.disposed) return false;
        const command = String(kind || '').replace(/[\s_-]/g, '').toLowerCase();
        switch (command) {
        case 'phaseseal':
        case 'lockseal':
        case 'piecelock': {
            const sealQueued = this.spawnPhaseSeal(options);
            const ringQueued = options.ringCount === 0
                ? false
                : this._spawnPhaseSealRing(options);
            return sealQueued || ringQueued;
        }
        case 'ring':
        case 'sealring':
            return this.spawnRing(options);
        case 'spectrumgate':
        case 'gate':
        case 'combo':
            return this.spawnSpectrumGate(options);
        case 'mobiustwist':
        case 'tspin':
            return this.spawnMobiusTwist(options);
        case 'perfectclear':
            return this.spawnPerfectClear(options);
        case 'b2becho':
            return this.spawnB2BEcho(options);
        case 'streaks':
        case 'streakburst':
            return this.spawnStreaks(options);
        case 'lineclear':
            return this.spawnRing(options);
        default:
            return false;
        }
    }

    enqueue(command) {
        if (!command || typeof command !== 'object') return false;
        return this.trigger(command.type || command.kind, command);
    }

    spawnPhaseSeal(options = {}) {
        const command = this._claimCommand(COMMAND_PHASE_SEAL, this._readDelaySeconds(options));
        if (!command) return false;
        this._readOrigin(command, options);
        const pieceType = this._readPieceType(options);
        this._readColor(
            command,
            options.glyph?.color ?? options.color,
            PIECE_COLORS[pieceType] || PIECE_COLORS.T,
        );
        this._readShape(command.cells, options, pieceType);
        command.life = this._readLifeSeconds(options, 0.55, 0.12, 3);
        if (this.reducedMotion || options.reducedMotion === true) {
            command.life = Math.min(command.life, 0.18);
        }
        command.size = clamp(
            finiteOr(options.cellSize ?? options.size, DEFAULT_SEAL_CELL_SIZE),
            0.12,
            8,
        );
        command.alpha = clamp(finiteOr(options.alpha, 0.92), 0, 2);
        command.intensity = clamp(finiteOr(options.intensity, 1), 0, 2);
        return true;
    }

    spawnRing(options = {}) {
        const command = this._claimCommand(COMMAND_RING, this._readDelaySeconds(options));
        if (!command) return false;
        this._readOrigin(command, options);
        const pieceType = this._readPieceType(options);
        this._readColor(
            command,
            options.glyph?.color ?? options.color,
            PIECE_COLORS[pieceType] || 0x7befff,
        );
        command.life = this._readLifeSeconds(options, 0.62, 0.10, 3);
        if (this.reducedMotion || options.reducedMotion === true) {
            command.life = Math.min(command.life, 0.18);
        }
        const lineCount = clamp(Math.floor(finiteOr(options.lineCount, 1)), 1, 4);
        command.size = clamp(
            finiteOr(options.radius ?? options.size, 3.1 + (lineCount - 1) * 0.52),
            0.2,
            30,
        );
        command.width = clamp(finiteOr(options.width, 0.055), 0.008, 0.35);
        command.alpha = clamp(finiteOr(options.alpha, 0.72), 0, 2);
        command.intensity = clamp(finiteOr(options.intensity, 1), 0, 2);
        return true;
    }

    spawnSpectrumGate(options = {}) {
        return this._spawnGate(options, GATE_STANDARD);
    }

    spawnMobiusTwist(options = {}) {
        return this._spawnGate(options, GATE_MOBIUS);
    }

    spawnPerfectClear(options = {}) {
        return this._spawnGate(options, GATE_PERFECT_CLEAR);
    }

    spawnB2BEcho(options = {}) {
        const delay = this._readDelaySeconds(options);
        const command = this._claimCommand(COMMAND_RING, delay);
        if (!command) return false;
        this._readOrigin(command, options);
        this._readColor(command, options.color, 0xb994ff);
        command.life = Math.max(
            0.10,
            this._readLifeSeconds(options, 0.62, 0.10, 1.5) - delay,
        );
        if (this.reducedMotion || options.reducedMotion === true) {
            command.life = Math.min(command.life, 0.18);
        }
        command.size = clamp(finiteOr(options.radius ?? options.size, 4.0), 0.2, 30);
        command.width = clamp(finiteOr(options.width, 0.038), 0.008, 0.35);
        command.alpha = clamp(finiteOr(options.alpha, 0.58), 0, 2);
        command.intensity = clamp(finiteOr(options.intensity, 1), 0, 2);
        return true;
    }

    _spawnGate(options, gateVariant) {
        const command = this._claimCommand(COMMAND_GATE, this._readDelaySeconds(options));
        if (!command) return false;
        this._readOrigin(command, options);
        this._readColor(command, options.color, 0x8beeff);
        const comboCount = finiteOr(options.comboCount ?? options.count, 1);
        command.gateVariant = gateVariant;
        command.stage = gateVariant === GATE_PERFECT_CLEAR
            ? STAGE_SEVENFOLD
            : this._readGateStage(options, comboCount);
        if (gateVariant === GATE_MOBIUS) command.stage = STAGE_APERTURE;
        command.tier = command.stage;
        const defaultNodeCount = command.stage === STAGE_CONSTELLATION ? 5 : 7;
        command.count = clamp(Math.floor(finiteOr(options.nodeCount, defaultNodeCount)), 3, 7);
        command.life = this._readLifeSeconds(options, 1.55 + command.tier * 0.12, 0.20, 5);
        if (this.reducedMotion || options.reducedMotion === true) {
            command.life = Math.min(command.life, 0.26);
        }
        // Hero scale: bigger with tier (sevenfold is the rare crescendo), and rounder than
        // the old flat 0.62 ellipse that read as a "roulette wheel" seen at an angle.
        command.radiusX = clamp(
            finiteOr(options.radiusX ?? options.radius, 4.6 + command.tier * 0.9),
            0.4,
            40,
        );
        command.radiusY = clamp(finiteOr(options.radiusY, command.radiusX * 0.78), 0.3, 40);
        command.width = clamp(finiteOr(options.width, 0.07), 0.008, 0.30);
        command.alpha = clamp(finiteOr(options.alpha, 0.86), 0, 2);
        command.intensity = clamp(finiteOr(options.intensity, 1), 0, 2);
        command.phase = finiteOr(options.phase, (this.commandSerial * 0.754877666) % TAU);
        return true;
    }

    spawnStreaks(options = {}) {
        const command = this._claimCommand(COMMAND_STREAKS, this._readDelaySeconds(options));
        if (!command) return false;
        this._readOrigin(command, options);
        this._readColor(command, options.color, 0x8beeff);
        command.count = clamp(Math.floor(finiteOr(options.count, 14)), 0, MAX.streaks);
        command.life = this._readLifeSeconds(options, 0.82, 0.12, 3);
        command.radiusX = clamp(finiteOr(options.radiusX ?? options.radius, 5.6), 0.4, 40);
        command.radiusY = clamp(finiteOr(options.radiusY, command.radiusX * 0.7), 0.3, 40);
        command.width = clamp(finiteOr(options.width, 0.10), 0.01, 0.8);
        command.alpha = clamp(finiteOr(options.alpha, 0.58), 0, 2);
        command.intensity = clamp(finiteOr(options.intensity, 1), 0, 2);
        command.phase = finiteOr(options.phase, (this.commandSerial * 1.324717957) % TAU);
        return true;
    }

    /**
     * Advance from the caller's authoritative elapsed time. Delta is accepted
     * for a uniform controller signature but is intentionally not integrated.
     */
    update(time) {
        if (this.disposed || !this.initialized) return false;
        const authoritativeTime = finiteOr(time, this.time);
        this.time = Math.max(this.time, authoritativeTime);
        this._flushCommands(this.time);
        this._expireSystems(this.time);

        // Keep every zero-alpha pool visible for exactly one rendered frame so
        // both WebGPU pipelines and conventional WebGL programs compile before
        // the first gameplay event. The following frame restores idle gating.
        if (this.warmupPending) {
            const motionScale = this.reducedMotion ? 0.58 : 1;
            const warmupIntensity = this.activeCount > 0
                ? this.intensity * motionScale
                : 0;
            for (let index = 0; index < this.systems.length; index += 1) {
                this.systems[index].mesh.visible = true;
                setSystemTime(
                    this.systems[index],
                    this.time,
                    warmupIntensity,
                    this.reducedMotion ? 0 : 1,
                );
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

        const motionScale = this.reducedMotion ? 0.58 : 1;
        const masterIntensity = this.intensity * motionScale;
        this.group.visible = masterIntensity > EPSILON;
        for (let index = 0; index < this.systems.length; index += 1) {
            const system = this.systems[index];
            if (system.mesh.visible) {
                setSystemTime(
                    system,
                    this.time,
                    masterIntensity,
                    this.reducedMotion ? 0 : 1,
                );
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

    /**
     * Temporarily reveals every material to compileAsync without making pixels.
     */
    prepareForCompile() {
        if (this.disposed) return () => {};
        const priorGroupVisible = this.group.visible;
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
            this.group.visible = priorGroupVisible || this.activeCount > 0;
            this._refreshVisibility();
        };
    }

    getDebugState() {
        return {
            quality: this.quality,
            reducedMotion: this.reducedMotion,
            intensity: this.intensity,
            activeEffects: this.activeCount,
            pendingCommands: this._countPendingCommands(),
            backend: this.isWebGPU ? 'webgpu' : 'webgl',
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene.remove(this.group);
        for (let index = 0; index < this.systems.length; index += 1) {
            const system = this.systems[index];
            system.geometry.dispose();
            system.material.dispose();
        }
        this.group.clear();
        for (let index = 0; index < this.commands.length; index += 1) {
            this.commands[index].active = false;
        }
        this.activeCount = 0;
        this.initialized = false;
    }

    _spawnPhaseSealRing(options) {
        const envelope = options.envelope || null;
        const baseDelay = this._readDelaySeconds(options);
        const ringStart = finiteOr(envelope?.ringStartMs, 40) / 1000;
        const ringEnd = finiteOr(envelope?.ringEndMs, 280) / 1000;
        const command = this._claimCommand(COMMAND_RING, baseDelay + ringStart);
        if (!command) return false;
        this._readOrigin(command, options);
        const pieceType = this._readPieceType(options);
        this._readColor(
            command,
            options.glyph?.color ?? options.color,
            PIECE_COLORS[pieceType] || 0x7befff,
        );
        command.life = clamp(Math.max(0.10, ringEnd - ringStart), 0.10, 1.5);
        if (this.reducedMotion || options.reducedMotion === true) {
            command.life = Math.min(command.life, 0.16);
        }
        const cellSize = finiteOr(options.cellSize ?? options.size, DEFAULT_SEAL_CELL_SIZE);
        command.size = clamp(finiteOr(options.ringRadius, cellSize * 2.2), 0.2, 30);
        command.width = clamp(finiteOr(options.ringWidth ?? options.width, 0.048), 0.008, 0.35);
        command.alpha = clamp(finiteOr(options.ringAlpha ?? options.alpha, 0.68), 0, 2);
        command.intensity = clamp(finiteOr(options.intensity, 1), 0, 2);
        return true;
    }

    _readDelaySeconds(options) {
        if (Number.isFinite(options.delay)) return clamp(options.delay, 0, 10);
        return clamp(finiteOr(options.delayMs, 0) / 1000, 0, 10);
    }

    _readLifeSeconds(options, fallback, minimum, maximum) {
        const life = Number.isFinite(options.life)
            ? options.life
            : finiteOr(options.durationMs, fallback * 1000) / 1000;
        return clamp(life, minimum, maximum);
    }

    _readGateStage(options, comboCount) {
        const stage = String(options.stage || '').toLowerCase();
        if (stage === 'echo') return STAGE_ECHO;
        if (stage === 'constellation') return STAGE_CONSTELLATION;
        if (stage === 'aperture') return STAGE_APERTURE;
        if (stage === 'sevenfold') return STAGE_SEVENFOLD;
        const milestone = finiteOr(options.milestone, comboCount);
        if (milestone >= 10) return STAGE_SEVENFOLD;
        if (milestone >= 6) return STAGE_APERTURE;
        if (milestone >= 3) return STAGE_CONSTELLATION;
        return STAGE_ECHO;
    }

    _claimCommand(type, delay) {
        if (this.disposed || this.intensity <= EPSILON) return null;
        let candidate = null;
        let oldestSerial = Number.POSITIVE_INFINITY;
        for (let index = 0; index < this.commands.length; index += 1) {
            const command = this.commands[index];
            if (!command.active) {
                candidate = command;
                break;
            }
            if (command.serial < oldestSerial) {
                oldestSerial = command.serial;
                candidate = command;
            }
        }
        if (!candidate) return null;
        candidate.active = true;
        candidate.type = type;
        candidate.serial = ++this.commandSerial;
        candidate.dueTime = this.time + clamp(finiteOr(delay, 0), 0, 10);
        return candidate;
    }

    _readOrigin(command, options) {
        const origin = options.origin || null;
        let world = options.worldOrigin || null;
        if (!world && origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
            world = origin;
        }
        if (!world && Number.isFinite(options.x) && Number.isFinite(options.y)) world = options;
        if (world && Number.isFinite(world.x) && Number.isFinite(world.y)) {
            command.x = world.x;
            command.y = world.y;
            command.z = finiteOr(world.z, finiteOr(options.z, this.effectPlaneZ));
            return;
        }

        const normalized = origin?.sideLane?.normalized || origin?.normalized;
        if (normalized && Number.isFinite(normalized.x) && Number.isFinite(normalized.y)) {
            this._projectNormalizedOrigin(command, normalized.x, normalized.y);
            return;
        }

        world = origin?.position || options.position || null;
        if (world && Number.isFinite(world.x) && Number.isFinite(world.y)) {
            command.x = world.x;
            command.y = world.y;
            command.z = finiteOr(world.z, this.effectPlaneZ);
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
        const intersection = this.projectRaycaster.ray.intersectPlane(
            this.projectPlane,
            this.projectPointScratch,
        );
        if (intersection) {
            command.x = intersection.x;
            command.y = intersection.y;
            command.z = intersection.z;
            return;
        }
        command.x = this.projectNdcScratch.x * 8;
        command.y = this.projectNdcScratch.y * 5;
        command.z = this.effectPlaneZ;
    }

    _readColor(command, value, fallback) {
        if (Array.isArray(value) || ArrayBuffer.isView(value)) {
            command.r = clamp(finiteOr(value[0], 1), 0, 8);
            command.g = clamp(finiteOr(value[1], 1), 0, 8);
            command.b = clamp(finiteOr(value[2], 1), 0, 8);
            return;
        }
        if (value && typeof value === 'object'
            && Number.isFinite(value.r) && Number.isFinite(value.g) && Number.isFinite(value.b)) {
            command.r = clamp(value.r, 0, 8);
            command.g = clamp(value.g, 0, 8);
            command.b = clamp(value.b, 0, 8);
            return;
        }
        try {
            this.colorScratch.set(value ?? fallback);
        } catch {
            this.colorScratch.set(fallback);
        }
        command.r = this.colorScratch.r;
        command.g = this.colorScratch.g;
        command.b = this.colorScratch.b;
    }

    _readPieceType(options) {
        const piece = options.glyph || options.piece || options;
        return String(
            options.glyph?.type || options.shapeKey || options.pieceType || options.typeKey
            || piece.shapeKey || piece.type || 'T',
        ).toUpperCase();
    }

    _readShape(target, options, pieceType) {
        const cells = options.glyph?.cells || options.cells;
        const invertCellY = Boolean(options.glyph?.cells);
        let written = 0;
        let sumX = 0;
        let sumY = 0;
        if (cells && typeof cells.length === 'number') {
            if (cells.length >= CELLS_PER_SEAL * 2 && typeof cells[0] === 'number') {
                for (let index = 0; index < CELLS_PER_SEAL; index += 1) {
                    const x = finiteOr(cells[index * 2], 0);
                    const sourceY = finiteOr(cells[index * 2 + 1], 0);
                    const y = invertCellY ? -sourceY : sourceY;
                    target[index * 2] = x;
                    target[index * 2 + 1] = y;
                    sumX += x;
                    sumY += y;
                }
                written = CELLS_PER_SEAL;
            } else if (cells.length >= CELLS_PER_SEAL && cells[0]) {
                for (let index = 0; index < cells.length && written < CELLS_PER_SEAL; index += 1) {
                    const cell = cells[index];
                    const x = finiteOr(cell?.x ?? cell?.[0], 0);
                    const sourceY = finiteOr(cell?.y ?? cell?.[1], 0);
                    const y = invertCellY ? -sourceY : sourceY;
                    target[written * 2] = x;
                    target[written * 2 + 1] = y;
                    sumX += x;
                    sumY += y;
                    written += 1;
                }
            }
        }

        const matrix = options.glyph?.shape || options.shape || options.piece?.shape;
        if (written !== CELLS_PER_SEAL && Array.isArray(matrix)) {
            written = 0;
            sumX = 0;
            sumY = 0;
            for (let row = 0; row < matrix.length && written < CELLS_PER_SEAL; row += 1) {
                const matrixRow = matrix[row];
                if (!matrixRow || typeof matrixRow.length !== 'number') continue;
                for (let column = 0;
                    column < matrixRow.length && written < CELLS_PER_SEAL;
                    column += 1) {
                    if (!matrixRow[column]) continue;
                    target[written * 2] = column;
                    target[written * 2 + 1] = -row;
                    sumX += column;
                    sumY -= row;
                    written += 1;
                }
            }
        }

        if (written !== CELLS_PER_SEAL) {
            const preset = SHAPE_CELLS[pieceType] || SHAPE_CELLS.T;
            sumX = 0;
            sumY = 0;
            for (let index = 0; index < CELLS_PER_SEAL; index += 1) {
                const x = preset[index * 2];
                const y = preset[index * 2 + 1];
                target[index * 2] = x;
                target[index * 2 + 1] = y;
                sumX += x;
                sumY += y;
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
            const birthTime = command.dueTime;
            switch (command.type) {
            case COMMAND_PHASE_SEAL:
                this._stampPhaseSeal(command, birthTime);
                break;
            case COMMAND_RING:
                this._stampRing(command, birthTime);
                break;
            case COMMAND_GATE:
                this._stampGate(command, birthTime);
                break;
            case COMMAND_STREAKS:
                this._stampStreaks(command, birthTime);
                break;
            default:
                break;
            }
            command.active = false;
        }
    }

    _acquireSlot(system, limit, time) {
        if (limit <= 0) return -1;
        let candidate = -1;
        let soonestEnd = Number.POSITIVE_INFINITY;
        for (let index = 0; index < limit; index += 1) {
            if (!system.state.active[index] || system.state.end[index] <= time) return index;
            if (system.state.end[index] < soonestEnd) {
                soonestEnd = system.state.end[index];
                candidate = index;
            }
        }
        return candidate;
    }

    _activateSlot(system, slot, endTime) {
        if (!system.state.active[slot]) this.activeCount += 1;
        system.state.active[slot] = 1;
        system.state.end[slot] = endTime;
        system.mesh.visible = true;
    }

    _stampPhaseSeal(command, time) {
        const system = this.phaseSeals;
        const slot = this._acquireSlot(system, this.limits.seals, time);
        if (slot < 0) return;
        const inverseLife = 1 / command.life;
        for (let cellIndex = 0; cellIndex < CELLS_PER_SEAL; cellIndex += 1) {
            const instance = slot * CELLS_PER_SEAL + cellIndex;
            const originOffset = instance * 3;
            const cellOffset = instance * 2;
            system.origin[originOffset] = command.x;
            system.origin[originOffset + 1] = command.y;
            system.origin[originOffset + 2] = command.z;
            system.cell[cellOffset] = command.cells[cellIndex * 2];
            system.cell[cellOffset + 1] = command.cells[cellIndex * 2 + 1];
            system.birth[instance] = time;
            system.invLife[instance] = inverseLife;
            system.size[instance] = command.size;
            system.alpha[instance] = command.alpha * command.intensity;
            system.color[originOffset] = command.r;
            system.color[originOffset + 1] = command.g;
            system.color[originOffset + 2] = command.b;
            writePackedTiming(
                system,
                instance,
                system.birth[instance],
                system.invLife[instance],
                system.size[instance],
                system.alpha[instance],
            );
        }
        this._activateSlot(system, slot, time + command.life);
        markAttributes(system);
    }

    _stampRing(command, time) {
        const system = this.rings;
        const slot = this._acquireSlot(system, this.limits.rings, time);
        if (slot < 0) return;
        const offset = slot * 3;
        system.origin[offset] = command.x;
        system.origin[offset + 1] = command.y;
        system.origin[offset + 2] = command.z;
        system.birth[slot] = time;
        system.invLife[slot] = 1 / command.life;
        system.radius[slot] = command.size;
        system.width[slot] = command.width;
        system.alpha[slot] = command.alpha * command.intensity;
        system.color[offset] = command.r;
        system.color[offset + 1] = command.g;
        system.color[offset + 2] = command.b;
        writePackedTiming(
            system,
            slot,
            system.birth[slot],
            system.invLife[slot],
            system.radius[slot],
            system.width[slot],
        );
        writePackedVisual(
            system,
            slot,
            system.alpha[slot],
            system.color[offset],
            system.color[offset + 1],
            system.color[offset + 2],
        );
        this._activateSlot(system, slot, time + command.life);
        markAttributes(system);
    }

    _stampGate(command, time) {
        const reducedScale = this.reducedMotion ? 0.72 : 1;
        const radiusX = command.radiusX * reducedScale;
        const radiusY = command.radiusY * reducedScale;
        const life = this.reducedMotion ? Math.min(command.life, 0.26) : command.life;
        const isMobius = command.gateVariant === GATE_MOBIUS;
        const isPerfectClear = command.gateVariant === GATE_PERFECT_CLEAR;
        const { stage } = command;

        if (stage === STAGE_ECHO && !isMobius && !isPerfectClear) {
            this._stampGateRing(command, time, radiusX * 0.92, life, 0.72);
            return;
        }

        const emitConstellation = stage === STAGE_CONSTELLATION
            || stage === STAGE_SEVENFOLD || isMobius || isPerfectClear;
        const emitAperture = stage === STAGE_APERTURE
            || stage === STAGE_SEVENFOLD || isMobius || isPerfectClear;
        const nodeCount = emitConstellation
            ? Math.min(command.count, this.limits.nodes)
            : 0;
        const nodeX = this.gateNodeXScratch;
        const nodeY = this.gateNodeYScratch;

        for (let index = 0; index < nodeCount; index += 1) {
            const angle = command.phase + (index * TAU) / nodeCount;
            const x = command.x + Math.cos(angle) * radiusX;
            const y = command.y + Math.sin(angle) * radiusY;
            nodeX[index] = x;
            nodeY[index] = y;
            this._stampNode(x, y, command.z, index, command, life, time);
        }

        const linkCount = emitConstellation ? Math.min(nodeCount, this.limits.links) : 0;
        for (let index = 0; index < linkCount; index += 1) {
            const linkStep = isMobius ? 2 : 1;
            const next = (index + linkStep) % nodeCount;
            this._stampLink(
                nodeX[index],
                nodeY[index],
                command.z,
                nodeX[next],
                nodeY[next],
                command.z,
                index,
                command,
                life,
                time,
            );
        }

        let requestedEllipses = 0;
        if (emitAperture) requestedEllipses = stage === STAGE_SEVENFOLD ? 3 : 2;
        if (isMobius) requestedEllipses = 2;
        const ellipseCount = Math.min(requestedEllipses, this.limits.ellipses);
        for (let index = 0; index < ellipseCount; index += 1) {
            this._stampEllipse(index, command, radiusX, radiusY, life, time);
        }

        if (emitAperture && !this.reducedMotion && this.limits.streaks > 0) {
            let requested = stage === STAGE_SEVENFOLD ? 16 : 8;
            if (isMobius) requested = 8;
            if (isPerfectClear) requested = 20;
            this._stampStreakBatch(
                command,
                Math.min(requested, this.limits.streaks),
                radiusX * 1.55,
                radiusY * 1.55,
                Math.min(life * 0.62, 1.05),
                time,
            );
        }

        if (isPerfectClear) {
            this._stampGateRing(command, time, radiusX * 1.16, life, 0.88);
        }
    }

    _stampGateRing(command, time, radius, life, alphaScale) {
        const system = this.rings;
        const slot = this._acquireSlot(system, this.limits.rings, time);
        if (slot < 0) return;
        const offset = slot * 3;
        system.origin[offset] = command.x;
        system.origin[offset + 1] = command.y;
        system.origin[offset + 2] = command.z;
        system.birth[slot] = time;
        system.invLife[slot] = 1 / life;
        system.radius[slot] = radius;
        system.width[slot] = command.width;
        system.alpha[slot] = command.alpha * command.intensity * alphaScale;
        system.color[offset] = command.r;
        system.color[offset + 1] = command.g;
        system.color[offset + 2] = command.b;
        writePackedTiming(
            system,
            slot,
            system.birth[slot],
            system.invLife[slot],
            system.radius[slot],
            system.width[slot],
        );
        writePackedVisual(
            system,
            slot,
            system.alpha[slot],
            system.color[offset],
            system.color[offset + 1],
            system.color[offset + 2],
        );
        this._activateSlot(system, slot, time + life);
        markAttributes(system);
    }

    _stampNode(x, y, z, spectrumIndex, command, life, time) {
        const system = this.nodes;
        const slot = this._acquireSlot(system, this.limits.nodes, time);
        if (slot < 0) return;
        const offset = slot * 3;
        const colorIndex = command.gateVariant === GATE_MOBIUS
            ? SPECTRUM.length - 1 - (spectrumIndex % SPECTRUM.length)
            : spectrumIndex % SPECTRUM.length;
        const color = SPECTRUM[colorIndex];
        system.origin[offset] = x;
        system.origin[offset + 1] = y;
        system.origin[offset + 2] = z;
        system.birth[slot] = time;
        system.invLife[slot] = 1 / life;
        system.size[slot] = 0.55 + command.tier * 0.09;
        system.alpha[slot] = command.alpha * command.intensity;
        system.color[offset] = color[0];
        system.color[offset + 1] = color[1];
        system.color[offset + 2] = color[2];
        writePackedTiming(
            system,
            slot,
            system.birth[slot],
            system.invLife[slot],
            system.size[slot],
            system.alpha[slot],
        );
        this._activateSlot(system, slot, time + life);
        markAttributes(system);
    }

    _stampLink(ax, ay, az, bx, by, bz, spectrumIndex, command, life, time) {
        const system = this.links;
        const slot = this._acquireSlot(system, this.limits.links, time);
        if (slot < 0) return;
        const offset = slot * 3;
        const colorOffset = command.gateVariant === GATE_MOBIUS ? 2 : 5;
        const color = SPECTRUM[(spectrumIndex + colorOffset) % SPECTRUM.length];
        system.pointA[offset] = ax;
        system.pointA[offset + 1] = ay;
        system.pointA[offset + 2] = az;
        system.pointB[offset] = bx;
        system.pointB[offset + 1] = by;
        system.pointB[offset + 2] = bz;
        system.birth[slot] = time;
        system.invLife[slot] = 1 / life;
        system.width[slot] = command.width * (1.8 + command.tier * 0.1);
        system.alpha[slot] = command.alpha * command.intensity * 0.66;
        system.color[offset] = color[0] * 0.78 + 0.22;
        system.color[offset + 1] = color[1] * 0.78 + 0.22;
        system.color[offset + 2] = color[2] * 0.78 + 0.22;
        writePackedTiming(
            system,
            slot,
            system.birth[slot],
            system.invLife[slot],
            system.width[slot],
            system.alpha[slot],
        );
        this._activateSlot(system, slot, time + life);
        markAttributes(system);
    }

    _stampEllipse(index, command, radiusX, radiusY, life, time) {
        const system = this.ellipses;
        const slot = this._acquireSlot(system, this.limits.ellipses, time);
        if (slot < 0) return;
        const offset = slot * 3;
        const extentOffset = slot * 2;
        const color = SPECTRUM[(index * 2 + command.tier) % SPECTRUM.length];
        const scale = 0.82 + index * 0.16;
        system.origin[offset] = command.x;
        system.origin[offset + 1] = command.y;
        system.origin[offset + 2] = command.z;
        system.birth[slot] = time + index * 0.045;
        system.invLife[slot] = 1 / life;
        const crossMobiusAxes = command.gateVariant === GATE_MOBIUS && index % 2 === 1;
        system.extent[extentOffset] = (crossMobiusAxes ? radiusY : radiusX) * scale;
        system.extent[extentOffset + 1] = (crossMobiusAxes ? radiusX : radiusY) * scale;
        system.width[slot] = command.width * (1 - index * 0.08);
        system.alpha[slot] = command.alpha * command.intensity * (0.64 - index * 0.08);
        system.color[offset] = color[0];
        system.color[offset + 1] = color[1];
        system.color[offset + 2] = color[2];
        writePackedTiming(
            system,
            slot,
            system.birth[slot],
            system.invLife[slot],
            system.width[slot],
            system.alpha[slot],
        );
        this._activateSlot(system, slot, time + life + index * 0.045);
        markAttributes(system);
    }

    _stampStreaks(command, time) {
        if (this.reducedMotion || this.limits.streaks <= 0) return;
        this._stampStreakBatch(
            command,
            Math.min(command.count, this.limits.streaks),
            command.radiusX,
            command.radiusY,
            command.life,
            time,
        );
    }

    _stampStreakBatch(command, count, radiusX, radiusY, life, time) {
        const system = this.streaks;
        for (let index = 0; index < count; index += 1) {
            const slot = this._acquireSlot(system, this.limits.streaks, time);
            if (slot < 0) break;
            const offset = slot * 3;
            const angle = command.phase + index * 2.39996323;
            const wave = 0.84 + ((index * 37) % 19) / 50;
            const startX = command.x + Math.cos(angle) * radiusX * wave;
            const startY = command.y + Math.sin(angle) * radiusY * wave;
            const endScale = 0.18 + ((index * 17) % 11) / 100;
            const color = SPECTRUM[index % SPECTRUM.length];
            system.pointA[offset] = startX;
            system.pointA[offset + 1] = startY;
            system.pointA[offset + 2] = command.z;
            system.pointB[offset] = command.x + (startX - command.x) * endScale;
            system.pointB[offset + 1] = command.y + (startY - command.y) * endScale;
            system.pointB[offset + 2] = command.z;
            const stagger = (index % 6) * 0.018;
            system.birth[slot] = time + stagger;
            system.invLife[slot] = 1 / life;
            system.width[slot] = command.width * (0.74 + (index % 4) * 0.12);
            system.alpha[slot] = command.alpha * command.intensity * 0.72;
            system.color[offset] = color[0];
            system.color[offset + 1] = color[1];
            system.color[offset + 2] = color[2];
            writePackedTiming(
                system,
                slot,
                system.birth[slot],
                system.invLife[slot],
                system.width[slot],
                system.alpha[slot],
            );
            this._activateSlot(system, slot, time + life + stagger);
        }
        markAttributes(system);
    }

    _expireSystems(time) {
        let activeCount = 0;
        for (let systemIndex = 0; systemIndex < this.systems.length; systemIndex += 1) {
            const system = this.systems[systemIndex];
            let systemActive = false;
            const limit = this._systemLimit(system);
            for (let slot = 0; slot < limit; slot += 1) {
                if (system.state.active[slot] && system.state.end[slot] <= time) {
                    system.state.active[slot] = 0;
                }
                if (system.state.active[slot]) {
                    activeCount += 1;
                    systemActive = true;
                }
            }
            system.mesh.visible = systemActive && this.intensity > EPSILON
                && (!this.reducedMotion || system !== this.streaks);
        }
        this.activeCount = activeCount;
    }

    _systemLimit(system) {
        if (system === this.phaseSeals) return this.limits.seals;
        if (system === this.rings) return this.limits.rings;
        if (system === this.nodes) return this.limits.nodes;
        if (system === this.links) return this.limits.links;
        if (system === this.ellipses) return this.limits.ellipses;
        return this.limits.streaks;
    }

    _applyInstanceBudgets() {
        this.phaseSeals.geometry.instanceCount = this.limits.seals * CELLS_PER_SEAL;
        this.rings.geometry.instanceCount = this.limits.rings;
        this.nodes.geometry.instanceCount = this.limits.nodes;
        this.links.geometry.instanceCount = this.limits.links;
        this.ellipses.geometry.instanceCount = this.limits.ellipses;
        this.streaks.geometry.instanceCount = this.reducedMotion ? 0 : this.limits.streaks;
    }

    _trimOutsideBudgets() {
        for (let systemIndex = 0; systemIndex < this.systems.length; systemIndex += 1) {
            const system = this.systems[systemIndex];
            const limit = this._systemLimit(system);
            for (let slot = limit; slot < system.state.active.length; slot += 1) {
                system.state.active[slot] = 0;
            }
        }
        this._expireSystems(this.time);
    }

    _deactivateSystem(system) {
        for (let slot = 0; slot < system.state.active.length; slot += 1) {
            system.state.active[slot] = 0;
        }
        system.mesh.visible = false;
        this._applyInstanceBudgets();
        this._expireSystems(this.time);
    }

    _shortenForReducedMotion() {
        const shortenedEnd = this.time + 0.26;
        for (let systemIndex = 0; systemIndex < this.systems.length; systemIndex += 1) {
            const system = this.systems[systemIndex];
            for (let slot = 0; slot < system.state.active.length; slot += 1) {
                if (system.state.active[slot]) {
                    system.state.end[slot] = Math.min(system.state.end[slot], shortenedEnd);
                }
            }
        }
    }

    _refreshVisibility() {
        this._expireSystems(this.time);
        if (this.warmupPending) {
            this._armCompileWarmup();
            return;
        }
        this.group.visible = this.activeCount > 0 && this.intensity > EPSILON;
    }

    _armCompileWarmup() {
        for (let index = 0; index < this.systems.length; index += 1) {
            const system = this.systems[index];
            system.geometry.instanceCount = Math.max(1, system.geometry.instanceCount);
            system.mesh.visible = true;
            setSystemTime(system, this.time, 0, this.reducedMotion ? 0 : 1);
        }
        this.group.visible = true;
    }

    _countPendingCommands() {
        let count = 0;
        for (let index = 0; index < this.commands.length; index += 1) {
            if (this.commands[index].active) count += 1;
        }
        return count;
    }
}

export function createSerenityWarpGameplayFX(options) {
    return new SerenityWarpGameplayFX(options);
}

export default SerenityWarpGameplayFX;
