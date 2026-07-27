/**
 * Stillwater's fixed-capacity environmental reaction layer.
 *
 * Gameplay events only rewrite preallocated attributes and uniforms. The
 * renderer owns one mote draw, an optional tier-sized shaft draw, and one
 * priority-controlled lake rune; no event creates scene resources.
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    clamp,
    float,
    length,
    mix,
    positionGeometry,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';

import { configureStillwaterSelectiveBloomMaterial } from '../post/stillwater-pipeline.js';
import { getStillwaterQualityProfile } from '../stillwater-quality.js';

export const STILLWATER_REACTION_MOTE_CAPACITY = 192;
export const STILLWATER_REACTION_SHAFT_CAPACITY = 4;

const TAU = Math.PI * 2;
const DORMANT_BIRTH = -10_000;
const CYAN = Object.freeze([0.40, 0.84, 0.82]);
const IVORY = Object.freeze([1.00, 0.90, 0.62]);
const VIOLET = Object.freeze([0.58, 0.39, 0.78]);
const GOLD = Object.freeze([0.98, 0.59, 0.20]);

function resolveProfile(quality, qualityProfile) {
    if (qualityProfile?.name) return getStillwaterQualityProfile(qualityProfile.name);
    return getStillwaterQualityProfile(quality);
}

function createDynamicAttribute(geometry, name, itemSize, count, instanced = false) {
    const array = new Float32Array(count * itemSize);
    const attributeValue = instanced
        ? new THREE.InstancedBufferAttribute(array, itemSize)
        : new THREE.BufferAttribute(array, itemSize);
    attributeValue.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attributeValue);
    return { array, attribute: attributeValue };
}

function markAttributes(first, second, third = null) {
    if (first?.attribute) first.attribute.needsUpdate = true;
    if (second?.attribute) second.attribute.needsUpdate = true;
    if (third?.attribute) third.attribute.needsUpdate = true;
}

function normalizedWorldX(value) {
    const numeric = value === null || value === undefined || value === ''
        ? 0.5
        : Number(value);
    const normalized = Number.isFinite(numeric) ? numeric : 0.5;
    return (THREE.MathUtils.clamp(normalized, 0, 1) - 0.5) * 18;
}

function normalizedWorldZ(value) {
    const numeric = value === null || value === undefined || value === ''
        ? 0.5
        : Number(value);
    const normalized = Number.isFinite(numeric) ? numeric : 0.5;
    return 1 - THREE.MathUtils.clamp(normalized, 0, 1) * 27;
}

export function createStillwaterReactions({
    root,
    quality = 'High',
    qualityProfile = null,
    reducedMotion = false,
    selectiveBloom = false,
} = {}) {
    if (!root?.add) {
        throw new TypeError('createStillwaterReactions requires a Three.js root');
    }

    const profile = resolveProfile(quality, qualityProfile);
    let motionReduced = reducedMotion === true;
    const reactionRoot = new THREE.Group();
    reactionRoot.name = 'stillwater-fixed-reactions';
    root.add(reactionRoot);

    const geometries = new Set();
    const materials = new Set();
    const uTime = uniform(0);
    const uTide = uniform(0);
    const uMotion = uniform(motionReduced ? 0.24 : 1);
    let currentTime = 0;
    let disposed = false;
    let moteCursor = 0;
    let moteDrawCount = 0;
    let shaftCursor = 0;
    let motesExpire = DORMANT_BIRTH;
    let shaftsExpire = DORMANT_BIRTH;
    let runePriority = 0;
    let runeExpires = DORMANT_BIRTH;
    let emittedMotes = 0;
    let emittedShafts = 0;
    let emittedRunes = 0;

    const moteGeometry = new THREE.IcosahedronGeometry(1, 0);
    moteGeometry.deleteAttribute('uv');
    geometries.add(moteGeometry);
    const moteOriginBirth = createDynamicAttribute(
        moteGeometry,
        'aOriginBirth',
        4,
        STILLWATER_REACTION_MOTE_CAPACITY,
        true,
    );
    const moteVelocityLife = createDynamicAttribute(
        moteGeometry,
        'aVelocityLife',
        4,
        STILLWATER_REACTION_MOTE_CAPACITY,
        true,
    );
    const moteStyle = createDynamicAttribute(
        moteGeometry,
        'aMoteStyle',
        3,
        STILLWATER_REACTION_MOTE_CAPACITY,
        true,
    );
    for (let index = 0; index < STILLWATER_REACTION_MOTE_CAPACITY; index += 1) {
        moteOriginBirth.array[index * 4 + 3] = DORMANT_BIRTH;
        moteVelocityLife.array[index * 4 + 3] = 1;
    }

    const moteMaterial = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
    });
    materials.add(moteMaterial);
    {
        const originBirth = attribute('aOriginBirth', 'vec4');
        const velocityLife = attribute('aVelocityLife', 'vec4');
        const style = attribute('aMoteStyle', 'vec3');
        const origin = originBirth.xyz;
        const birth = originBirth.w;
        const velocity = velocityLife.xyz;
        const life = velocityLife.w;
        const size = style.x;
        const hue = style.y;
        const phase = style.z;
        const age = uTime.sub(birth).max(0);
        const progress = clamp(age.div(life.max(0.001)), 0, 1);
        const fadeIn = smoothstep(0, 0.08, progress);
        const fadeOut = smoothstep(0.62, 1, progress).oneMinus();
        const alive = fadeIn.mul(fadeOut);
        const curl = vec3(
            sin(age.mul(2.1).add(phase)).mul(0.24),
            age.mul(age).mul(-0.22).add(age.mul(0.54)),
            sin(age.mul(1.6).add(phase.mul(1.7))).mul(0.20),
        ).mul(uMotion);
        const cyanIvory = mix(
            vec3(...CYAN),
            vec3(...IVORY),
            smoothstep(0.12, 0.56, hue),
        );
        const reactionColor = mix(
            cyanIvory,
            vec3(...VIOLET),
            smoothstep(0.64, 0.96, hue),
        );

        const worldPosition = origin
            .add(velocity.mul(age).mul(uMotion))
            .add(curl);
        const worldSize = size
            .mul(float(0.78).add(uTide.mul(0.32)))
            .mul(alive);
        moteMaterial.positionNode = positionGeometry
            .mul(worldSize)
            .add(worldPosition);
        moteMaterial.colorNode = reactionColor;
        moteMaterial.opacityNode = alive.mul(0.76).clamp();
        if (profile.bloom && selectiveBloom) {
            configureStillwaterSelectiveBloomMaterial(
                moteMaterial,
                reactionColor.mul(alive).mul(0.72),
            );
        }
    }
    const motes = new THREE.InstancedMesh(
        moteGeometry,
        moteMaterial,
        STILLWATER_REACTION_MOTE_CAPACITY,
    );
    const identityMatrix = new THREE.Matrix4();
    for (let index = 0; index < STILLWATER_REACTION_MOTE_CAPACITY; index += 1) {
        motes.setMatrixAt(index, identityMatrix);
    }
    motes.instanceMatrix.needsUpdate = true;
    motes.name = 'stillwater-fixed-reaction-motes';
    motes.frustumCulled = false;
    motes.renderOrder = 31;
    motes.count = 0;
    motes.visible = false;
    reactionRoot.add(motes);

    const shaftCapacity = Math.min(
        STILLWATER_REACTION_SHAFT_CAPACITY,
        Math.max(0, Math.floor(profile.transientShaftSlots)),
    );
    let shafts = null;
    let shaftOriginBirth = null;
    let shaftStyle = null;
    if (shaftCapacity > 0) {
        const shaftGeometry = new THREE.PlaneGeometry(1, 1, 1, 5);
        geometries.add(shaftGeometry);
        shaftOriginBirth = createDynamicAttribute(
            shaftGeometry,
            'aOriginBirth',
            4,
            shaftCapacity,
            true,
        );
        shaftStyle = createDynamicAttribute(
            shaftGeometry,
            'aShaftStyle',
            4,
            shaftCapacity,
            true,
        );
        for (let index = 0; index < shaftCapacity; index += 1) {
            shaftOriginBirth.array[index * 4 + 3] = DORMANT_BIRTH;
            shaftStyle.array[index * 4] = 1;
        }

        const shaftMaterial = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        shaftMaterial.forceSinglePass = true;
        materials.add(shaftMaterial);
        const originBirth = attribute('aOriginBirth', 'vec4');
        const style = attribute('aShaftStyle', 'vec4');
        const origin = originBirth.xyz;
        const birth = originBirth.w;
        const life = style.x;
        const strength = style.y;
        const hue = style.z;
        const phase = style.w;
        const progress = clamp(uTime.sub(birth).div(life.max(0.001)), 0, 1);
        const alive = smoothstep(0, 0.08, progress)
            .mul(smoothstep(0.54, 1, progress).oneMinus());
        const centered = uv().sub(vec2(0.5));
        const ribbon = smoothstep(0.06, 0.5, abs(centered.x)).oneMinus();
        const vertical = smoothstep(0.32, 0.5, abs(centered.y)).oneMinus();
        const width = float(0.55).add(strength.mul(0.85));
        const height = float(11).add(strength.mul(13));
        const drift = sin(
            positionGeometry.y.mul(3.1).add(uTime.mul(0.34)).add(phase),
        ).mul(0.34).mul(uMotion);
        const shaftColor = mix(
            vec3(...CYAN),
            vec3(...IVORY),
            smoothstep(0.18, 0.72, hue),
        );
        shaftMaterial.positionNode = vec3(
            positionGeometry.x.mul(width).add(drift),
            positionGeometry.y.mul(height).add(height.mul(0.5)),
            positionGeometry.z,
        ).add(origin);
        shaftMaterial.colorNode = shaftColor;
        shaftMaterial.opacityNode = ribbon
            .mul(vertical)
            .mul(alive)
            .mul(float(0.018).add(strength.mul(0.024)))
            .clamp();
        if (profile.bloom && selectiveBloom) {
            configureStillwaterSelectiveBloomMaterial(
                shaftMaterial,
                shaftColor.mul(ribbon).mul(vertical).mul(alive).mul(0.15),
            );
        }
        shafts = new THREE.InstancedMesh(shaftGeometry, shaftMaterial, shaftCapacity);
        shafts.name = 'stillwater-fixed-moon-shafts';
        shafts.frustumCulled = false;
        shafts.renderOrder = 24;
        shafts.visible = false;
        reactionRoot.add(shafts);
    }

    const uRuneBirth = uniform(DORMANT_BIRTH);
    const uRuneLife = uniform(1);
    const uRuneKind = uniform(0);
    const uRuneStrength = uniform(0);
    const runeEnabled = profile.name !== 'Minimal';
    const premiumRune = profile.bloom === true;
    let runeModel = 'disabled-minimal';
    if (runeEnabled) {
        runeModel = premiumRune ? 'mycelial-premium' : 'etched-lean';
    }
    const runeBaseScale = premiumRune ? 12 : 9;
    const runeStrengthScale = premiumRune ? 9 : 6;
    let runeGeometry = null;
    let runeMaterial = null;
    let rune = null;
    if (runeEnabled) {
        runeGeometry = new THREE.PlaneGeometry(1, 1);
        geometries.add(runeGeometry);
        runeMaterial = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        runeMaterial.forceSinglePass = true;
        materials.add(runeMaterial);
        const centered = uv().sub(vec2(0.5));
        const radius = length(centered);
        const progress = clamp(
            uTime.sub(uRuneBirth).div(uRuneLife.max(0.001)),
            0,
            1,
        );
        const alive = smoothstep(0, 0.06, progress)
            .mul(smoothstep(0.62, 1, progress).oneMinus());
        const outerRadius = float(0.10).add(progress.mul(0.48));
        const innerRadius = float(0.16).add(progress.mul(0.31));
        const outer = smoothstep(0.006, 0.034, abs(radius.sub(outerRadius))).oneMinus();
        const inner = smoothstep(0.005, 0.025, abs(radius.sub(innerRadius))).oneMinus();
        const spokes = sin(centered.x.mul(54).add(centered.y.mul(47)))
            .mul(0.5)
            .add(0.5)
            .mul(smoothstep(0.1, 0.45, radius).oneMinus());
        const twistMix = smoothstep(0.25, 1, uRuneKind);
        const miracleMix = smoothstep(1.25, 2, uRuneKind);
        const awakeningMix = smoothstep(2.25, 3, uRuneKind);
        const cyanViolet = mix(vec3(...CYAN), vec3(...VIOLET), twistMix);
        const miracleColor = mix(vec3(...GOLD), vec3(...IVORY), awakeningMix.mul(0.72));
        const runeColor = mix(cyanViolet, miracleColor, miracleMix);
        let runeShape = outer
            .add(inner.mul(float(0.44).add(twistMix.mul(0.48))));
        if (premiumRune) {
            const myceliumGate = smoothstep(0.06, 0.16, radius)
                .mul(smoothstep(0.38, 0.51, radius).oneMinus());
            // Two skewed root fields keep the rune organic without evaluating
            // polar atan over its large transparent card.
            const rootA = centered.x.mul(21)
                .add(centered.y.mul(13))
                .add(radius.mul(16));
            const rootB = centered.x.mul(-17)
                .add(centered.y.mul(25))
                .sub(radius.mul(23));
            const mycelium = smoothstep(
                0.78,
                0.99,
                abs(sin(rootA)),
            )
                .add(smoothstep(
                    0.88,
                    0.99,
                    abs(sin(rootB)),
                ).mul(0.64))
                .clamp()
                .mul(myceliumGate);
            const awakeningRing = smoothstep(
                0.005,
                0.022,
                abs(radius.sub(float(0.25).add(progress.mul(0.14)))),
            ).oneMinus();
            runeShape = runeShape
                .add(spokes.mul(miracleMix).mul(0.12))
                .add(mycelium.mul(awakeningMix).mul(0.42))
                .add(awakeningRing.mul(awakeningMix).mul(0.66));
        } else {
            // Lean tiers retain a legible etched sigil without evaluating the
            // premium polar-angle/mycelium field over a large transparent card.
            const diamondRadius = abs(centered.x).add(abs(centered.y));
            const diamond = smoothstep(
                0.006,
                0.028,
                abs(diamondRadius.sub(innerRadius.mul(1.08))),
            ).oneMinus();
            const glyphGate = smoothstep(0.055, 0.12, radius)
                .mul(smoothstep(0.28, 0.42, radius).oneMinus());
            const cross = smoothstep(0.006, 0.024, abs(centered.x)).oneMinus()
                .add(smoothstep(0.006, 0.024, abs(centered.y)).oneMinus())
                .clamp()
                .mul(glyphGate);
            runeShape = runeShape
                .add(diamond.mul(miracleMix).mul(0.34))
                .add(cross.mul(awakeningMix).mul(0.28));
        }
        const runeOpacity = runeShape
            .mul(alive)
            .mul(float(0.18).add(uRuneStrength.mul(0.18)))
            .clamp();
        runeMaterial.colorNode = runeColor;
        runeMaterial.opacityNode = runeOpacity;
        if (profile.bloom && selectiveBloom) {
            configureStillwaterSelectiveBloomMaterial(
                runeMaterial,
                runeColor.mul(runeOpacity).mul(1.35),
            );
        }
        rune = new THREE.Mesh(runeGeometry, runeMaterial);
        rune.name = 'stillwater-priority-lake-rune';
        rune.rotation.x = -Math.PI / 2;
        rune.position.set(0, 0.11, -12);
        rune.scale.setScalar(18);
        rune.frustumCulled = false;
        rune.renderOrder = 30;
        rune.visible = false;
        reactionRoot.add(rune);
    }

    function spawnMotes(options, hueBias = 0.38) {
        if (disposed) return;
        const requested = Math.max(0, Math.floor(Number(options?.moteCount) || 0));
        const count = Math.min(
            requested,
            motionReduced ? 8 : STILLWATER_REACTION_MOTE_CAPACITY,
        );
        if (count <= 0) return;
        if (!motes.visible) {
            moteCursor = 0;
            moteDrawCount = 0;
        }
        const originX = normalizedWorldX(options?.originX);
        const originZ = normalizedWorldZ(options?.originY);
        const strength = THREE.MathUtils.clamp(Number(options?.strength) || 0.4, 0.1, 1.4);
        const duration = THREE.MathUtils.clamp(
            (Number(options?.durationMs) || 620) / 1000,
            0.22,
            1.8,
        );
        for (let index = 0; index < count; index += 1) {
            const slot = moteCursor;
            const angle = (
                slot * 2.399963229728653
                + index * 0.7548776662466927
                + (Number(options?.sequence) || 0) * 0.31
            ) % TAU;
            const radial = 0.34 + ((slot * 17 + index * 11) % 29) / 29;
            const packedOffset = slot * 4;
            const styleOffset = slot * 3;
            moteOriginBirth.array[packedOffset] = originX;
            moteOriginBirth.array[packedOffset + 1] = 0.42 + (index % 5) * 0.055;
            moteOriginBirth.array[packedOffset + 2] = originZ;
            moteOriginBirth.array[packedOffset + 3] = currentTime;
            moteVelocityLife.array[packedOffset] = Math.cos(angle)
                * radial
                * (0.82 + strength * 3.4);
            moteVelocityLife.array[packedOffset + 1] = 0.58
                + radial * 0.72
                + strength * 0.34;
            moteVelocityLife.array[packedOffset + 2] = Math.sin(angle)
                * radial
                * (0.68 + strength * 2.8);
            moteVelocityLife.array[packedOffset + 3] = duration
                * (0.76 + (index % 7) * 0.045);
            moteStyle.array[styleOffset] = 0.055
                + strength * 0.052
                + (index % 3) * 0.009;
            moteStyle.array[styleOffset + 1] = THREE.MathUtils.clamp(
                hueBias + (((slot + index) % 5) - 2) * 0.045,
                0,
                1,
            );
            moteStyle.array[styleOffset + 2] = angle;
            moteDrawCount = Math.max(moteDrawCount, slot + 1);
            moteCursor = (moteCursor + 1) % STILLWATER_REACTION_MOTE_CAPACITY;
        }
        emittedMotes += count;
        motesExpire = Math.max(
            motesExpire,
            currentTime + duration * (0.76 + Math.min(6, count - 1) * 0.045),
        );
        motes.count = moteDrawCount;
        motes.visible = true;
        markAttributes(
            moteOriginBirth,
            moteVelocityLife,
            moteStyle,
        );
    }

    function spawnShaft(options, hue = 0.42) {
        if (disposed || shaftCapacity <= 0) return;
        const slot = shaftCursor;
        const offset = slot * 4;
        const life = THREE.MathUtils.clamp(
            (Number(options?.durationMs) || 760) / 1000,
            0.3,
            1.6,
        );
        shaftOriginBirth.array[offset] = normalizedWorldX(options?.originX);
        shaftOriginBirth.array[offset + 1] = 0.12;
        shaftOriginBirth.array[offset + 2] = normalizedWorldZ(options?.originY) - 1.5;
        shaftOriginBirth.array[offset + 3] = currentTime;
        shaftStyle.array[offset] = life;
        shaftStyle.array[offset + 1] = THREE.MathUtils.clamp(
            Number(options?.strength) || 0.5,
            0.15,
            1.2,
        );
        shaftStyle.array[offset + 2] = hue;
        shaftStyle.array[offset + 3] = (
            (Number(options?.sequence) || slot) * 1.73
        ) % TAU;
        shaftCursor = (shaftCursor + 1) % shaftCapacity;
        emittedShafts += 1;
        shaftsExpire = Math.max(shaftsExpire, currentTime + life);
        shafts.visible = true;
        markAttributes(
            shaftOriginBirth,
            shaftStyle,
        );
    }

    function triggerRune(options, kind, priority) {
        if (disposed || !runeEnabled) return;
        if (currentTime < runeExpires && priority < runePriority) return;
        const life = THREE.MathUtils.clamp(
            (Number(options?.durationMs) || 760) / 1000,
            0.24,
            1.8,
        );
        const strength = THREE.MathUtils.clamp(Number(options?.strength) || 0.5, 0.1, 1.2);
        uRuneBirth.value = currentTime;
        uRuneLife.value = life;
        uRuneKind.value = kind;
        uRuneStrength.value = strength;
        rune.position.x = normalizedWorldX(options?.originX);
        rune.position.z = normalizedWorldZ(options?.originY);
        rune.scale.setScalar(runeBaseScale + strength * runeStrengthScale);
        runeExpires = currentTime + life;
        runePriority = priority;
        emittedRunes += 1;
        rune.visible = true;
    }

    function dimple(options) {
        spawnMotes(options, 0.48);
    }

    function wake(options) {
        spawnMotes(options, options?.lineCount >= 4 ? 0.55 : 0.36);
        if (Number(options?.lineCount) >= 3) spawnShaft(options, 0.44);
    }

    function twist(options) {
        spawnMotes(options, 0.92);
    }

    function echo(options) {
        spawnMotes(options, 0.72);
        triggerRune(options, 1, 1);
    }

    function miracle(options) {
        const awakening = options?.cue === 'stillwater-awakening';
        spawnMotes(options, awakening ? 0.48 : 0.58);
        triggerRune(options, awakening ? 3 : 2, 3);
        const fullMotionShaftCount = awakening ? 3 : 2;
        const shaftCount = Math.min(
            shaftCapacity,
            motionReduced ? 1 : fullMotionShaftCount,
        );
        for (let index = 0; index < shaftCount; index += 1) {
            spawnShaft(options, 0.62 + index * 0.04);
        }
    }

    function tide(options) {
        uTide.value = THREE.MathUtils.clamp(Number(options?.strength) || 0, 0, 1);
    }

    function update(time) {
        if (disposed) return;
        currentTime = Number.isFinite(time) ? time : currentTime;
        uTime.value = currentTime;
        if (motes.visible && currentTime >= motesExpire) {
            motes.visible = false;
            motes.count = 0;
            moteCursor = 0;
            moteDrawCount = 0;
        }
        if (shafts?.visible && currentTime >= shaftsExpire) shafts.visible = false;
        if (rune && currentTime >= runeExpires) {
            runePriority = 0;
            rune.visible = false;
        }
    }

    function setReducedMotion(enabled) {
        motionReduced = Boolean(enabled);
        uMotion.value = motionReduced ? 0.24 : 1;
    }

    function getDiagnostics() {
        const activeDraws = (motes.visible ? 1 : 0)
            + (shafts?.visible ? 1 : 0)
            + (rune?.visible ? 1 : 0);
        return {
            quality: profile.name,
            moteCapacity: STILLWATER_REACTION_MOTE_CAPACITY,
            activeMoteSlots: motes.visible ? motes.count : 0,
            shaftCapacity,
            specialSlots: runeEnabled ? 1 : 0,
            runeModel,
            runeMaxScale: runeEnabled
                ? runeBaseScale + runeStrengthScale * 1.2
                : 0,
            draws: activeDraws,
            idleDraws: 0,
            maxDraws: 1
                + (shaftCapacity > 0 ? 1 : 0)
                + (runeEnabled ? 1 : 0),
            reducedMotion: motionReduced,
            emittedMotes,
            emittedShafts,
            emittedRunes,
            tide: uTide.value,
            perEventResourceCreation: 0,
        };
    }

    function getResourceState() {
        return {
            disposed,
            geometries: geometries.size,
            materials: materials.size,
            moteOriginBirthArray: moteOriginBirth.array,
            moteVelocityLifeArray: moteVelocityLife.array,
            moteStyleArray: moteStyle.array,
            shaftOriginBirthArray: shaftOriginBirth?.array || null,
            shaftStyleArray: shaftStyle?.array || null,
            runeGeometry,
            runeMaterial,
        };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        root.remove(reactionRoot);
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        reactionRoot.clear();
    }

    return Object.freeze({
        root: reactionRoot,
        dimple,
        wake,
        twist,
        echo,
        miracle,
        spiritAttention() {},
        trollCue() {},
        tide,
        update,
        setReducedMotion,
        getDiagnostics,
        getResourceState,
        dispose,
    });
}

export default createStillwaterReactions;
