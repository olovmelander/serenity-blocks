/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Koi Pond "Moonwake Procession" gameplay FX.
 *
 * Renderer-only command sink. Gameplay interpretation stays in
 * koi-pond-gameplay-routing.js; this module owns three fixed-capacity analytic
 * TSL pools and never allocates from update():
 *
 *   1. Jade scale seals preserve the exact four-cell lock glyph.
 *   2. Broken twin meniscus rings carry the lock into the pond.
 *   3. One/two/four/six authored koi form the combo procession.
 *
 * The pools are compatible with WebGPU and TSL-on-WebGL2. They deliberately use
 * direct-render NORMAL alpha instead of post-processing or additive cyan, and
 * remain on the default layer so selective water reflection cannot feed them
 * back into itself.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cos,
    float,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import { KOI_POND_FX_COMMAND } from '../koi-pond-gameplay-routing.js';

export const KOI_POND_GAMEPLAY_FX_LIMITS = Object.freeze({
    Minimal: Object.freeze({
        seals: 2, rings: 2, processions: 1, fishPerProcession: 1,
    }),
    Low: Object.freeze({
        seals: 3, rings: 3, processions: 1, fishPerProcession: 2,
    }),
    Medium: Object.freeze({
        seals: 4, rings: 4, processions: 2, fishPerProcession: 4,
    }),
    High: Object.freeze({
        seals: 6, rings: 6, processions: 3, fishPerProcession: 6,
    }),
    Ultra: Object.freeze({
        seals: 6, rings: 6, processions: 3, fishPerProcession: 6,
    }),
    Extreme: Object.freeze({
        seals: 6, rings: 6, processions: 3, fishPerProcession: 6,
    }),
});

const MAX = KOI_POND_GAMEPLAY_FX_LIMITS.Extreme;
const CELLS_PER_SEAL = 4;
const MAX_FISH_PER_PROCESSION = 6;
const TAU = Math.PI * 2;
const EPSILON = 0.0001;

const DEFAULT_POND_CENTER = Object.freeze({ x: 0, y: 0.24, z: -6 });
const DEFAULT_POND_RADII = Object.freeze({ x: 14.4, z: 7.8 });

const JADE = Object.freeze([0.13, 0.58, 0.39]);
const PEARL = Object.freeze([0.82, 0.98, 0.88]);
const MOON_SILVER = Object.freeze([0.56, 0.82, 0.73]);
const VERMILION = Object.freeze([0.98, 0.24, 0.08]);

const KOI_PALETTE = Object.freeze([
    Object.freeze([0.94, 0.28, 0.08]),
    Object.freeze([0.88, 0.82, 0.63]),
    Object.freeze([0.12, 0.56, 0.40]),
    Object.freeze([0.79, 0.43, 0.12]),
    Object.freeze([0.84, 0.91, 0.84]),
    Object.freeze([0.24, 0.42, 0.52]),
]);

const TIER_FISH_COUNTS = Object.freeze([0, 1, 2, 4, 6]);

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
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
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, 1, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
        0, 0,
        1, 0,
        1, 1,
        0, 1,
    ], 2));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
    ], 3));
    return geometry;
}

function addAttribute(system, name, array, itemSize) {
    const instanceAttribute = new THREE.InstancedBufferAttribute(array, itemSize);
    instanceAttribute.setUsage(THREE.DynamicDrawUsage);
    system.geometry.setAttribute(name, instanceAttribute);
    system.attributes.push(instanceAttribute);
    return instanceAttribute;
}

function createMaterial() {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.NormalBlending,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    // r181 otherwise submits transparent DoubleSide materials twice. These
    // analytic pond-plane quads are symmetric, so one double-sided pass is
    // visually identical and halves active gameplay-FX draw work.
    material.forceSinglePass = true;
    material.toneMapped = false;
    material.fog = false;
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

function createPoolState(count, withCounts = false) {
    const state = {
        active: new Uint8Array(count),
        end: new Float64Array(count),
    };
    if (withCounts) state.count = new Uint8Array(count);
    return state;
}

function setNodeTime(system, time, intensity, motionScale) {
    system.timeNode.value = time;
    system.intensityNode.value = intensity;
    system.motionNode.value = motionScale;
}

// GLSL/WGSL leave smoothstep(edge0, edge1, x) undefined when edge0 >= edge1.
// Keep every analytic inverse mask in the defined low→high form.
function inverseSmoothstep(low, high, value) {
    return float(1).sub(smoothstep(low, high, value));
}

function setVec3(array, index, value) {
    const offset = index * 3;
    array[offset] = finiteOr(value?.x, 0);
    array[offset + 1] = finiteOr(value?.y, 0);
    array[offset + 2] = finiteOr(value?.z, 0);
}

function colorArray(value, fallback = JADE) {
    if (Array.isArray(value) && value.length >= 3) {
        return [
            clamp(finiteOr(value[0], fallback[0]), 0, 2),
            clamp(finiteOr(value[1], fallback[1]), 0, 2),
            clamp(finiteOr(value[2], fallback[2]), 0, 2),
        ];
    }
    if (typeof value === 'string' || Number.isFinite(value)) {
        try {
            const color = new THREE.Color(value);
            return [color.r, color.g, color.b];
        } catch {
            return fallback;
        }
    }
    return fallback;
}

function createSealSystem() {
    const instanceCount = MAX.seals * CELLS_PER_SEAL;
    const system = {
        name: 'KoiPondJadeScaleSeals',
        geometry: createQuadGeometry(),
        attributes: [],
        state: createPoolState(MAX.seals),
        origin: new Float32Array(instanceCount * 3),
        cell: new Float32Array(instanceCount * 2),
        timing: new Float32Array(instanceCount * 4),
        color: new Float32Array(instanceCount * 3),
    };

    for (let index = 0; index < instanceCount; index += 1) {
        system.timing[index * 4 + 1] = 1;
    }
    addAttribute(system, 'aOrigin', system.origin, 3);
    addAttribute(system, 'aCell', system.cell, 2);
    addAttribute(system, 'aTiming', system.timing, 4);
    addAttribute(system, 'aColor', system.color, 3);
    system.geometry.instanceCount = instanceCount;

    const uTime = uniform(0);
    const uIntensity = uniform(1);
    const uMotion = uniform(1);
    const material = createMaterial();

    material.vertexNode = Fn(() => {
        const origin = attribute('aOrigin', 'vec3');
        const cell = attribute('aCell', 'vec2');
        const timing = attribute('aTiming', 'vec4');
        const age = uTime.sub(timing.x).mul(timing.y).clamp(0, 1);
        const press = smoothstep(0, 0.26, age);
        const animatedScale = mix(float(0.74), float(1), press);
        const scale = mix(float(0.94), animatedScale, uMotion);
        const local = positionGeometry.xy.mul(timing.z.mul(0.66).mul(scale));
        const cellOffset = cell.mul(timing.z);
        const worldPosition = vec3(
            origin.x.add(cellOffset.x).add(local.x),
            origin.y.add(sin(age.mul(Math.PI)).mul(0.035).mul(uMotion)),
            origin.z.add(cellOffset.y).add(local.y),
        );
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldPosition, 1)));
    })();

    material.colorNode = Fn(() => {
        const timing = attribute('aTiming', 'vec4');
        const accent = attribute('aColor', 'vec3');
        const rawAge = uTime.sub(timing.x).mul(timing.y);
        const age = rawAge.clamp(0, 1);
        const p = uv().sub(0.5);
        // A vesica-piscis silhouette reads as one hand-painted koi scale while
        // retaining the exact four authored tetromino cell centers.
        const scalePoint = vec2(p.x.mul(1.02), p.y.mul(1.08));
        const upperArc = length(scalePoint.sub(vec2(0, 0.18)));
        const lowerArc = length(scalePoint.add(vec2(0, 0.18)));
        const almondDistance = max(upperArc, lowerArc);
        const body = inverseSmoothstep(0.53, 0.62, almondDistance);
        const bodyCore = inverseSmoothstep(0.43, 0.51, almondDistance);
        const rim = max(
            body.sub(bodyCore),
            float(0),
        );
        const growthLine = max(
            inverseSmoothstep(0.38, 0.47, lowerArc)
                .sub(inverseSmoothstep(0.29, 0.36, lowerArc)),
            float(0),
        ).mul(body);
        const keel = inverseSmoothstep(0.015, 0.065, abs(p.x))
            .mul(inverseSmoothstep(0.24, 0.42, abs(p.y)))
            .mul(body);
        const glint = inverseSmoothstep(
            0,
            0.14,
            length(uv().sub(vec2(0.39, 0.65))),
        );
        const appear = smoothstep(0, 0.10, rawAge);
        const fade = float(1).sub(smoothstep(0.58, 1, age));
        // Solid, luminous jade scale — the body fill now dominates so the seal
        // reads as a chi-imbued koi scale pressed into the water instead of a
        // hollow debug ring. The rim still defines the almond silhouette.
        const alpha = body.mul(0.92)
            .add(rim.mul(0.58))
            .add(growthLine.mul(0.26))
            .add(keel.mul(0.16))
            .add(glint.mul(0.5))
            .mul(appear)
            .mul(fade)
            .mul(timing.w)
            .mul(uIntensity)
            .clamp(0, 1);
        // HDR jade so the scale clears the post bloom threshold and glows.
        // Jade dominates; the pearl rim only lines the almond edge so the seal
        // reads as a luminous green koi scale, not a pale debug disc.
        const jadeBody = mix(vec3(0.16, 1.05, 0.66), accent, float(0.32));
        const color = mix(jadeBody, vec3(...PEARL), rim.mul(0.42))
            .add(vec3(...PEARL).mul(glint.mul(0.42)))
            .add(vec3(...MOON_SILVER).mul(growthLine.mul(0.14)))
            .add(vec3(...VERMILION).mul(keel.mul(0.07)));
        return vec4(color, alpha);
    })();

    system.material = material;
    system.timeNode = uTime;
    system.intensityNode = uIntensity;
    system.motionNode = uMotion;
    return finishSystem(system, 31);
}

function createRingSystem() {
    const instanceCount = MAX.rings;
    const system = {
        name: 'KoiPondMoonwakeRings',
        geometry: createQuadGeometry(),
        attributes: [],
        state: createPoolState(instanceCount),
        origin: new Float32Array(instanceCount * 3),
        timing: new Float32Array(instanceCount * 4),
        params: new Float32Array(instanceCount * 4),
        aspect: new Float32Array(instanceCount * 2),
        color: new Float32Array(instanceCount * 3),
    };
    for (let index = 0; index < instanceCount; index += 1) {
        system.timing[index * 4 + 1] = 1;
    }
    addAttribute(system, 'aOrigin', system.origin, 3);
    addAttribute(system, 'aTiming', system.timing, 4);
    addAttribute(system, 'aParams', system.params, 4);
    addAttribute(system, 'aAspect', system.aspect, 2);
    addAttribute(system, 'aColor', system.color, 3);
    system.geometry.instanceCount = instanceCount;

    const uTime = uniform(0);
    const uIntensity = uniform(1);
    const uMotion = uniform(1);
    const material = createMaterial();

    material.vertexNode = Fn(() => {
        const origin = attribute('aOrigin', 'vec3');
        const timing = attribute('aTiming', 'vec4');
        const aspect = attribute('aAspect', 'vec2');
        const rawAge = uTime.sub(timing.x).mul(timing.y);
        const age = rawAge.clamp(0, 1);
        const travel = smoothstep(0, 0.92, age);
        const extent = mix(float(0.58), float(0.10).add(travel.mul(0.90)), uMotion);
        const local = positionGeometry.xy.mul(aspect).mul(timing.z.mul(extent));
        const worldPosition = vec3(
            origin.x.add(local.x),
            origin.y.add(0.018),
            origin.z.add(local.y),
        );
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldPosition, 1)));
    })();

    material.colorNode = Fn(() => {
        const timing = attribute('aTiming', 'vec4');
        const params = attribute('aParams', 'vec4');
        const accent = attribute('aColor', 'vec3');
        const rawAge = uTime.sub(timing.x).mul(timing.y);
        const age = rawAge.clamp(0, 1);
        const p = uv().sub(0.5).mul(2);
        const radial = length(p);
        const angle = atan(p.y, p.x);
        const thickness = params.x;
        const phase = params.z.add(age.mul(0.72).mul(uMotion));
        const brushAngle = angle.add(phase.mul(0.34));
        const radiusWarp = sin(angle.mul(3).add(phase))
            .mul(0.016)
            .add(sin(angle.mul(7).sub(phase.mul(1.37))).mul(0.007));
        const brushWeight = sin(brushAngle).mul(0.5).add(0.5);
        const brushThickness = thickness.mul(mix(float(0.56), float(1.42), brushWeight));
        const outer = inverseSmoothstep(
            0,
            brushThickness,
            abs(radial.sub(float(0.82).add(radiusWarp))),
        );
        const inner = inverseSmoothstep(
            0,
            thickness.mul(0.78),
            abs(radial.sub(
                float(0.64).sub(radiusWarp.mul(0.62)),
            )),
        );
        const ensoGap = smoothstep(
            -0.95,
            -0.58,
            cos(brushAngle.sub(0.42)),
        );
        // Gentle bristle shimmer rather than a hard on/off chop, so the ring
        // reads as a continuous wet meniscus, not a dashed debug circle.
        const bristle = mix(
            float(0.82),
            float(1),
            smoothstep(
                0.16,
                0.80,
                abs(sin(
                    angle.mul(params.y.add(4))
                        .add(radial.mul(31))
                        .sub(phase.mul(1.2)),
                )),
            ),
        );
        const meniscusArc = smoothstep(
            -0.42,
            0.54,
            cos(angle.sub(phase.mul(0.38)).add(0.48)),
        );
        const meniscusBreaks = mix(
            float(0.78),
            float(1),
            smoothstep(
                0.18,
                0.64,
                abs(cos(angle.mul(params.y.add(1)).sub(phase.mul(0.78)))),
            ),
        );
        // One tapered enso brush stroke and one quieter inner meniscus retain
        // organic gaps without becoming a generic dashed-circle effect.
        const shape = outer.mul(ensoGap).mul(bristle)
            .add(inner.mul(meniscusArc).mul(meniscusBreaks).mul(0.48))
            .clamp(0, 1);
        const appear = smoothstep(0, 0.09, rawAge);
        const fade = float(1).sub(smoothstep(0.55, 1, age));
        const alpha = shape
            .mul(appear)
            .mul(fade)
            .mul(timing.w)
            .mul(uIntensity)
            .clamp(0, 1);
        const moonColor = mix(accent, vec3(...PEARL), outer.mul(0.32));
        const color = mix(moonColor, vec3(...VERMILION), params.w.mul(inner).mul(0.36));
        return vec4(color, alpha);
    })();

    system.material = material;
    system.timeNode = uTime;
    system.intensityNode = uIntensity;
    system.motionNode = uMotion;
    return finishSystem(system, 32);
}

function createProcessionSystem() {
    const instanceCount = MAX.processions * MAX_FISH_PER_PROCESSION;
    const system = {
        name: 'KoiPondMoonwakeProcession',
        geometry: createQuadGeometry(),
        attributes: [],
        state: createPoolState(MAX.processions, true),
        center: new Float32Array(instanceCount * 3),
        timing: new Float32Array(instanceCount * 4),
        motion: new Float32Array(instanceCount * 4),
        color: new Float32Array(instanceCount * 3),
    };
    for (let index = 0; index < instanceCount; index += 1) {
        system.timing[index * 4 + 1] = 1;
    }
    addAttribute(system, 'aCenter', system.center, 3);
    addAttribute(system, 'aTiming', system.timing, 4);
    addAttribute(system, 'aMotion', system.motion, 4);
    addAttribute(system, 'aColor', system.color, 3);
    system.geometry.instanceCount = instanceCount;

    const uTime = uniform(0);
    const uIntensity = uniform(1);
    const uMotion = uniform(1);
    const material = createMaterial();

    material.vertexNode = Fn(() => {
        const center = attribute('aCenter', 'vec3');
        const timing = attribute('aTiming', 'vec4');
        const motion = attribute('aMotion', 'vec4');
        const rawAge = uTime.sub(timing.x).mul(timing.y);
        const age = rawAge.clamp(0, 1);
        const theta = motion.x.add(age.mul(motion.w).mul(TAU).mul(uMotion));
        const tangent = normalize(vec2(
            sin(theta).negate().mul(motion.y),
            cos(theta).mul(motion.z),
        ));
        const side = vec2(tangent.y.negate(), tangent.x);
        const orbit = vec2(cos(theta).mul(motion.y), sin(theta).mul(motion.z));
        const local = positionGeometry.xy;
        const along = local.x.mul(timing.z.mul(1.62));
        const across = local.y.mul(timing.z.mul(0.88));
        const worldPosition = vec3(
            center.x.add(orbit.x).add(tangent.x.mul(along)).add(side.x.mul(across)),
            center.y.add(sin(age.mul(Math.PI)).mul(0.045).mul(uMotion)),
            center.z.add(orbit.y).add(tangent.y.mul(along)).add(side.y.mul(across)),
        );
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldPosition, 1)));
    })();

    material.colorNode = Fn(() => {
        const timing = attribute('aTiming', 'vec4');
        const koiColor = attribute('aColor', 'vec3');
        const rawAge = uTime.sub(timing.x).mul(timing.y);
        const age = rawAge.clamp(0, 1);
        const p = uv().sub(0.5).mul(2);

        const bodyDistance = length(vec2(
            p.x.sub(0.10).mul(0.92),
            p.y.mul(2.22),
        ));
        const body = inverseSmoothstep(0.72, 0.92, bodyDistance);
        const bodyCore = inverseSmoothstep(0.52, 0.70, bodyDistance);
        const bodyRim = max(body.sub(bodyCore), float(0));
        const tailUpper = inverseSmoothstep(
            0.34,
            0.58,
            length(vec2(
                p.x.add(0.75).mul(1.55),
                p.y.sub(0.24).mul(2.45),
            )),
        );
        const tailLower = inverseSmoothstep(
            0.34,
            0.58,
            length(vec2(
                p.x.add(0.75).mul(1.55),
                p.y.add(0.24).mul(2.45),
            )),
        );
        const tail = max(tailUpper, tailLower)
            .mul(float(1).sub(smoothstep(-0.28, 0.04, p.x)));
        const silhouette = max(body, tail);

        const warmPatch = inverseSmoothstep(
            0.08,
            0.38,
            length(vec2(p.x.sub(0.28), p.y.add(0.08))),
        ).mul(body);
        const pearlPatch = inverseSmoothstep(
            0.05,
            0.30,
            length(vec2(p.x.add(0.18), p.y.sub(0.11))),
        ).mul(body);
        const eye = inverseSmoothstep(
            0.01,
            0.08,
            length(vec2(p.x.sub(0.56), p.y.sub(0.10))),
        ).mul(body);

        const behind = float(1).sub(smoothstep(-0.58, 0.04, p.x));
        const wakeTarget = p.x.add(1).mul(0.34).add(0.05);
        const wakeDistance = abs(abs(p.y).sub(wakeTarget));
        const wake = inverseSmoothstep(0.022, 0.085, wakeDistance)
            .mul(behind)
            .mul(float(1).sub(body));
        const wakeEcho = inverseSmoothstep(
            0.022,
            0.075,
            abs(wakeDistance.sub(0.13)),
        )
            .mul(behind)
            .mul(float(1).sub(body))
            .mul(0.45);
        const wakeThread = inverseSmoothstep(
            0.014,
            0.058,
            abs(p.y.add(
                sin(p.x.mul(10).sub(age.mul(5).mul(uMotion))).mul(0.024),
            )),
        )
            .mul(behind)
            .mul(smoothstep(-0.96, -0.10, p.x))
            .mul(float(1).sub(body));
        const wakeBristle = mix(
            float(0.54),
            float(1),
            smoothstep(
                0.38,
                0.88,
                abs(sin(p.x.mul(19).sub(age.mul(6).mul(uMotion)))),
            ),
        );
        const tierFour = smoothstep(0.758, 0.778, timing.z);
        const tierAccent = inverseSmoothstep(
            0.04,
            0.20,
            length(vec2(
                p.x.add(0.04).mul(0.82),
                p.y.sub(0.16),
            )),
        ).mul(body).mul(tierFour);

        const appear = smoothstep(0, 0.10, rawAge);
        const fade = float(1).sub(smoothstep(0.72, 1, age));
        const alpha = silhouette.mul(0.38)
            .add(bodyRim.mul(0.54))
            .add(wake.mul(0.76))
            .add(wakeEcho.mul(0.46))
            .add(wakeThread.mul(wakeBristle).mul(0.58))
            .add(eye)
            .mul(appear)
            .mul(fade)
            .mul(timing.w)
            .mul(uIntensity)
            .clamp(0, 1);
        const bodyColor = mix(koiColor, vec3(...PEARL), pearlPatch.mul(0.82));
        const painted = mix(
            mix(bodyColor, vec3(...VERMILION), warmPatch.mul(0.76)),
            vec3(...VERMILION),
            tierAccent.mul(0.34),
        )
            .add(vec3(...PEARL).mul(eye.mul(0.85)));
        const wakeColor = mix(
            vec3(...MOON_SILVER),
            vec3(...PEARL),
            max(wake, wakeThread.mul(wakeBristle)).mul(0.46),
        );
        const color = mix(wakeColor, painted, silhouette.clamp(0, 1));
        return vec4(color, alpha);
    })();

    system.material = material;
    system.timeNode = uTime;
    system.intensityNode = uIntensity;
    system.motionNode = uMotion;
    return finishSystem(system, 33);
}

class KoiPondGameplayFX {
    constructor({
        scene,
        isWebGPU = false,
        quality = 'High',
        reducedMotion = false,
        intensity = 1,
        pondCenter = DEFAULT_POND_CENTER,
        pondRadii = DEFAULT_POND_RADII,
    } = {}) {
        if (!scene?.add) throw new TypeError('KoiPondGameplayFX requires a Three.js scene');

        this.scene = scene;
        this.isWebGPU = isWebGPU === true;
        this.quality = normalizeQuality(quality);
        this.limits = KOI_POND_GAMEPLAY_FX_LIMITS[this.quality];
        this.reducedMotion = reducedMotion === true;
        this.intensity = clamp(finiteOr(intensity, 1), 0, 2);
        this.pondCenter = {
            x: finiteOr(pondCenter?.x, DEFAULT_POND_CENTER.x),
            y: finiteOr(pondCenter?.y, DEFAULT_POND_CENTER.y),
            z: finiteOr(pondCenter?.z, DEFAULT_POND_CENTER.z),
        };
        this.pondRadii = {
            x: clamp(finiteOr(pondRadii?.x, DEFAULT_POND_RADII.x), 2, 30),
            z: clamp(finiteOr(pondRadii?.z, DEFAULT_POND_RADII.z), 2, 24),
        };
        this.time = 0;
        this.activeCount = 0;
        this.initialized = false;
        this.disposed = false;
        this.warmupPending = true;
        this.warmupFinalized = false;

        this.group = new THREE.Group();
        this.group.name = 'KoiPondGameplayFX';
        this.group.matrixAutoUpdate = false;
        this.group.visible = false;

        this.seals = createSealSystem();
        this.rings = createRingSystem();
        this.procession = createProcessionSystem();
        this.systems = [this.seals, this.rings, this.procession];
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

    setQuality(value) {
        const quality = normalizeQuality(value);
        if (quality === this.quality) return;
        this.quality = quality;
        this.limits = KOI_POND_GAMEPLAY_FX_LIMITS[quality];
        this._trimOutsideBudgets();
        this._applyInstanceBudgets();
    }

    setReducedMotion(enabled) {
        this.reducedMotion = enabled === true;
        this._syncUniforms();
    }

    setIntensity(value) {
        this.intensity = clamp(finiteOr(value, 1), 0, 2);
        this._syncUniforms();
    }

    enqueue(command) {
        if (this.disposed || !command || typeof command !== 'object') return false;
        if (command.type === KOI_POND_FX_COMMAND.LOCK || command.type === 'lock') {
            return this.triggerLock(command);
        }
        if (command.type === KOI_POND_FX_COMMAND.COMBO || command.type === 'combo') {
            return this.triggerCombo(command);
        }
        return false;
    }

    triggerLock(command = {}) {
        if (this.disposed || this.intensity <= EPSILON) return false;
        const birth = finiteOr(command.birthTime, this.time);
        const reduced = command.reducedMotion === true || this.reducedMotion;
        const life = clamp(
            finiteOr(command.durationMs, reduced ? 220 : 520) / 1000,
            0.16,
            1.2,
        );
        const intensity = clamp(finiteOr(command.intensity, 0.72), 0, 2);
        const origin = this._readWorldOrigin(command);
        const color = colorArray(command.glyph?.color || command.color, JADE);
        const cells = this._readCells(command.glyph?.cells || command.cells);

        const sealSlot = this._acquireSlot(this.seals, this.limits.seals, birth);
        if (sealSlot < 0) return false;
        const cellSize = clamp(finiteOr(command.cellSize, 0.72), 0.36, 1.2);
        for (let cell = 0; cell < CELLS_PER_SEAL; cell += 1) {
            const instance = sealSlot * CELLS_PER_SEAL + cell;
            setVec3(this.seals.origin, instance, origin);
            const cellOffset = instance * 2;
            this.seals.cell[cellOffset] = cells[cell * 2];
            this.seals.cell[cellOffset + 1] = cells[cell * 2 + 1];
            const timingOffset = instance * 4;
            this.seals.timing[timingOffset] = birth;
            this.seals.timing[timingOffset + 1] = 1 / life;
            this.seals.timing[timingOffset + 2] = cellSize;
            this.seals.timing[timingOffset + 3] = intensity;
            const colorOffset = instance * 3;
            this.seals.color[colorOffset] = color[0];
            this.seals.color[colorOffset + 1] = color[1];
            this.seals.color[colorOffset + 2] = color[2];
        }
        this._activate(this.seals, sealSlot, birth + life);
        markAttributes(this.seals);

        if (!reduced) {
            this._stampRing({
                origin,
                birth: birth + Math.min(0.12, life * 0.22),
                life: Math.max(0.34, life * 1.04),
                radius: clamp(finiteOr(command.rippleRadius, 3.2), 1.4, 5.2),
                alpha: intensity * 0.72,
                thickness: 0.065,
                lobes: 3,
                phase: (finiteOr(command.id, 1) * 1.618) % TAU,
                warmth: 0.08,
                aspectX: 1,
                aspectZ: 1,
                color,
            });
        }
        return true;
    }

    triggerCombo(command = {}) {
        if (this.disposed || this.intensity <= EPSILON) return false;
        const birth = finiteOr(command.birthTime, this.time);
        const reduced = command.reducedMotion === true || this.reducedMotion;
        const tier = clamp(Math.floor(finiteOr(command.tier, 1)), 1, 4);
        const life = clamp(
            finiteOr(command.durationMs, reduced ? 260 : 760 + tier * 150) / 1000,
            0.22,
            2,
        );
        const intensity = clamp(finiteOr(command.intensity, 0.55 + tier * 0.1), 0, 2);
        const requestedFish = TIER_FISH_COUNTS[tier];
        const fishCount = Math.min(requestedFish, this.limits.fishPerProcession);
        const slot = this._acquireSlot(this.procession, this.limits.processions, birth);
        if (slot < 0 || fishCount <= 0) return false;

        const center = this.pondCenter;
        const seed = (finiteOr(command.id, tier) * 0.38196601125) % 1;
        for (let fish = 0; fish < MAX_FISH_PER_PROCESSION; fish += 1) {
            const instance = slot * MAX_FISH_PER_PROCESSION + fish;
            setVec3(this.procession.center, instance, center);
            const timingOffset = instance * 4;
            this.procession.timing[timingOffset] = birth + Math.min(fish * 0.025, 0.12);
            this.procession.timing[timingOffset + 1] = 1 / life;
            this.procession.timing[timingOffset + 2] = 0.60 + tier * 0.045;
            this.procession.timing[timingOffset + 3] = fish < fishCount
                ? intensity * 0.76
                : 0;

            const motionOffset = instance * 4;
            this.procession.motion[motionOffset] = (
                seed * TAU + (fish * TAU) / Math.max(1, fishCount)
            ) % TAU;
            this.procession.motion[motionOffset + 1] = this.pondRadii.x * (0.94 + (fish % 2) * 0.035);
            this.procession.motion[motionOffset + 2] = this.pondRadii.z * (0.92 + ((fish + 1) % 2) * 0.045);
            this.procession.motion[motionOffset + 3] = reduced ? 0 : 0.34 + tier * 0.055;

            const color = KOI_PALETTE[(fish + tier - 1) % KOI_PALETTE.length];
            const colorOffset = instance * 3;
            this.procession.color[colorOffset] = color[0];
            this.procession.color[colorOffset + 1] = color[1];
            this.procession.color[colorOffset + 2] = color[2];
        }
        this.procession.state.count[slot] = fishCount;
        this._activate(this.procession, slot, birth + life + 0.12);
        markAttributes(this.procession);

        let ringWarmth = 0.06;
        if (tier >= 4) ringWarmth = 0.42;
        else if (tier >= 2) ringWarmth = 0.18;
        this._stampRing({
            origin: center,
            birth: birth + (reduced ? 0 : 0.06),
            life: Math.max(0.28, life * 0.82),
            radius: 4.8 + tier * 1.75,
            alpha: intensity * (0.34 + tier * 0.05),
            thickness: Math.max(0.026, 0.052 - tier * 0.004),
            lobes: 3 + tier,
            phase: seed * TAU,
            warmth: ringWarmth,
            aspectX: 1.48,
            aspectZ: 0.92,
            color: JADE,
        });
        return true;
    }

    update(time) {
        if (this.disposed || !this.initialized) return false;
        this.time = Math.max(this.time, finiteOr(time, this.time));
        this._expire(this.time);

        if (this.warmupPending) {
            this.group.visible = true;
            for (let index = 0; index < this.systems.length; index += 1) {
                const system = this.systems[index];
                system.mesh.visible = true;
                setNodeTime(system, this.time, 0, this.reducedMotion ? 0 : 1);
            }
            this.warmupPending = false;
            return true;
        }
        if (!this.warmupFinalized) {
            this._applyInstanceBudgets();
            this.warmupFinalized = true;
        }

        if (this.activeCount <= 0 || this.intensity <= EPSILON) {
            this.group.visible = false;
            return false;
        }
        this.group.visible = true;
        this._syncUniforms();
        return true;
    }

    hasActiveEffects() {
        return this.activeCount > 0;
    }

    getActiveParticleCount() {
        let seals = 0;
        let rings = 0;
        let fish = 0;
        for (let index = 0; index < this.limits.seals; index += 1) {
            if (this.seals.state.active[index]) seals += CELLS_PER_SEAL;
        }
        for (let index = 0; index < this.limits.rings; index += 1) {
            if (this.rings.state.active[index]) rings += 1;
        }
        for (let index = 0; index < this.limits.processions; index += 1) {
            if (this.procession.state.active[index]) {
                fish += this.procession.state.count[index];
            }
        }
        return seals + rings + fish;
    }

    getDebugState() {
        const active = {
            seals: 0, rings: 0, processions: 0, fish: 0,
        };
        for (let index = 0; index < this.limits.seals; index += 1) {
            if (this.seals.state.active[index]) active.seals += 1;
        }
        for (let index = 0; index < this.limits.rings; index += 1) {
            if (this.rings.state.active[index]) active.rings += 1;
        }
        for (let index = 0; index < this.limits.processions; index += 1) {
            if (this.procession.state.active[index]) {
                active.processions += 1;
                active.fish += this.procession.state.count[index];
            }
        }
        const activeDraws = Number(active.seals > 0)
            + Number(active.rings > 0)
            + Number(active.processions > 0);
        const submittedInstances = (active.seals > 0 ? this.seals.geometry.instanceCount : 0)
            + (active.rings > 0 ? this.rings.geometry.instanceCount : 0)
            + (active.processions > 0 ? this.procession.geometry.instanceCount : 0);
        return {
            quality: this.quality,
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            reducedMotion: this.reducedMotion,
            intensity: this.intensity,
            activeDraws,
            activeInstances: this.getActiveParticleCount(),
            submittedInstances,
            active,
            limits: { ...this.limits },
            warmupPending: this.warmupPending,
        };
    }

    clear() {
        for (let systemIndex = 0; systemIndex < this.systems.length; systemIndex += 1) {
            const system = this.systems[systemIndex];
            system.state.active.fill(0);
            system.state.end.fill(0);
            system.state.count?.fill(0);
            system.mesh.visible = false;
        }
        this.activeCount = 0;
        this.group.visible = false;
    }

    prepareForCompile() {
        if (this.disposed) return () => {};
        const priorCounts = this.systems.map((system) => system.geometry.instanceCount);
        for (let index = 0; index < this.systems.length; index += 1) {
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
            this._expire(this.time);
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
        this.activeCount = 0;
        this.initialized = false;
    }

    cleanup() {
        this.dispose();
    }

    _readWorldOrigin(command) {
        const world = command.worldOrigin || command.origin?.position;
        if (Number.isFinite(world?.x) && Number.isFinite(world?.z)) {
            return {
                x: Number(world.x),
                y: finiteOr(world.y, this.pondCenter.y),
                z: Number(world.z),
            };
        }
        return { ...this.pondCenter, x: this.pondCenter.x - this.pondRadii.x * 0.74 };
    }

    _readCells(cells) {
        const output = new Float32Array(CELLS_PER_SEAL * 2);
        let count = 0;
        let sumX = 0;
        let sumY = 0;
        if (Array.isArray(cells)) {
            for (let index = 0; index < cells.length && count < CELLS_PER_SEAL; index += 1) {
                const x = finiteOr(cells[index]?.x, 0);
                const y = -finiteOr(cells[index]?.y, 0);
                output[count * 2] = x;
                output[count * 2 + 1] = y;
                sumX += x;
                sumY += y;
                count += 1;
            }
        }
        if (count !== CELLS_PER_SEAL) {
            output.set([0, 0, 1, 0, 2, 0, 1, -1]);
            count = CELLS_PER_SEAL;
            sumX = 4;
            sumY = -1;
        }
        const centerX = sumX / count;
        const centerY = sumY / count;
        for (let index = 0; index < count; index += 1) {
            output[index * 2] -= centerX;
            output[index * 2 + 1] -= centerY;
        }
        return output;
    }

    _stampRing({
        origin,
        birth,
        life,
        radius,
        alpha,
        thickness,
        lobes,
        phase,
        warmth,
        aspectX = 1,
        aspectZ = 1,
        color,
    }) {
        const slot = this._acquireSlot(this.rings, this.limits.rings, birth);
        if (slot < 0) return false;
        setVec3(this.rings.origin, slot, origin);
        const timingOffset = slot * 4;
        this.rings.timing[timingOffset] = birth;
        this.rings.timing[timingOffset + 1] = 1 / Math.max(life, 0.1);
        this.rings.timing[timingOffset + 2] = radius;
        this.rings.timing[timingOffset + 3] = clamp(alpha, 0, 2);
        this.rings.params[timingOffset] = clamp(thickness, 0.015, 0.16);
        this.rings.params[timingOffset + 1] = clamp(lobes, 2, 9);
        this.rings.params[timingOffset + 2] = finiteOr(phase, 0);
        this.rings.params[timingOffset + 3] = clamp(finiteOr(warmth, 0), 0, 1);
        const aspectOffset = slot * 2;
        this.rings.aspect[aspectOffset] = clamp(finiteOr(aspectX, 1), 0.4, 2.5);
        this.rings.aspect[aspectOffset + 1] = clamp(finiteOr(aspectZ, 1), 0.4, 2.5);
        const tint = colorArray(color, MOON_SILVER);
        const colorOffset = slot * 3;
        this.rings.color[colorOffset] = tint[0];
        this.rings.color[colorOffset + 1] = tint[1];
        this.rings.color[colorOffset + 2] = tint[2];
        this._activate(this.rings, slot, birth + life);
        markAttributes(this.rings);
        return true;
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

    _activate(system, slot, endTime) {
        system.state.active[slot] = 1;
        system.state.end[slot] = endTime;
        system.mesh.visible = true;
        this._expire(this.time);
    }

    _expire(time) {
        let activeCount = 0;
        for (let systemIndex = 0; systemIndex < this.systems.length; systemIndex += 1) {
            const system = this.systems[systemIndex];
            const limit = this._systemLimit(system);
            let visible = false;
            for (let slot = 0; slot < limit; slot += 1) {
                if (system.state.active[slot] && system.state.end[slot] <= time) {
                    system.state.active[slot] = 0;
                    system.state.count?.fill(0, slot, slot + 1);
                }
                if (system.state.active[slot]) {
                    activeCount += 1;
                    visible = true;
                }
            }
            system.mesh.visible = visible;
        }
        this.activeCount = activeCount;
        this.group.visible = activeCount > 0;
    }

    _systemLimit(system) {
        if (system === this.seals) return this.limits.seals;
        if (system === this.rings) return this.limits.rings;
        return this.limits.processions;
    }

    _applyInstanceBudgets() {
        this.seals.geometry.instanceCount = this.limits.seals * CELLS_PER_SEAL;
        this.rings.geometry.instanceCount = this.limits.rings;
        this.procession.geometry.instanceCount = this.limits.processions
            * MAX_FISH_PER_PROCESSION;
    }

    _trimOutsideBudgets() {
        for (let systemIndex = 0; systemIndex < this.systems.length; systemIndex += 1) {
            const system = this.systems[systemIndex];
            const limit = this._systemLimit(system);
            for (let slot = limit; slot < system.state.active.length; slot += 1) {
                system.state.active[slot] = 0;
                if (system.state.count) system.state.count[slot] = 0;
            }
        }
        this._expire(this.time);
    }

    _syncUniforms() {
        const motion = this.reducedMotion ? 0 : 1;
        // Command intensity is already reduced once by gameplay routing.
        const { intensity } = this;
        for (let index = 0; index < this.systems.length; index += 1) {
            const system = this.systems[index];
            if (system.mesh.visible) setNodeTime(system, this.time, intensity, motion);
        }
    }
}

export function createKoiPondGameplayFX(options) {
    return new KoiPondGameplayFX(options);
}

export default KoiPondGameplayFX;
