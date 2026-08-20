/* Stillwater production composition runtime. */
/**
 * Production-owned Stillwater Waves 3-7 composition runtime.
 *
 * The runtime deliberately composes the screenshot-proven production builders
 * instead of copying their shader graphs:
 *
 *   ?effect=stillwater-masterpiece&quality=High&orbit=0&t=8
 *   ?effect=stillwater-masterpiece&quality=High&event=tetris&fxAge=.42&orbit=0&t=8
 *   ?effect=stillwater-masterpiece&quality=High&event=tspin&fxAge=.34&orbit=0&t=8
 *   ?effect=stillwater-masterpiece&quality=High&event=perfectclear&fxAge=.52&orbit=0&t=8
 *   ?effect=stillwater-masterpiece&quality=Low&reducedMotion=1&orbit=0&t=8
 *   ?effect=stillwater-masterpiece&quality=High&forceWebGL=1&orbit=0&t=8
 *
 * Wave 3 owns the camera, black-water surface, reflection, and board guide. Its
 * proxy forest/characters and local post graph are structurally disabled. The
 * shared Wave 4/5/6 builders are mounted once and StillwaterPipeline is the sole
 * final output.
 */
import * as THREE from 'three/webgpu';
import { createStillwaterWater } from './stillwater-water.js';
import {
    getStillwaterQualityProfile,
} from '../stillwater-quality.js';
import {
    createStillwaterForest,
    FOREST_WORLD_SCALE,
    FOREST_WORLD_Y,
    FOREST_WORLD_Z,
} from './stillwater-forest.js';
import {
    createStillwaterCharacters,
    LANTERN_WORLD,
} from './stillwater-characters.js';
import {
    createStillwaterAtmosphere,
} from './stillwater-atmosphere.js';
import {
    createStillwaterReactions,
} from './stillwater-reactions.js';
import {
    configureStillwaterSelectiveBloomMaterial,
    StillwaterPipeline,
} from '../post/stillwater-pipeline.js';
import {
    createStillwaterShafts,
} from './stillwater-shafts.js';
import {
    createStillwaterOfferingLoop,
} from '../sim/stillwater-offering-loop.js';
import {
    STILLWATER_CUE,
    STILLWATER_EVENT,
    StillwaterReactionDirector,
} from '../sim/stillwater-reaction-director.js';

export const STILLWATER_MASTERPIECE_RUNTIME_ID = 'stillwater-masterpiece';

export const meta = {
    id: STILLWATER_MASTERPIECE_RUNTIME_ID,
    title: 'Stillwater - The Pool Remembers',
    description: [
        'Unified black water, authored forest, flora, spirit, troll,',
        'atmosphere, grade, and canonical reactions.',
    ].join(' '),
};

const REFLECTION_LAYER = 2;
const BASE_BLOOM_STRENGTH = 0.48;
const BASE_EXPOSURE = 0.90;
const LEVEL_ENRICHMENT_HALF_LIFE = 2.4;
const MAX_CAPTURE_PRIME_SECONDS = 30;
const PRIME_STEP_SECONDS = 0.05;
// The forest is authored in its own pilot space and mounted into the lake's
// camera space. The former non-uniform squash (0.38/0.46/0.28) was the root of
// three separate composition failures: it stretched every trunk 1.2x vertically,
// it dropped the authored hero canopy from y=50 to y=23 so nothing ever reached
// the top of frame (no repoussoir), and it crushed 190 units of authored depth
// into 40 so far trees sat at the same value as mid trees (no aerial
// perspective). A uniform scale keeps tree proportions honest and restores both.
const FOREST_TRANSFORM = Object.freeze({
    scaleX: FOREST_WORLD_SCALE,
    scaleY: FOREST_WORLD_SCALE,
    scaleZ: FOREST_WORLD_SCALE,
    x: 0,
    y: FOREST_WORLD_Y,
    z: FOREST_WORLD_Z,
});
const EMPTY_PAYLOAD = Object.freeze({});
const T_SHAPE = Object.freeze([
    Object.freeze([1, 1, 1]),
    Object.freeze([0, 1, 0]),
]);
const PRESET_ROWS = Object.freeze([
    Object.freeze([]),
    Object.freeze([19]),
    Object.freeze([18, 19]),
    Object.freeze([17, 18, 19]),
    Object.freeze([16, 17, 18, 19]),
]);

const ROUTE = Object.freeze({
    LOCK: 0,
    WAKE: 1,
    TWIST: 2,
    MIRACLE: 3,
    ECHO: 4,
    SPIRIT_ATTENTION: 5,
    TROLL_CUE: 6,
    TIDE: 7,
    HARD_DROP: 8,
    LEVEL_UP: 9,
});

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

/**
 * Production-safe gameplay filter. Online-local events remain valid; only
 * explicitly remote ownership is rejected.
 */
export function acceptsLocalStillwaterPayload(payload = EMPTY_PAYLOAD) {
    return payload?.isLocal !== false
        && payload?.remote !== true
        && payload?.owner !== 'remote';
}

function readNumber(params, key, fallback, minimum = -Infinity, maximum = Infinity) {
    const raw = params?.get?.(key);
    if (raw == null || raw === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed)
        ? clamp(parsed, minimum, maximum)
        : fallback;
}

function readToggle(params, key, fallback = false) {
    if (!params?.has?.(key)) return fallback;
    const value = String(params.get(key) || '').trim().toLowerCase();
    return !['0', 'off', 'false', 'no'].includes(value);
}

function normalizePresetName(value) {
    const normalized = String(value || 'idle').trim().toLowerCase();
    if (normalized === 'line-clear' || normalized === 'line_clear') return 'lineclear';
    if (normalized === 'perfect-clear' || normalized === 'perfect_clear') {
        return 'perfectclear';
    }
    if (normalized === 't-spin' || normalized === 't_spin') return 'tspin';
    if (normalized === 'hard-drop' || normalized === 'hard_drop') return 'harddrop';
    if (normalized === 'level-up' || normalized === 'level_up') return 'levelup';
    return normalized;
}

/**
 * Mutate one reusable water-response options record from director lake-space
 * coordinates. Exported so unit tests can pin the integration mapping without a
 * renderer. The target identity is always retained.
 */
export function writeStillwaterWaterReaction(target, options, time) {
    if (!target) throw new TypeError('Stillwater water mapping requires a target');
    const originX = clamp(finiteOr(options?.originX, 0.5), 0, 1);
    const originY = clamp(finiteOr(options?.originY, 0.5), 0, 1);
    const strength = clamp(finiteOr(options?.strength, 0.5), 0, 1.35);
    const cascadeDepth = clamp(finiteOr(options?.cascadeDepth, 0), 0, 4);

    target.time = Math.max(0.0001, finiteOr(time, 0));
    target.x = (originX - 0.5) * 9;
    target.z = -7 + (0.5 - originY) * 14;
    target.strength = strength;
    target.scale = clamp(0.78 + strength * 0.46 + cascadeDepth * 0.07, 0.72, 1.58);
    target.phase = finiteOr(options?.direction, 0) < 0 ? 1 : 0;
    return target;
}

function normalizedCanonicalEvent(eventName) {
    switch (eventName) {
    case STILLWATER_EVENT.PIECE_LOCK:
    case 'PIECE_LOCK':
    case 'piece_lock':
    case 'lock':
        return STILLWATER_EVENT.PIECE_LOCK;
    case STILLWATER_EVENT.LINE_CLEAR:
    case 'LINE_CLEAR':
    case 'line_clear':
    case 'lineclear':
        return STILLWATER_EVENT.LINE_CLEAR;
    case STILLWATER_EVENT.COMBO:
    case 'COMBO':
        return STILLWATER_EVENT.COMBO;
    case STILLWATER_EVENT.TSPIN:
    case 'TSPIN':
    case 'T_SPIN':
    case 't-spin':
        return STILLWATER_EVENT.TSPIN;
    case STILLWATER_EVENT.B2B:
    case 'B2B':
        return STILLWATER_EVENT.B2B;
    case STILLWATER_EVENT.PERFECT_CLEAR:
    case 'PERFECT_CLEAR':
    case 'perfect_clear':
    case 'perfectclear':
        return STILLWATER_EVENT.PERFECT_CLEAR;
    case STILLWATER_EVENT.HARD_DROP:
    case 'HARD_DROP':
    case 'hard_drop':
    case 'harddrop':
        return STILLWATER_EVENT.HARD_DROP;
    case STILLWATER_EVENT.LEVEL_UP:
    case 'LEVEL_UP':
    case 'level_up':
    case 'levelup':
        return STILLWATER_EVENT.LEVEL_UP;
    default:
        return null;
    }
}

function sweepSceneMrtMaterials(root, selectiveBloom) {
    const materials = new Set();
    let mrtMissing = 0;
    let nonNodeMaterials = 0;

    root.traverse((object) => {
        if (!object.material) return;
        const entries = Array.isArray(object.material)
            ? object.material
            : [object.material];
        entries.forEach((material) => {
            if (!material || materials.has(material)) return;
            materials.add(material);
            if (material.isNodeMaterial !== true) {
                nonNodeMaterials += 1;
                return;
            }
            const hasExplicitMrtRole = Boolean(
                material.mrtNode && material.userData?.mrtRole,
            );
            if (selectiveBloom && !hasExplicitMrtRole) {
                configureStillwaterSelectiveBloomMaterial(
                    material,
                    material.emissiveNode || null,
                );
            }
            if (
                selectiveBloom
                && !(material.mrtNode && material.userData?.mrtRole)
            ) {
                mrtMissing += 1;
            }
        });
    });

    return Object.freeze({
        tracked: materials.size,
        mrtMissing,
        nonNodeMaterials,
    });
}

/**
 * Build the production composition as a reusable runtime. The playground effect
 * imports this API through a thin adapter; production never imports playground.
 */
export function createStillwaterRuntime({
    scene,
    camera,
    renderer,
    params = new URLSearchParams(),
    sizes = null,
    layoutPolicy = null,
}) {
    if (!scene || !camera || !renderer) {
        throw new TypeError('Stillwater masterpiece requires scene, camera, and renderer');
    }

    const qualityProfile = getStillwaterQualityProfile(
        params?.get?.('quality') || 'High',
    );
    const reducedMotion = readToggle(params, 'reducedMotion', false)
        || readToggle(params, 'reduced', false);
    const bloomEnabled = readToggle(params, 'bloom', true);
    // `?painterly=0` disables the Kuwahara pass for A/B comparison — the only
    // honest way to attribute temporal crawl to the filter rather than to the
    // scene's own motion.
    const painterlyEnabled = readToggle(params, 'painterly', true);
    const validationTelemetry = readToggle(params, 'validationTelemetry', false);
    const gradeMode = String(params?.get?.('grade') || 'full').toLowerCase() === 'aces'
        ? 'aces'
        : 'full';
    const queryEvent = normalizePresetName(params?.get?.('event'));
    const queryFxAge = readNumber(params, 'fxAge', 0.42, 0, 3);
    const hasLineOverride = params?.has?.('lines') === true;
    let queryDefaultLines = 4;
    if (queryEvent === 'tspin') queryDefaultLines = 2;
    else if (queryEvent === 'combo') queryDefaultLines = 1;
    const queryLineCount = Math.round(
        readNumber(params, 'lines', queryDefaultLines, 1, 4),
    );
    const queryComboCount = Math.round(readNumber(params, 'combo', 10, 0, 99));
    const queryOriginX = readNumber(params, 'fxU', 0.5, 0, 1);
    const queryOriginY = readNumber(params, 'fxV', 0.7, 0, 1);
    const selectiveBloom = qualityProfile.bloom === true && bloomEnabled;
    const characterMaterialConfigurator = selectiveBloom
        ? configureStillwaterSelectiveBloomMaterial
        : null;

    const waterParams = new URLSearchParams(params);
    waterParams.set('quality', qualityProfile.name);
    waterParams.set('proxies', 'off');
    waterParams.set('post', 'off');
    waterParams.set('event', 'idle');

    const integrationRoot = new THREE.Group();
    integrationRoot.name = 'stillwater-masterpiece-characters-root';
    scene.add(integrationRoot);

    let water = null;
    let forest = null;
    let characters = null;
    let atmosphere = null;
    let reactions = null;
    let pipeline = null;
    let postWidth = 0;
    let postHeight = 0;
    let postPixelRatio = 1;
    let disposed = false;
    let lanternSited = false;
    // The story. Renderer-free and authoritative for ambient character intent;
    // the existing character state machine still owns pose and locomotion.
    const offeringLoop = createStillwaterOfferingLoop();
    // Premium tiers only: the raymarch is the single most expensive thing in
    // the scene and the lean tiers exist to avoid exactly this.
    let shafts = null;
    let offering = null;
    let finalMrtSweepComplete = false;
    let materialAudit = Object.freeze({
        tracked: 0,
        mrtMissing: 0,
        nonNodeMaterials: 0,
    });
    let activeLayoutPolicy = layoutPolicy;
    let cameraPullback = Math.max(
        0,
        finiteOr(
            layoutPolicy?.camera?.totalPullback
                ?? layoutPolicy?.totalPullback,
            0,
        ),
    );
    const createPostPipeline = (
        width,
        height,
        bloomStrength = BASE_BLOOM_STRENGTH,
    ) => {
        const candidate = new StillwaterPipeline(renderer, scene, camera, {
            quality: qualityProfile.name,
            qualityProfile,
            bloomEnabled,
            painterlyEnabled,
            gradeMode,
            bloomStrength,
        });
        try {
            candidate.setSize(width, height);
            return candidate;
        } catch (error) {
            candidate.dispose();
            throw error;
        }
    };

    try {
        water = createStillwaterWater({
            scene,
            camera,
            renderer,
            params: waterParams,
            includeLights: false,
        });

        forest = createStillwaterForest({
            scene,
            camera,
            renderer,
            quality: qualityProfile.name,
            mode: 'flora',
            reducedMotion,
            includeTerrain: false,
            includeShoreRoots: false,
            reflectionLayer: REFLECTION_LAYER,
        });
        forest.root.scale.set(
            FOREST_TRANSFORM.scaleX,
            FOREST_TRANSFORM.scaleY,
            FOREST_TRANSFORM.scaleZ,
        );
        forest.root.position.set(
            FOREST_TRANSFORM.x,
            FOREST_TRANSFORM.y,
            FOREST_TRANSFORM.z,
        );
        forest.root.updateMatrixWorld(true);

        characters = createStillwaterCharacters({
            root: integrationRoot,
            profile: qualityProfile,
            reflectionLayer: REFLECTION_LAYER,
            mode: 'all',
            materialConfigurator: characterMaterialConfigurator,
            telemetryEnabled: validationTelemetry,
        });

        // Wave 6's colored height fog owns the scene fog graph. The legacy
        // FogExp2 record created by the water pilot remains restorable by water
        // disposal but is structurally inactive while fogNode is present.
        scene.fog = null;
        atmosphere = createStillwaterAtmosphere({
            scene,
            quality: qualityProfile.name,
            qualityProfile,
            softParticles: true,
            mistEnabled: true,
            reducedMotion,
        });
        // Volumetric moonshafts — UNBLOCKED by the three r185 upgrade
        // (2026-08-20). The r181 parker: this repo never enables shadow maps,
        // so AnalyticLightNode left `shadowNode` null and r181's volumetric
        // model multiplied by it unconditionally — the `scatteringDensity *
        // null` WGSL error. r185 guards that multiply, and the module is
        // retuned against r185's front-to-back accumulation (iterate via the
        // `stillwater-moonshafts` playground effect). Still opt-in via
        // `?shafts=1` pending an in-theme look call + perf pass; the carve
        // needs a live shadow map and registered casters, both scoped to the
        // opt-in below so the default path pays nothing.
        if (qualityProfile.bloom && !reducedMotion && readToggle(params, 'shafts', false)) {
            renderer.shadowMap.enabled = true;
            shafts = createStillwaterShafts({ root: scene });
            // The carve is the canopy's silhouette: only marked casters render
            // into the moon SpotLight's shadow map. The far forest sits beyond
            // the volume — the near/hero wood is what cuts the light.
            const shaftCasterRoots = new Set([
                'stillwater-hero-root-flare-trees',
                'stillwater-authored-hero-trunks',
                'stillwater-instanced-mid-tree-variants',
                'stillwater-instanced-canopy-language',
            ]);
            scene.traverse((obj) => {
                if (!shaftCasterRoots.has(obj.name)) return;
                obj.traverse((child) => {
                    if (child.isMesh || child.isInstancedMesh) child.castShadow = true;
                });
            });
        }

        reactions = createStillwaterReactions({
            root: integrationRoot,
            quality: qualityProfile.name,
            qualityProfile,
            reducedMotion,
            selectiveBloom,
        });

        materialAudit = sweepSceneMrtMaterials(scene, selectiveBloom);

        postWidth = sizes?.width || renderer.domElement?.width || 1;
        postHeight = sizes?.height || renderer.domElement?.height || 1;
        postPixelRatio = renderer.getPixelRatio?.() || 1;
        pipeline = createPostPipeline(
            postWidth,
            postHeight,
            BASE_BLOOM_STRENGTH,
        );
    } catch (error) {
        pipeline?.dispose?.();
        reactions?.dispose?.();
        atmosphere?.dispose?.();
        characters?.dispose?.();
        forest?.dispose?.();
        water?.dispose?.();
        scene.remove(integrationRoot);
        throw error;
    }

    const waterReaction = {
        time: 0.0001,
        x: 0,
        z: -7,
        strength: 0,
        scale: 1,
        phase: 0,
    };
    const routeCounts = new Uint32Array(10);
    const presetPayload = {
        source: 'stillwater-playground',
        player: 0,
        piece: {
            type: 'T',
            shape: T_SHAPE,
            rotation: 0,
            x: 3,
            y: 14,
            pieceId: 'stillwater-masterpiece-preview-t',
        },
        viewportOrigin: {
            x: queryOriginX,
            y: queryOriginY,
        },
        lineCount: queryLineCount,
        clearedRows: PRESET_ROWS[queryLineCount],
        cascadeCount: 1,
        comboCount: queryComboCount,
        active: true,
        depth: 1,
        level: Math.round(readNumber(params, 'level', 5, 1, 99)),
    };
    const baseBackgroundColor = scene.background?.isColor
        ? scene.background.clone()
        : new THREE.Color(0x020907);
    const enrichedBackgroundColor = new THREE.Color(0x07130f);
    const baseExposure = finiteOr(pipeline.uExposure?.value, BASE_EXPOSURE);

    let currentTime = 0;
    let querySeeded = false;
    let eventEnergy = 0;
    let tideStrength = 0;
    let levelEnrichment = 0;
    let levelEnrichmentTarget = 0;
    let lastForestEnchantment = -1;
    let lastBloomStrength = BASE_BLOOM_STRENGTH;
    let lastAtmosphereMotion = reducedMotion ? 0.28 : 1;
    let motionReduced = reducedMotion;
    let criticalReady = false;
    let targetReady = false;

    function resizePostPipeline(width, height) {
        const safeWidth = Math.max(1, finiteOr(width, postWidth || 1));
        const safeHeight = Math.max(1, finiteOr(height, postHeight || 1));
        const pixelRatio = renderer.getPixelRatio?.() || 1;
        if (
            safeWidth === postWidth
            && safeHeight === postHeight
            && pixelRatio === postPixelRatio
        ) {
            return false;
        }

        if (renderer.backend?.isWebGPUBackend === true) {
            // three r181 retains sampled bind groups for resized BloomNode
            // targets. A fresh post graph gives every target a fresh Texture
            // identity, avoiding submits that reference a destroyed h0/h1 view.
            const replacement = createPostPipeline(
                safeWidth,
                safeHeight,
                lastBloomStrength,
            );
            const previous = pipeline;
            pipeline = replacement;
            previous.dispose();
        } else {
            pipeline.resize(safeWidth, safeHeight);
        }
        postWidth = safeWidth;
        postHeight = safeHeight;
        postPixelRatio = pixelRatio;
        return true;
    }

    function kickAtmosphere(strength) {
        eventEnergy = Math.max(
            eventEnergy,
            clamp(finiteOr(strength, 0.35), 0, 1.35),
        );
    }

    function triggerWater(type, options) {
        writeStillwaterWaterReaction(waterReaction, options, currentTime);
        if (type === 'tspin') waterReaction.phase = 1;
        return water.triggerReaction(type, waterReaction);
    }

    function routePrimary(route, options) {
        routeCounts[route] += 1;
        const strength = clamp(finiteOr(options?.strength, 0.4), 0, 1.35);
        kickAtmosphere(strength);

        if (route === ROUTE.LOCK) {
            reactions.dimple(options);
            triggerWater('lock', options);
            forest.pulse('lock', options);
            characters.pulse('lock', strength);
            return;
        }
        if (route === ROUTE.HARD_DROP) {
            reactions.dimple(options);
            triggerWater('lock', options);
            // Forest's line-clear pulse drives the prebuilt reed/leaf relay,
            // producing a gust without allocating a second particle system.
            forest.pulse('lineClear', options);
            characters.pulse('hardDrop', strength);
            return;
        }
        if (route === ROUTE.WAKE) {
            reactions.wake(options);
            const isTetris = finiteOr(options?.lineCount, 1) >= 4;
            triggerWater(isTetris ? 'tetris' : 'lock', options);
            forest.pulse('lineClear', options);
            characters.pulse(isTetris ? 'tetris' : 'lineClear', strength);
            return;
        }
        if (route === ROUTE.TWIST) {
            reactions.twist(options);
            triggerWater('tspin', options);
            forest.pulse('tspin', options);
            characters.pulse('tspin', strength);
            return;
        }
        if (route === ROUTE.MIRACLE) {
            reactions.miracle(options);
            const isAwakening = options?.cue === STILLWATER_CUE.STILLWATER_AWAKENING;
            triggerWater('tetris', options);
            forest.pulse(isAwakening ? 'perfectClear' : 'combo', options);
            characters.pulse(isAwakening ? 'perfectClear' : 'combo10', strength);
            return;
        }

        const isTwistEcho = options?.echoOf === STILLWATER_CUE.NACKS_TURN;
        const isAwakeningEcho = options?.echoOf
            === STILLWATER_CUE.STILLWATER_AWAKENING;
        let forestEcho = 'lineClear';
        let characterEcho = 'tetris';
        if (isTwistEcho) {
            forestEcho = 'tspin';
            characterEcho = 'tspin';
        } else if (isAwakeningEcho) {
            forestEcho = 'perfectClear';
            characterEcho = 'perfectClear';
        }
        reactions.echo(options);
        triggerWater(isTwistEcho ? 'tspin' : 'tetris', options);
        forest.pulse(forestEcho, options);
        characters.pulse(characterEcho, strength);
    }

    const sink = Object.freeze({
        dimple(options) {
            routePrimary(
                options?.cue === STILLWATER_CUE.STONEFALL_DIMPLE
                    ? ROUTE.HARD_DROP
                    : ROUTE.LOCK,
                options,
            );
        },
        wake(options) {
            routePrimary(ROUTE.WAKE, options);
        },
        twist(options) {
            routePrimary(ROUTE.TWIST, options);
        },
        miracle(options) {
            routePrimary(ROUTE.MIRACLE, options);
        },
        echo(options) {
            routePrimary(ROUTE.ECHO, options);
        },
        spiritAttention(options) {
            routeCounts[ROUTE.SPIRIT_ATTENTION] += 1;
            characters.pulseSpirit('combo10', options?.strength);
        },
        trollCue(options) {
            routeCounts[ROUTE.TROLL_CUE] += 1;
            const tier = finiteOr(options?.comboTier, 0);
            let trollKind = 'lineClear';
            if (tier >= 4) trollKind = 'combo10';
            else if (tier >= 3) trollKind = 'comboHigh';
            characters.pulseTroll(trollKind, options?.strength);
        },
        tide(options) {
            routeCounts[ROUTE.TIDE] += 1;
            reactions.tide(options);
            tideStrength = clamp(finiteOr(options?.strength, 0), 0, 1);
        },
        levelUp(options) {
            routeCounts[ROUTE.LEVEL_UP] += 1;
            const level = Math.max(1, finiteOr(options?.level, 1));
            levelEnrichmentTarget = Math.max(
                levelEnrichmentTarget,
                clamp(0.1 + (level - 1) * 0.055, 0.1, 1),
            );
        },
    });

    const director = new StillwaterReactionDirector({
        sink,
        reducedMotion,
        intensity: 1,
        acceptPayload: acceptsLocalStillwaterPayload,
    });
    let attachedBus = null;
    let attachedEvents = null;

    function detach() {
        director.detach();
        attachedBus = null;
        attachedEvents = null;
    }

    function attach(bus, events) {
        if (disposed) return detach;
        if (bus === attachedBus && events === attachedEvents) return detach;
        detach();
        if (!bus || typeof bus.on !== 'function' || !events) return detach;
        director.attach(bus, events);
        attachedBus = bus;
        attachedEvents = events;
        return detach;
    }

    // Weights for the Offering Loop's leaky accumulator. Deliberately NOT a 1:1
    // trigger map: gameplay raises a pool, and only sustained good play arms an
    // ambient gesture. One-to-one coupling reads as a slot machine.
    const OFFERING_WEIGHTS = Object.freeze({
        [STILLWATER_EVENT.LINE_CLEAR]: 'lineClear',
        [STILLWATER_EVENT.COMBO]: 'combo',
        [STILLWATER_EVENT.TSPIN]: 'tspin',
        [STILLWATER_EVENT.PERFECT_CLEAR]: 'perfectClear',
        [STILLWATER_EVENT.HARD_DROP]: 'hardDrop',
    });

    function pulse(eventName, payload = EMPTY_PAYLOAD) {
        const canonicalEvent = normalizedCanonicalEvent(eventName);
        const offeringKind = canonicalEvent === STILLWATER_EVENT.LINE_CLEAR
            && Number(payload?.lines) >= 4
            ? 'tetris'
            : OFFERING_WEIGHTS[canonicalEvent];
        if (offeringKind) offeringLoop.notifyGameplay(offeringKind);
        if (canonicalEvent === STILLWATER_EVENT.PIECE_LOCK) {
            return director.onPieceLock(payload);
        }
        if (canonicalEvent === STILLWATER_EVENT.LINE_CLEAR) {
            return director.onLineClear(payload);
        }
        if (canonicalEvent === STILLWATER_EVENT.COMBO) {
            return director.onCombo(payload);
        }
        if (canonicalEvent === STILLWATER_EVENT.TSPIN) {
            return director.onTSpin(payload);
        }
        if (canonicalEvent === STILLWATER_EVENT.B2B) {
            return director.onB2B(payload);
        }
        if (canonicalEvent === STILLWATER_EVENT.PERFECT_CLEAR) {
            return director.onPerfectClear(payload);
        }
        if (canonicalEvent === STILLWATER_EVENT.HARD_DROP) {
            return director.onHardDrop(payload);
        }
        if (canonicalEvent === STILLWATER_EVENT.LEVEL_UP) {
            return director.onLevelUp(payload);
        }
        return false;
    }

    function triggerPreset(name, payload = presetPayload) {
        const preset = normalizePresetName(name);
        if (preset === 'idle') return false;
        if (payload === presetPayload) {
            let lineCount = queryLineCount;
            if (!hasLineOverride) {
                if (preset === 'tspin') lineCount = 2;
                else if (preset === 'combo') lineCount = 1;
                else if (preset === 'tetris' || preset === 'b2b') lineCount = 4;
            }
            presetPayload.lineCount = lineCount;
            presetPayload.clearedRows = PRESET_ROWS[lineCount];
            presetPayload.comboCount = preset === 'combo'
                ? queryComboCount
                : Number.NaN;
        }

        if (preset === 'levelup') {
            return pulse(STILLWATER_EVENT.LEVEL_UP, payload);
        }
        if (preset === 'harddrop') {
            return pulse(STILLWATER_EVENT.HARD_DROP, payload);
        }
        let staged = pulse(STILLWATER_EVENT.PIECE_LOCK, payload);
        if (preset === 'lock') return staged;

        if (
            preset === 'lineclear'
            || preset === 'tetris'
            || preset === 'tspin'
            || preset === 'combo'
            || preset === 'perfectclear'
            || preset === 'b2b'
        ) {
            staged = pulse(STILLWATER_EVENT.LINE_CLEAR, payload) || staged;
        }
        if (preset === 'combo') {
            staged = pulse(STILLWATER_EVENT.COMBO, payload) || staged;
        } else if (preset === 'tspin') {
            staged = pulse(STILLWATER_EVENT.TSPIN, payload) || staged;
        } else if (preset === 'perfectclear') {
            staged = pulse(STILLWATER_EVENT.PERFECT_CLEAR, payload) || staged;
        } else if (preset === 'b2b') {
            staged = pulse(STILLWATER_EVENT.B2B, payload) || staged;
        }
        return staged;
    }

    function updateVisualResponse(delta) {
        const dt = clamp(finiteOr(delta, 0), 0, 0.1);
        if (eventEnergy > 0 && dt > 0) {
            eventEnergy = Math.max(0, eventEnergy - dt * 0.72);
        }
        if (dt > 0 && Math.abs(levelEnrichmentTarget - levelEnrichment) > 0.00001) {
            const blend = 1 - Math.exp(
                (-Math.LN2 * dt) / LEVEL_ENRICHMENT_HALF_LIFE,
            );
            levelEnrichment += (levelEnrichmentTarget - levelEnrichment) * blend;
        }
        if (scene.background?.isColor) {
            scene.background
                .copy(baseBackgroundColor)
                .lerp(enrichedBackgroundColor, levelEnrichment);
        }
        if (pipeline.uExposure) {
            pipeline.uExposure.value = baseExposure + levelEnrichment * 0.045;
        }
        characters.setLevelEnrichment?.(levelEnrichment);
        const forestEnchantment = Math.max(tideStrength, levelEnrichment * 0.24);
        if (Math.abs(forestEnchantment - lastForestEnchantment) > 0.0005) {
            forest.setEnchantmentTide?.(forestEnchantment);
            lastForestEnchantment = forestEnchantment;
        }
        const baseMotion = motionReduced ? 0.28 : 1;
        const atmosphereMotion = baseMotion
            + eventEnergy * (motionReduced ? 0.10 : 0.36)
            + tideStrength * (motionReduced ? 0.03 : 0.10)
            + levelEnrichment * (motionReduced ? 0.012 : 0.045);
        if (Math.abs(atmosphereMotion - lastAtmosphereMotion) > 0.0005) {
            atmosphere.uMotion.value = atmosphereMotion;
            lastAtmosphereMotion = atmosphereMotion;
        }

        const bloomStrength = BASE_BLOOM_STRENGTH
            + tideStrength * 0.10
            + eventEnergy * 0.055
            + levelEnrichment * 0.065;
        if (Math.abs(bloomStrength - lastBloomStrength) > 0.0005) {
            pipeline.setBloomStrength(bloomStrength);
            lastBloomStrength = bloomStrength;
        }
    }

    function advanceModules(time, delta, advanceDirector = true) {
        currentTime = time;
        reactions.update(time);
        if (advanceDirector) director.update(delta);
        water.update(time, delta);
        forest.update(time, delta);
        characters.update(time, delta);
        // Feed the spirit's live position back into the lake so its bank spill
        // and reflected column follow the figure. The scene's surfaces are unlit
        // node materials, so this is the only way its light reaches the world.
        // Site the lantern spill once; it is a fixed practical.
        if (!lanternSited) {
            water.setLanternGlow?.(
                LANTERN_WORLD.x,
                LANTERN_WORLD.y,
                LANTERN_WORLD.z,
                qualityProfile.bloom ? 1 : 0,
            );
            lanternSited = true;
        }
        if (offering && qualityProfile.bloom) {
            water.setLanternGlow?.(
                LANTERN_WORLD.x,
                LANTERN_WORLD.y,
                LANTERN_WORLD.z,
                offering.lanternIntensity,
            );
        }
        // Advance the Offering Loop and let it drive the lantern. Intimacy is
        // the one scalar the ambient story exposes: several consumers read it,
        // which is what makes the scene feel authored rather than assembled.
        offering = offeringLoop.update(delta);
        shafts?.update(time);
        // The shafts fade as dawn approaches: the night is ending.
        shafts?.setIntensity(0.85 * (1 - offering.dawn * 0.55));
        // The arc has to be visible in the IMAGE, not only in behaviour.
        pipeline?.setDawn?.(offering.dawn);
        const spiritGlow = characters.getSpiritGlow?.();
        if (spiritGlow) {
            water.setSpiritGlow?.(
                spiritGlow.x,
                spiritGlow.y,
                spiritGlow.z,
                spiritGlow.energy,
            );
        }
        atmosphere.update(time, delta);
        updateVisualResponse(delta);
    }

    function primeCapture(time) {
        const captureTime = Math.max(0, finiteOr(time, 0));
        const fxAge = Math.min(queryFxAge, captureTime);
        const birthTime = Math.max(0, captureTime - fxAge);
        const characterPrime = Math.min(birthTime, MAX_CAPTURE_PRIME_SECONDS);
        let primeTime = birthTime - characterPrime;
        characters.update(primeTime, 0);
        while (primeTime < birthTime - Number.EPSILON) {
            const step = Math.min(PRIME_STEP_SECONDS, birthTime - primeTime);
            primeTime += step;
            characters.update(primeTime, step);
        }

        currentTime = birthTime;
        reactions.update(birthTime);
        water.update(birthTime, 0);
        forest.update(birthTime, 0);
        atmosphere.update(birthTime, 0);
        triggerPreset(queryEvent);
        director.update(0);

        let reactionTime = birthTime;
        while (reactionTime < captureTime - Number.EPSILON) {
            const step = Math.min(PRIME_STEP_SECONDS, captureTime - reactionTime);
            reactionTime += step;
            advanceModules(reactionTime, step);
        }
        if (reactionTime === birthTime) advanceModules(captureTime, 0, false);
        querySeeded = true;
    }

    function setReducedMotion(enabled) {
        const value = enabled === true;
        motionReduced = value;
        director.configure({ reducedMotion: value });
        forest.setReducedMotion(value);
        characters.setReducedMotion(value);
        atmosphere.setReducedMotion(value);
        reactions.setReducedMotion(value);
    }

    function setLayout(nextLayoutPolicy = null) {
        activeLayoutPolicy = nextLayoutPolicy;
        cameraPullback = clamp(
            finiteOr(
                nextLayoutPolicy?.camera?.totalPullback
                    ?? nextLayoutPolicy?.totalPullback,
                0,
            ),
            0,
            32,
        );
        return cameraPullback;
    }

    function configureGameplay(options = EMPTY_PAYLOAD) {
        if (disposed || !options || typeof options !== 'object') return false;
        const directorOptions = {};
        if (options.enabled !== undefined) {
            directorOptions.enabled = options.enabled !== false;
        }
        if (options.backgroundComboEffects !== undefined) {
            directorOptions.backgroundComboEffects = options.backgroundComboEffects !== false;
        }
        if (options.pieceLockRipple !== undefined) {
            directorOptions.pieceLockRipple = options.pieceLockRipple !== false;
        }
        if (options.intensity !== undefined) {
            directorOptions.intensity = options.intensity;
        }
        if (Object.prototype.hasOwnProperty.call(options, 'acceptPayload')) {
            directorOptions.acceptPayload = typeof options.acceptPayload === 'function'
                ? options.acceptPayload
                : acceptsLocalStillwaterPayload;
        }
        director.configure(directorOptions);
        if (options.reducedMotion !== undefined) {
            setReducedMotion(options.reducedMotion === true);
        }
        return true;
    }

    function resetReactions() {
        director.reset();
        water.clearReactions();
        routeCounts.fill(0);
        eventEnergy = 0;
        tideStrength = 0;
        levelEnrichment = 0;
        levelEnrichmentTarget = 0;
        lastForestEnchantment = 0;
        forest.setEnchantmentTide?.(0);
        characters.setLevelEnrichment?.(0);
        if (scene.background?.isColor) scene.background.copy(baseBackgroundColor);
        if (pipeline.uExposure) pipeline.uExposure.value = baseExposure;
        const baseMotion = motionReduced ? 0.28 : 1;
        atmosphere.uMotion.value = baseMotion;
        lastAtmosphereMotion = baseMotion;
        pipeline.setBloomStrength(BASE_BLOOM_STRENGTH);
        lastBloomStrength = BASE_BLOOM_STRENGTH;
    }

    function runFinalMrtMaterialSweep() {
        if (disposed || finalMrtSweepComplete) return materialAudit;
        materialAudit = sweepSceneMrtMaterials(scene, selectiveBloom);
        finalMrtSweepComplete = true;
        return materialAudit;
    }

    const criticalReadyPromise = Promise.resolve(characters.criticalReady)
        .then((ready) => {
            if (!disposed) criticalReady = ready === true;
            return ready === true;
        });
    const readyPromise = Promise.resolve(characters.ready)
        .then((ready) => {
            if (!disposed) {
                if (ready === true) {
                    characters.settleLodTransition();
                    targetReady = true;
                }
                runFinalMrtMaterialSweep();
            }
            return ready === true;
        });

    function getDiagnostics() {
        return {
            id: meta.id,
            waves: [3, 4, 5, 6, 7],
            quality: qualityProfile.name,
            reducedMotion: motionReduced,
            mrtMissing: materialAudit.mrtMissing,
            nonNodeMaterials: materialAudit.nonNodeMaterials,
            materials: {
                ...materialAudit,
                selectiveBloom,
                finalSweepComplete: finalMrtSweepComplete,
            },
            layout: {
                id: activeLayoutPolicy?.layout || null,
                cameraPullback,
            },
            composition: {
                waterOwnsCamera: true,
                waterProxies: false,
                waterPost: false,
                forestMode: 'flora',
                forestTerrain: false,
                reflectionLayer: REFLECTION_LAYER,
                forestTransform: FOREST_TRANSFORM,
                offering: offering ? {
                    beat: offering.beat,
                    intimacy: offering.intimacy,
                    separation: offering.separation,
                    lanternIntensity: offering.lanternIntensity,
                    reach: offering.reach,
                    dawn: offering.dawn,
                    petrified: offering.petrified,
                    featureToken: offering.featureToken,
                    response: offering.response,
                } : null,
                postOutputs: 1,
            },
            query: {
                event: queryEvent,
                fxAge: queryFxAge,
                lineCount: queryLineCount,
                comboCount: queryComboCount,
                seeded: querySeeded,
            },
            readiness: {
                criticalReady,
                targetReady,
            },
            reaction: {
                eventEnergy,
                tideStrength,
                levelEnrichment,
                levelEnrichmentTarget,
                routeCounts: Array.from(routeCounts),
                director: director.getDebugState(),
            },
            water: water.getDiagnostics(),
            forest: forest.getDiagnostics(),
            characters: characters.getDiagnostics(),
            atmosphere: atmosphere.getDiagnostics(),
            reactions: reactions.getDiagnostics(),
            post: pipeline.getDiagnostics(),
        };
    }

    function getResourceState() {
        const directorState = director.getDebugState();
        return {
            disposed,
            routeCounts,
            waterReaction,
            directorRowBuffers: directorState.rowBuffers,
            directorBeatDue: directorState.beatDue,
            directorBeatSpecial: directorState.beatSpecial,
            directorSinkOptions: directorState.sinkOptions,
            water: water.getResourceState(),
            forest: forest.getResourceState(),
            characters: characters.getResourceState(),
            atmosphere: atmosphere.getResourceState(),
            reactions: reactions.getResourceState(),
            post: pipeline.getResourceState(),
        };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        attachedBus = null;
        attachedEvents = null;
        director.dispose();
        pipeline.dispose();
        reactions.dispose();
        atmosphere.dispose();
        characters.dispose();
        forest.dispose();
        water.dispose();
        scene.remove(integrationRoot);
        integrationRoot.clear();
    }

    const runtimeApi = {
        criticalReady: criticalReadyPromise,
        ready: readyPromise,
        isCriticalReady: () => criticalReady,
        isReady: () => targetReady,
        pulse,
        triggerPreset,
        flushReactions: (delta = 0) => director.update(delta),
        attach,
        detach,
        configureGameplay,
        resetReactions,
        setReducedMotion,
        setLayout,
        // The three reaction draws are built at scene build but parked
        // visible=false (stillwater-reactions.js:210/:296/:422). Handing the
        // theme their root lets the masked warm render create their pipelines
        // instead of paying for them on the first line clear.
        getWarmupRoots: () => (reactions?.root ? [reactions.root] : []),
        getCaptureMeta: () => ({
            event: queryEvent,
            fxAge: queryFxAge,
            quality: qualityProfile.name,
            reducedMotion: motionReduced,
            productionBuilders: true,
            phaseLocked: true,
        }),
        getDiagnostics,
        getResourceState,
        getRendererCounters: water.getRendererCounters,
    };

    return {
        ...runtimeApi,
        get cameraRadius() {
            return 46 + cameraPullback;
        },
        camera(time, activeCamera) {
            water.camera(time, activeCamera);
            const policyCamera = activeLayoutPolicy?.camera;
            const policyPosition = policyCamera?.position;
            const policyTarget = policyCamera?.target;
            if (
                Array.isArray(policyPosition)
                && policyPosition.length >= 3
            ) {
                activeCamera.position.set(
                    finiteOr(policyPosition[0], 0),
                    finiteOr(policyPosition[1], 14.5),
                    finiteOr(policyPosition[2], 39 + cameraPullback),
                );
            } else {
                activeCamera.position.z += cameraPullback;
            }
            if (Array.isArray(policyTarget) && policyTarget.length >= 3) {
                activeCamera.lookAt(
                    finiteOr(policyTarget[0], 0),
                    finiteOr(policyTarget[1], 3.8),
                    finiteOr(policyTarget[2], -15),
                );
            }
            activeCamera.fov = finiteOr(policyCamera?.fov, activeCamera.fov);
            activeCamera.near = finiteOr(policyCamera?.near, activeCamera.near);
            activeCamera.far = finiteOr(policyCamera?.far, activeCamera.far);
            activeCamera.updateProjectionMatrix();
        },
        update(time, delta) {
            if (disposed) return;
            if (!querySeeded) {
                primeCapture(time);
                return;
            }
            advanceModules(time, delta);
        },
        render() {
            if (!disposed) pipeline.render();
        },
        renderAsync() {
            return disposed ? Promise.resolve() : pipeline.renderAsync();
        },
        resize(width, height) {
            if (!disposed) resizePostPipeline(width, height);
        },
        dispose,
    };
}

export const createStillwaterMasterpieceRuntime = createStillwaterRuntime;
