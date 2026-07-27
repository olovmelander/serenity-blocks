/**
 * Stillwater atmosphere — analytic aerial perspective and one fixed mote field.
 *
 * The scene-level fog is intentionally analytic: distance and height supply the
 * large-scale depth, while the only noise work is confined to one or two bounded
 * low-mist cards on tiers that explicitly construct them. Each production
 * runtime allocates only its tier's fixed mote capacity; quality changes rebuild
 * the runtime outside gameplay events, so the hot path never creates geometry.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    color,
    float,
    fog,
    length,
    linearDepth,
    mix,
    mx_fractal_noise_float as materialXFractalNoise,
    positionGeometry,
    positionLocal,
    positionWorld,
    pow,
    rangeFogFactor,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import { getStillwaterQualityProfile } from '../stillwater-quality.js';

export const STILLWATER_ATMOSPHERE_MAX_MOTES = 700;

const FOG_SAGE = 0x173b34;
const FOG_CYAN = 0x346967;
const MOTE_IVORY = new THREE.Color(0xfff1c9);
const MOTE_CYAN = new THREE.Color(0x9ccfd0);
const MOTE_AMBER = new THREE.Color(0xffc271);
const TAU = Math.PI * 2;

/**
 * r181's exported viewportLinearDepth uses one module-global DepthTexture.
 * Rebuilding materials against a long-lived renderer adds Sampler listeners to
 * that global forever. Stillwater owns a depth texture per runtime instead, so
 * its bindings and renderer accounting retire with the atmosphere.
 */
class StillwaterViewportDepthTextureNode extends THREE.ViewportDepthTextureNode {
    constructor(texture) {
        super();
        this.defaultFramebuffer = texture;
        this.value = texture;
    }

    getTextureForReference() {
        return this.defaultFramebuffer;
    }
}

function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
        value += 0x6d2b79f5;
        let result = value;
        result = Math.imul(result ^ (result >>> 15), result | 1);
        result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
        return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
}

function resolveProfile(quality, qualityProfile) {
    if (qualityProfile?.name) {
        return getStillwaterQualityProfile(qualityProfile.name);
    }
    return getStillwaterQualityProfile(quality);
}

function createDepthFade(softness, viewportDepth) {
    const separation = viewportDepth.sub(linearDepth()).max(0);
    return smoothstep(float(0), float(softness), separation);
}

function createMoteGeometry(seed, capacity) {
    const positions = new Float32Array(capacity * 3);
    const phases = new Float32Array(capacity);
    const sizes = new Float32Array(capacity);
    const drift = new Float32Array(capacity);
    const warmth = new Float32Array(capacity);
    const packedPositionPhase = new Float32Array(capacity * 4);
    const packedStyle = new Float32Array(capacity * 4);
    const random = mulberry32(seed);

    for (let index = 0; index < capacity; index += 1) {
        const offset = index * 3;
        const side = index % 2 === 0 ? -1 : 1;
        const depth = random();
        const bankBias = 14 + depth * 16 + random() * 14;
        positions[offset] = side * bankBias + (random() - 0.5) * 6;
        positions[offset + 1] = 0.5 + random() * 14;
        positions[offset + 2] = 8 - depth * 66;
        phases[index] = random() * TAU;
        sizes[index] = 0.028 + random() * 0.060;
        drift[index] = 0.35 + random() * 0.9;
        warmth[index] = random();

        const packedOffset = index * 4;
        packedPositionPhase[packedOffset] = positions[offset];
        packedPositionPhase[packedOffset + 1] = positions[offset + 1];
        packedPositionPhase[packedOffset + 2] = positions[offset + 2];
        packedPositionPhase[packedOffset + 3] = phases[index];
        packedStyle[packedOffset] = sizes[index];
        packedStyle[packedOffset + 1] = drift[index];
        packedStyle[packedOffset + 2] = warmth[index];
    }

    const geometry = new THREE.IcosahedronGeometry(1, 0);
    geometry.deleteAttribute('uv');
    geometry.setAttribute(
        'aMotePositionPhase',
        new THREE.InstancedBufferAttribute(packedPositionPhase, 4),
    );
    geometry.setAttribute(
        'aMoteStyle',
        new THREE.InstancedBufferAttribute(packedStyle, 4),
    );
    geometry.computeBoundingSphere();

    return {
        geometry,
        positions,
        phases,
        sizes,
        drift,
        warmth,
        packedPositionPhase,
        packedStyle,
    };
}

/**
 * Build the complete Stillwater atmosphere.
 *
 * @param {object} options
 * @param {THREE.Scene} options.scene
 * @param {string} [options.quality='High']
 * @param {object} [options.qualityProfile]
 * @param {number} [options.seed=61937]
 * @param {boolean} [options.softParticles=true]
 * @param {boolean} [options.mistEnabled=true]
 * @param {boolean} [options.reducedMotion=false]
 */
export function createStillwaterAtmosphere({
    scene,
    quality = 'High',
    qualityProfile = null,
    seed = 61937,
    softParticles = true,
    mistEnabled = true,
    reducedMotion = false,
} = {}) {
    if (!scene?.isScene) {
        throw new TypeError('createStillwaterAtmosphere requires a Three.js Scene');
    }

    const profile = resolveProfile(quality, qualityProfile);
    const activeMotes = Math.min(
        STILLWATER_ATMOSPHERE_MAX_MOTES,
        Math.max(0, Math.floor(profile.ambientMotes)),
    );
    // Quality changes rebuild the production runtime, so lower tiers should
    // not carry Extreme's 700-instance buffers while rendering only 40–180.
    const moteCapacity = Math.max(1, activeMotes);
    const mistLayerCount = mistEnabled
        ? Math.min(2, Math.max(0, Math.floor(profile.mistLayers)))
        : 0;
    const premiumMist = profile.bloom === true;
    const root = new THREE.Group();
    root.name = 'stillwater-atmosphere';
    const geometries = new Set();
    const materials = new Set();
    const previousFogNode = scene.fogNode;
    let disposed = false;

    const uTime = uniform(0);
    const uMotion = uniform(reducedMotion ? 0.28 : 1);
    let softParticleDepthTexture = softParticles ? new THREE.DepthTexture() : null;
    if (softParticleDepthTexture) {
        softParticleDepthTexture.name = 'stillwater-soft-particle-depth';
    }
    let softParticleDepthNode = softParticleDepthTexture
        ? new StillwaterViewportDepthTextureNode(softParticleDepthTexture)
        : null;
    let softParticleLinearDepth = softParticleDepthNode
        ? linearDepth(softParticleDepthNode)
        : null;

    // Colored aerial perspective: dense near the lake bed, lifted toward
    // moon-cyan in the canopy, and always ordered from near to far.
    const distanceFactor = rangeFogFactor(34, 230);
    const lowHeightBand = smoothstep(1.5, 24, positionWorld.y).oneMinus();
    const fogFactor = distanceFactor
        .mul(float(0.28).add(lowHeightBand.mul(0.34)))
        .add(distanceFactor.pow(2).mul(0.07))
        .clamp();
    const highColorMix = smoothstep(2, 48, positionWorld.y).mul(0.26);
    const fogColorNode = mix(color(FOG_SAGE), color(FOG_CYAN), highColorMix);
    const atmosphereFogNode = fog(fogColorNode, fogFactor);
    scene.fogNode = atmosphereFogNode;

    const moteData = createMoteGeometry(seed, moteCapacity);
    geometries.add(moteData.geometry);

    const moteMaterial = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
    });
    materials.add(moteMaterial);
    {
        const positionPhase = attribute('aMotePositionPhase', 'vec4');
        const style = attribute('aMoteStyle', 'vec4');
        const basePosition = positionPhase.xyz;
        const phase = positionPhase.w;
        const baseSize = style.x;
        const driftScale = style.y;
        const warmth = style.z;
        const motion = vec3(
            sin(uTime.mul(0.19).add(phase)).mul(0.82),
            sin(uTime.mul(0.31).add(phase.mul(1.71))).mul(0.42),
            sin(uTime.mul(0.13).add(phase.mul(0.77))).mul(0.56),
        ).mul(driftScale).mul(uMotion);
        // Fireflies, not snow. A slow sine raised to a high power gives each mote
        // a long dark interval and a brief bloom, which is what separates an
        // insect from a drifting flake; the uniform 0.78-1.0 shimmer the motes
        // used before made every one of them visible at all times.
        const pulsePhase = sin(uTime.mul(0.62).add(phase.mul(2.3))).mul(0.5).add(0.5);
        const firefly = pow(pulsePhase, float(3.4));
        const shimmer = float(0.10).add(firefly.mul(0.95));
        const depthFade = softParticles
            ? createDepthFade(0.018, softParticleLinearDepth)
            : float(1);

        // Depth grading: near motes are large soft lamps, far motes collapse to
        // pinpricks. A single size across the whole frame is what made the swarm
        // read as a flat sheet of falling snow.
        const moteDepth = clamp(
            length(basePosition.add(motion).sub(cameraPosition)).div(120),
            0,
            1,
        );
        const moteSize = clamp(
            baseSize
                .mul(float(0.82).add(shimmer.mul(0.24)))
                .mul(mix(float(1.9), float(0.42), moteDepth)),
            0.018,
            0.30,
        );
        moteMaterial.positionNode = positionGeometry
            .mul(moteSize)
            .add(basePosition)
            .add(motion);
        // Warm foxfire near the banks, cool moon motes in the far air.
        const moteHue = mix(
            vec3(MOTE_CYAN.r, MOTE_CYAN.g, MOTE_CYAN.b),
            vec3(MOTE_IVORY.r, MOTE_IVORY.g, MOTE_IVORY.b),
            warmth.mul(0.72),
        );
        moteMaterial.colorNode = mix(
            moteHue,
            vec3(MOTE_AMBER.r, MOTE_AMBER.g, MOTE_AMBER.b),
            warmth.mul(0.88).mul(moteDepth.oneMinus()),
        ).mul(float(0.52).add(firefly.mul(0.55)));
        moteMaterial.opacityNode = shimmer
            .mul(depthFade)
            .mul(mix(float(0.86), float(0.30), moteDepth))
            .clamp();
        moteMaterial.fog = true;
    }

    const motes = new THREE.InstancedMesh(
        moteData.geometry,
        moteMaterial,
        moteCapacity,
    );
    const identityMatrix = new THREE.Matrix4();
    for (let index = 0; index < moteCapacity; index += 1) {
        motes.setMatrixAt(index, identityMatrix);
    }
    motes.instanceMatrix.needsUpdate = true;
    motes.count = activeMotes;
    motes.name = 'stillwater-depth-faded-motes';
    motes.frustumCulled = false;
    motes.renderOrder = 12;
    root.add(motes);

    const mistLayers = [];
    if (mistLayerCount > 0) {
        const mistGeometry = new THREE.PlaneGeometry(1, 1, 24, 4);
        geometries.add(mistGeometry);
        const mistMaterial = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.NormalBlending,
            side: THREE.DoubleSide,
        });
        // These broad planar cards are intentionally visible from either side.
        // A single transparent pass is sufficient and avoids r181's automatic
        // back/front pair over a large portion of the frame.
        mistMaterial.forceSinglePass = true;
        materials.add(mistMaterial);

        const localUv = uv();
        const centeredUv = localUv.sub(vec2(0.5));
        let mistNoise;
        if (premiumMist) {
            const mistCoord = vec3(
                localUv.x.mul(2.6).add(uTime.mul(0.025)),
                localUv.y.mul(1.2),
                uTime.mul(0.018),
            );
            mistNoise = materialXFractalNoise(
                mistCoord,
                Math.min(3, Math.max(2, profile.noiseOctaves)),
                2,
                0.5,
                1,
            ).mul(0.5).add(0.5);
        } else {
            // Medium keeps its atmospheric card, but uses two broad analytic
            // bands instead of a multi-octave MaterialX noise graph.
            const broadBand = sin(
                localUv.x.mul(8.4)
                    .add(localUv.y.mul(3.1))
                    .add(uTime.mul(0.055)),
            ).mul(0.5).add(0.5);
            const crossingBand = sin(
                localUv.x.mul(3.2)
                    .sub(localUv.y.mul(6.7))
                    .sub(uTime.mul(0.034)),
            ).mul(0.5).add(0.5);
            mistNoise = broadBand.mul(0.55)
                .add(crossingBand.mul(0.25))
                .add(0.20);
        }
        const horizontalFade = smoothstep(0.3, 0.5, abs(centeredUv.x)).oneMinus();
        const lowerFade = smoothstep(0, 0.2, localUv.y);
        const upperFade = smoothstep(0.68, 1, localUv.y).oneMinus();
        const depthFade = softParticles
            ? createDepthFade(0.028, softParticleLinearDepth)
            : float(1);

        mistMaterial.positionNode = positionLocal.add(vec3(
            sin(positionLocal.y.mul(0.7).add(uTime.mul(0.08))).mul(0.12).mul(uMotion),
            sin(positionLocal.x.mul(0.18).sub(uTime.mul(0.05))).mul(0.08).mul(uMotion),
            0,
        ));
        mistMaterial.colorNode = mix(
            vec3(0.16, 0.29, 0.25),
            vec3(0.31, 0.50, 0.48),
            localUv.y.mul(0.36),
        );
        mistMaterial.opacityNode = mistNoise
            .mul(0.48)
            .add(0.08)
            .mul(horizontalFade)
            .mul(lowerFade)
            .mul(upperFade)
            .mul(depthFade)
            .mul(0.16)
            .clamp();
        mistMaterial.fog = false;

        const placements = [
            {
                position: [-5, 3.2, -15],
                scale: [57, 10, 1],
                rotation: [0.02, -0.04, -0.015],
            },
            {
                position: [7, 4.6, -30],
                scale: [72, 13, 1],
                rotation: [0.01, 0.055, 0.012],
            },
        ];

        for (let index = 0; index < mistLayerCount; index += 1) {
            const placement = placements[index];
            const layer = new THREE.Mesh(mistGeometry, mistMaterial);
            layer.name = `stillwater-bounded-mist-${index}`;
            layer.position.fromArray(placement.position);
            layer.scale.fromArray(placement.scale);
            layer.rotation.set(...placement.rotation);
            layer.renderOrder = 8 + index;
            layer.frustumCulled = false;
            layer.updateMatrix();
            layer.matrixAutoUpdate = false;
            mistLayers.push(layer);
            root.add(layer);
        }
    }

    scene.add(root);

    const diagnostics = {
        quality: profile.name,
        fogMode: 'analytic-distance-height',
        coloredDepth: true,
        activeMotes,
        moteCapacity,
        moteDraws: activeMotes > 0 ? 1 : 0,
        mistLayerCount,
        mistDraws: mistLayerCount,
        mistModel: premiumMist ? 'materialx-fractal' : 'analytic-bands',
        softParticles,
        trueViewportDepthFade: softParticles,
        reducedMotion,
        perFrameAllocations: 0,
    };

    return {
        root,
        motes,
        mistLayers,
        profile,
        uTime,
        uMotion,
        getDiagnostics() {
            return diagnostics;
        },
        getResourceState() {
            return {
                geometries: geometries.size,
                materials: materials.size,
                rootChildren: root.children.length,
                activeMotes: motes.count,
                moteCapacity,
                motePositionArray: moteData.positions,
                motePhaseArray: moteData.phases,
                moteSizeArray: moteData.sizes,
                moteDriftArray: moteData.drift,
                moteWarmthArray: moteData.warmth,
                fogNode: atmosphereFogNode,
                softParticleDepthTexture,
                disposed,
            };
        },
        update(time) {
            uTime.value = Number.isFinite(time) ? time : 0;
        },
        setReducedMotion(enabled) {
            diagnostics.reducedMotion = Boolean(enabled);
            uMotion.value = diagnostics.reducedMotion ? 0.28 : 1;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            scene.remove(root);
            if (scene.fogNode === atmosphereFogNode) {
                scene.fogNode = previousFogNode;
            }
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => {
                material.dispose();
                material.colorNode = null;
                material.opacityNode = null;
                material.positionNode = null;
                material.emissiveNode = null;
                material.mrtNode = null;
            });
            softParticleDepthTexture?.dispose();
            softParticleDepthNode?.dispose();
            if (softParticleDepthNode) {
                softParticleDepthNode.defaultFramebuffer = null;
                softParticleDepthNode.value = null;
                softParticleDepthNode._cacheTextures = new WeakMap();
            }
            softParticleLinearDepth = null;
            softParticleDepthNode = null;
            softParticleDepthTexture = null;
            root.clear();
            geometries.clear();
            materials.clear();
        },
    };
}
