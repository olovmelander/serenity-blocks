/**
 * @fileoverview LevelNodeManager - Manages level node orbs along the path
 *
 * Creates interactive 3D representations for each level,
 * showing state (locked/unlocked/completed) and stars.
 */

import * as THREE from 'three';
import { THEME_REGISTRY } from '../../themes/theme-registry.js';
import { buildThemeIconLookup, resolveThemeIconAssetUrl } from './theme-icon-resolver.js';
import {
    ODYSSEY_NODE_STYLES,
    getChapterProfile,
} from './chapter-environments/shared/chapter-profile.js';

const THEME_ICON_MODULES = import.meta.glob('../../themes/*/*-theme-icon.{png,svg}', {
    import: 'default',
});
const THEME_ICON_LOOKUP = buildThemeIconLookup(THEME_REGISTRY, THEME_ICON_MODULES);

// P3b: map each per-world node shell style to a shader style index.
export const ODYSSEY_NODE_SHELL_STYLE_INDEX = Object.freeze({
    [ODYSSEY_NODE_STYLES.MAGMA_GEODE]: 0,
    [ODYSSEY_NODE_STYLES.BUBBLE_PEARL]: 1,
    [ODYSSEY_NODE_STYLES.SEED_LANTERN]: 2,
    [ODYSSEY_NODE_STYLES.CAIRN_LANTERN]: 3,
    [ODYSSEY_NODE_STYLES.CLOUD_WISP]: 4,
    [ODYSSEY_NODE_STYLES.STARLIT_ORB]: 5,
    [ODYSSEY_NODE_STYLES.LENSED_SHARD]: 6,
    [ODYSSEY_NODE_STYLES.NEON_SIGN]: 7,
});

export function resolveOdysseyNodeShellStyle(chapter, levelId = 1) {
    const profile = getChapterProfile(chapter);
    const style = profile.node?.style || ODYSSEY_NODE_STYLES.MAGMA_GEODE;
    const baseColor = profile.palette?.primary ?? 0xffffff;
    const accentColor = profile.palette?.accent ?? baseColor;
    const seed = (((profile.id || 1) * 97) + ((levelId || 1) * 37)) % 997;

    return {
        style,
        index: ODYSSEY_NODE_SHELL_STYLE_INDEX[style] ?? 0,
        baseColor,
        accentColor,
        seed: seed / 997,
    };
}
const GLASS_ORB_SCALE = 1.12; // Slight size bump for better readability on the board
const GLASS_INNER_RADIUS = 0.95 * GLASS_ORB_SCALE;
const GLASS_OUTER_RADIUS = 1.0 * GLASS_ORB_SCALE;
const GLASS_GLOW_RADIUS = 1.3 * GLASS_ORB_SCALE;
const INNER_FLOW_STRENGTH = 0.28;
const INNER_WOBBLE_STRENGTH = 0.028;
const UPDATE_PROXIMITY_THRESHOLD = 0.15; // Only fully update nodes within this path-distance of the camera
const NODE_PATH_SURFACE_OFFSET_Z = 0.45;

/**
 * LevelNodeManager - Manages level selection orbs
 */
export class LevelNodeManager {
    constructor(scene, pathCurve) {
        this.scene = scene;
        this.pathCurve = pathCurve;
        this.nodes = new Map(); // levelId → NodeObject
        this.selectedNode = null;
        this.hoveredNode = null;
        this.time = 0;
        this.frameCount = 0;
        this.cameraProgress = 0;
        this.textureLoader = new THREE.TextureLoader();
        this.themeTextureCache = new Map(); // iconUrl -> THREE.Texture
        this.themeTextureLoads = new Map(); // iconUrl -> Promise<THREE.Texture|null>
        this.cachedBasePositions = new Map(); // levelId -> THREE.Vector3

        // Shared geometries (reused across all 55 nodes)
        this.sharedInnerGeo = new THREE.SphereGeometry(GLASS_INNER_RADIUS, 32, 32);
        this.sharedGlassGeo = new THREE.SphereGeometry(GLASS_OUTER_RADIUS, 48, 48);
        this.sharedGlowGeo = new THREE.IcosahedronGeometry(GLASS_GLOW_RADIUS, 2);

        // Shared canvas textures (identical across all nodes)
        this.fallbackIconTexture = this.createFallbackIconTexture();
        this.sharedLockTextures = this._createSharedLockTextures();
        this.sharedStarTexture = this.createStarTexture(128);
        this.sharedGlowTexture = this.createGlowTexture(64);

        this.pathEvaluator = null;

        // Instanced Mesh state
        this.instanceCount = 0;
        this.glassInstancedMesh = null;
        this.glowInstancedMesh = null;
        this.lockInstancedMesh = null;
        this.starInstancedMesh = null;
        this.particleSystem = null;
        this.instanceIdMap = new Map(); // levelId -> instanceIndex
        this.nodeIds = []; // index -> levelId
        this.camera = null;

        // P3 focal hierarchy (AAA): the player's current/next node blazes + beat-pulses.
        this.focalHierarchy = false;
        this.worldShellsEnabled = false;
        this.currentLevelId = 1;
        this._beatPulse = 0;
    }

    setAAAVisualsEnabled(enabled) {
        const active = !!enabled;
        this.focalHierarchy = active;
        this.worldShellsEnabled = active;
        this._syncAAAVisualUniforms();
    }

    _syncAAAVisualUniforms() {
        if (this.glassInstancedMesh?.material?.uniforms?.uAAA) {
            this.glassInstancedMesh.material.uniforms.uAAA.value = this.worldShellsEnabled ? 1 : 0;
        }
    }

    setCamera(camera) {
        this.camera = camera;
    }

    setPathEvaluator(evaluator) {
        this.pathEvaluator = evaluator;
    }

    _getPathPoint(t, target) {
        const clampedT = THREE.MathUtils.clamp(t, 0, 1);
        if (this.pathEvaluator) {
            return this.pathEvaluator(clampedT, target);
        }
        return this.pathCurve.getPointAt(clampedT, target);
    }

    setCameraProgress(progress) {
        this.cameraProgress = progress;
    }

    _createSharedLockTextures() {
        // Lock icon texture
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 128, 128);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(64, 50, 28, Math.PI, 0, false);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(36, 50);
        ctx.lineTo(36, 65);
        ctx.moveTo(92, 50);
        ctx.lineTo(92, 65);
        ctx.stroke();
        ctx.fillStyle = '#ff4444';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.roundRect(24, 60, 80, 56, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#220000';
        ctx.beginPath();
        ctx.arc(64, 78, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(58, 82);
        ctx.lineTo(64, 102);
        ctx.lineTo(70, 82);
        ctx.closePath();
        ctx.fill();
        const lockTexture = new THREE.CanvasTexture(canvas);
        lockTexture.needsUpdate = true;

        // Lock glow texture
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = 64;
        glowCanvas.height = 64;
        const glowCtx = glowCanvas.getContext('2d');
        const gradient = glowCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 100, 100, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 50, 50, 0.3)');
        gradient.addColorStop(1, 'rgba(200, 0, 0, 0)');
        glowCtx.fillStyle = gradient;
        glowCtx.fillRect(0, 0, 64, 64);
        const lockGlowTexture = new THREE.CanvasTexture(glowCanvas);

        return { lockTexture, lockGlowTexture };
    }

    rebuildPositionCache() {
        this.nodes.forEach((node) => {
            const point = this._getPathPoint(node.pathPosition);
            point.z += NODE_PATH_SURFACE_OFFSET_Z;
            this.cachedBasePositions.set(node.config.id, point.clone());
        });
    }

    async createNodes(levelData, yieldFn = null) {
        this.instanceCount = levelData.length;
        this.nodeIds = levelData.map((level) => level.id);
        this.nodeIds.forEach((id, index) => this.instanceIdMap.set(id, index));

        this._setupInstancedMeshes();

        const batchSize = 5;
        for (let i = 0; i < levelData.length; i += batchSize) {
            const batch = levelData.slice(i, i + batchSize);
            // Intentional batching keeps the loading overlay animating during node creation.
            // eslint-disable-next-line no-await-in-loop
            const batchNodes = await Promise.all(batch.map((level) => this.createNode(level)));

            const glassStyleAttr = this.glassInstancedMesh.geometry.getAttribute('aNodeStyle');
            const glassColorAttr = this.glassInstancedMesh.geometry.getAttribute('aNodeColor');
            const glassAccentAttr = this.glassInstancedMesh.geometry.getAttribute('aNodeAccentColor');
            const glassSeedAttr = this.glassInstancedMesh.geometry.getAttribute('aNodeSeed');

            batchNodes.forEach((node, index) => {
                const level = batch[index];
                this.nodes.set(level.id, node);
                this.scene.add(node.group);

                // Initialize instance matrix
                const idx = this.instanceIdMap.get(level.id);
                const matrix = new THREE.Matrix4();
                matrix.setPosition(node.group.position);
                this.glassInstancedMesh.setMatrixAt(idx, matrix);
                this.glowInstancedMesh.setMatrixAt(idx, matrix);

                // P3b: static per-world shell style + chapter colour for this node.
                const chapter = level.chapter || 1;
                const shell = resolveOdysseyNodeShellStyle(chapter, level.id);
                const shellColor = node.group.userData.chapterColor || new THREE.Color(shell.baseColor);
                const accentColor = new THREE.Color(shell.accentColor);
                glassStyleAttr.setX(idx, shell.index);
                glassColorAttr.setXYZ(idx, shellColor.r, shellColor.g, shellColor.b);
                glassAccentAttr.setXYZ(idx, accentColor.r, accentColor.g, accentColor.b);
                glassSeedAttr.setX(idx, shell.seed);
            });

            if (yieldFn) {
                // eslint-disable-next-line no-await-in-loop
                await yieldFn();
            }
        }

        this.glassInstancedMesh.instanceMatrix.needsUpdate = true;
        this.glassInstancedMesh.geometry.getAttribute('aNodeStyle').needsUpdate = true;
        this.glassInstancedMesh.geometry.getAttribute('aNodeColor').needsUpdate = true;
        this.glassInstancedMesh.geometry.getAttribute('aNodeAccentColor').needsUpdate = true;
        this.glassInstancedMesh.geometry.getAttribute('aNodeSeed').needsUpdate = true;
        this.glowInstancedMesh.instanceMatrix.needsUpdate = true;
        this.lockInstancedMesh.instanceMatrix.needsUpdate = true;
        this.starInstancedMesh.instanceMatrix.needsUpdate = true;

        console.log('[LevelNodes] Created', this.nodes.size, 'level nodes in batches with instancing');
    }

    _setupInstancedMeshes() {
        const count = this.instanceCount;

        // 1. Glass Instanced Mesh
        // We use a custom shader to support per-instance uniforms (state).
        // P3b: when uAAA>0.5 the shell adopts a per-world identity from per-instance
        // aNodeStyle + aNodeColor (magma geode / bubble / ley-lantern / cairn-crystal /
        // cloud-wisp / starlit / lensed-shard / neon-sign). Off → the original glass.
        const glassMat = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.common,
                THREE.UniformsLib.lights,
                {
                    uTime: { value: 0 },
                    uAAA: { value: this.worldShellsEnabled ? 1 : 0 },
                },
            ]),
            vertexShader: `
                #include <common>
                #include <lights_pars_begin>

                uniform float uTime;
                uniform float uAAA;

                attribute vec4 aState; // x:locked, y:completed, z:hovered, w:selected
                attribute float aNodeStyle;
                attribute vec3 aNodeColor;
                attribute vec3 aNodeAccentColor;
                attribute float aNodeSeed;

                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                varying vec4 vState;
                varying float vNodeStyle;
                varying vec3 vNodeColor;
                varying vec3 vNodeAccentColor;
                varying float vNodeSeed;

                float ns_wave(vec3 p, float seed) {
                    return sin((p.x + seed) * 8.0)
                        * sin((p.y - seed) * 6.0)
                        * sin((p.z + seed * 0.7) * 7.0);
                }

                void main() {
                    vUv = uv;
                    vState = aState;
                    vNodeStyle = aNodeStyle;
                    vNodeColor = aNodeColor;
                    vNodeAccentColor = aNodeAccentColor;
                    vNodeSeed = aNodeSeed;
                    vNormal = normalize(normalMatrix * normal);

                    vec3 transformed = position;
                    if (uAAA > 0.5) {
                        float s = aNodeStyle + 0.5;
                        float wave = ns_wave(position, aNodeSeed * 6.2831);
                        float displacement = 0.0;

                        if (s < 1.0) {
                            displacement = 0.02 + pow(abs(wave), 2.2) * 0.085;
                        } else if (s < 2.0) {
                            displacement = sin(uTime * 0.9 + position.y * 5.0 + aNodeSeed * 12.0) * 0.026;
                        } else if (s < 3.0) {
                            float ribs = pow(abs(sin((uv.x + aNodeSeed) * 18.0)), 8.0);
                            displacement = ribs * 0.055;
                        } else if (s < 4.0) {
                            displacement = floor(abs(wave) * 4.0) * 0.018;
                        } else if (s < 5.0) {
                            displacement = sin(uTime * 0.45 + uv.x * 11.0 + uv.y * 13.0 + aNodeSeed * 9.0) * 0.036;
                        } else if (s < 6.0) {
                            displacement = smoothstep(0.88, 1.0, abs(wave)) * 0.045;
                        } else if (s < 7.0) {
                            transformed.x *= 1.055;
                            transformed.y *= 0.965;
                            displacement = sin(length(uv - 0.5) * 40.0 - uTime * 1.5) * 0.028;
                        } else {
                            transformed.x *= 1.035;
                            transformed.y *= 1.035;
                            transformed.z *= 0.985;
                            displacement = sin((uv.y + aNodeSeed) * 36.0 + uTime * 3.0) * 0.018;
                        }

                        transformed += normal * displacement;
                    }

                    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
                    vViewPosition = -mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uAAA;
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                varying vec4 vState;
                varying float vNodeStyle;
                varying vec3 vNodeColor;
                varying vec3 vNodeAccentColor;
                varying float vNodeSeed;

                float ns_hash21(vec2 p) {
                    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                    p3 += dot(p3, p3.yzx + 33.33);
                    return fract((p3.x + p3.y) * p3.z);
                }

                void main() {
                    float uLocked = vState.x;
                    float uHovered = vState.z;

                    vec3 viewDir = normalize(vViewPosition);
                    float rim = 1.0 - abs(dot(vNormal, viewDir));
                    rim = pow(rim, 2.5);

                    vec3 color;
                    float alpha;

                    if (uAAA > 0.5) {
                        // ── P3b: per-world shell identity ──
                        vec3 nc = vNodeColor;
                        vec3 ac = vNodeAccentColor;
                        float seed = vNodeSeed;
                        float s = vNodeStyle + 0.5;
                        if (s < 1.0) { // magmaGeode — dark cracked shell, molten cracks
                            float n = ns_hash21(floor(vUv * vec2(24.0, 16.0) + seed * 13.0));
                            float cr = smoothstep(0.55, 0.85, n);
                            color = mix(nc * 0.16, ac * 1.65, cr) + ac * rim * 0.45;
                            alpha = 0.26 + cr * 0.45 + rim * 0.3;
                        } else if (s < 2.0) { // bubblePearl — pearlescent thin-film
                            vec3 irid = 0.5 + 0.5 * cos(uTime * 0.24 + rim * 3.2 + seed * 6.0 + vec3(0.0, 2.0, 4.0));
                            float caustic = pow(0.5 + 0.5 * sin((vUv.x + vUv.y) * 28.0 + uTime + seed * 8.0), 3.0);
                            color = mix(vec3(0.82, 0.95, 1.0), irid, 0.55) * mix(vec3(1.0), ac, 0.28);
                            alpha = 0.1 + rim * 0.42 + caustic * 0.1;
                        } else if (s < 3.0) { // seedLantern — warm organic glow
                            float ribs = pow(abs(sin((vUv.x + seed) * 18.0)), 8.0);
                            color = mix(nc * 0.42, ac * 1.2, ribs * 0.65 + rim * 0.38);
                            alpha = 0.18 + ribs * 0.18 + rim * 0.32;
                        } else if (s < 4.0) { // cairnLantern — icy faceted crystal
                            float facet = step(0.5, fract((vUv.x + seed) * 8.0)) * 0.5
                                        + step(0.5, fract((vUv.y - seed) * 8.0)) * 0.5;
                            color = nc * (0.28 + rim * 0.95) + ac * facet * 0.28;
                            alpha = 0.14 + rim * 0.5;
                        } else if (s < 5.0) { // cloudWisp — soft diffuse pastel
                            float wisps = smoothstep(
                                0.3,
                                0.95,
                                0.5 + 0.5 * sin(vUv.x * 15.0 + vUv.y * 10.0 - uTime * 0.7 + seed * 9.0)
                            );
                            color = mix(vec3(0.92), nc, 0.48) * (0.58 + rim * 0.42) + ac * wisps * 0.12;
                            alpha = 0.12 + wisps * 0.15 + rim * 0.26;
                        } else if (s < 6.0) { // starlitOrb — dark with sparkle points
                            float spark = step(0.955, ns_hash21(floor(vUv * 44.0) + floor(uTime * 3.0) + seed * 17.0));
                            color = nc * 0.14 + ac * rim * 0.9 + vec3(1.25, 1.15, 1.5) * spark;
                            alpha = 0.12 + rim * 0.32 + spark * 0.6;
                        } else if (s < 7.0) { // lensedShard — concentric lensing rings
                            float rings = sin(length(vUv - 0.5) * 42.0 - uTime * 2.0 + seed * 8.0) * 0.5 + 0.5;
                            color = mix(nc * 0.18, ac * 1.2, pow(rings, 3.0)) + nc * rim * 0.55;
                            alpha = 0.18 + rim * 0.42;
                        } else { // neonSign — bright electric rim
                            float flick = 0.85 + 0.15 * sin(uTime * 18.0 + vUv.y * 6.0 + seed * 20.0);
                            float scan = step(0.9, fract((vUv.y + uTime * 0.23 + seed) * 13.0));
                            float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
                            float frame = 1.0 - smoothstep(0.025, 0.09, edge);
                            color = nc * (0.5 + rim * 1.35) * flick + ac * (scan * 0.45 + frame * 0.9);
                            alpha = 0.2 + rim * 0.45 + frame * 0.16;
                        }
                    } else {
                        // ── Original white glass (default look, flag off) ──
                        vec3 irid;
                        irid.r = 0.5 + 0.5 * cos(uTime * 0.2 + rim * 3.0 + 0.0);
                        irid.g = 0.5 + 0.5 * cos(uTime * 0.2 + rim * 3.0 + 2.0);
                        irid.b = 0.5 + 0.5 * cos(uTime * 0.2 + rim * 3.0 + 4.0);
                        color = mix(vec3(1.0), irid, 0.15 * rim * (1.0 - uLocked * 0.5));
                        alpha = 0.15 + rim * 0.25;
                    }

                    // Shared locked/hover response.
                    color *= (1.0 - uLocked * 0.4);
                    alpha *= (0.6 + uHovered * 0.4);

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            lights: true,
        });

        this.glassInstancedMesh = new THREE.InstancedMesh(this.sharedGlassGeo, glassMat, count);
        this.glassInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        // Custom attributes
        const stateArray = new Float32Array(count * 4);
        this.glassInstancedMesh.geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(stateArray, 4));

        // P3b: per-instance shell style + chapter colour (static; set in createNodes).
        const nodeStyleArray = new Float32Array(count);
        const nodeColorArray = new Float32Array(count * 3);
        const nodeAccentColorArray = new Float32Array(count * 3);
        const nodeSeedArray = new Float32Array(count);
        this.glassInstancedMesh.geometry.setAttribute(
            'aNodeStyle',
            new THREE.InstancedBufferAttribute(nodeStyleArray, 1),
        );
        this.glassInstancedMesh.geometry.setAttribute(
            'aNodeColor',
            new THREE.InstancedBufferAttribute(nodeColorArray, 3),
        );
        this.glassInstancedMesh.geometry.setAttribute(
            'aNodeAccentColor',
            new THREE.InstancedBufferAttribute(nodeAccentColorArray, 3),
        );
        this.glassInstancedMesh.geometry.setAttribute(
            'aNodeSeed',
            new THREE.InstancedBufferAttribute(nodeSeedArray, 1),
        );

        this.scene.add(this.glassInstancedMesh);

        // 2. Glow Instanced Mesh
        // P3 focal hierarchy: aState.z flags the player's "current" node so it blazes
        // and beat-pulses (uBeatPulse). z stays 0 unless focalHierarchy is enabled, so
        // the default look is unchanged.
        const glowMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uBeatPulse: { value: 0 },
            },
            vertexShader: `
                attribute vec3 aColor;
                attribute vec3 aState; // x:locked, y:hovered, z:current

                varying vec3 vNormal;
                varying vec3 vColor;
                varying vec3 vState;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vColor = aColor;
                    vState = aState;
                    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uBeatPulse;
                varying vec3 vNormal;
                varying vec3 vColor;
                varying vec3 vState;

                void main() {
                    float uLocked = vState.x;
                    float uHovered = vState.y;
                    float uCurrent = vState.z;

                    float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 3.0);

                    // Current/next node blazes and pulses with the beat for focal pop.
                    float emphasis = uHovered * 0.3 + uCurrent * (0.45 + uBeatPulse * 0.5);
                    float alpha = rim * (0.2 + emphasis) * (1.0 - uLocked * 0.7);
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
        });

        this.glowInstancedMesh = new THREE.InstancedMesh(this.sharedGlowGeo, glowMat, count);
        this.glowInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const colorArray = new Float32Array(count * 3);
        const glowStateArray = new Float32Array(count * 3);
        this.glowInstancedMesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colorArray, 3));
        this.glowInstancedMesh.geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(glowStateArray, 3));

        this.scene.add(this.glowInstancedMesh);

        // 3. Lock Instanced Mesh (Plane Mesh)
        const lockGeo = new THREE.PlaneGeometry(0.9, 0.9);
        const lockMat = new THREE.MeshBasicMaterial({
            map: this.sharedLockTextures.lockTexture,
            transparent: true,
            alphaTest: 0.1,
            depthWrite: false,
            side: THREE.BackSide, // Since we want it inside/on top relative to camera? Actually DoubleSide is safer for billboards
        });
        this.lockInstancedMesh = new THREE.InstancedMesh(lockGeo, lockMat, count);
        this.lockInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.lockInstancedMesh);

        // 4. Star Instanced Mesh (Plane Mesh) - 3 stars per level
        const starGeo = new THREE.PlaneGeometry(0.7, 0.7);
        const starMat = new THREE.MeshBasicMaterial({
            map: this.sharedStarTexture,
            transparent: true,
            alphaTest: 0.1,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this.starInstancedMesh = new THREE.InstancedMesh(starGeo, starMat, count * 3);
        this.starInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.starInstancedMesh);

        // 5. High-Fidelity Particles (Instanced Points)
        // 128 particles per node * 55 nodes = 7040 particles in one draw call
        const particleCountPerNode = 128;
        const totalParticles = count * particleCountPerNode;
        const particleGeo = new THREE.BufferGeometry();

        const offsetArray = new Float32Array(totalParticles * 3); // Position within the orb
        const pStateArray = new Float32Array(totalParticles * 2); // x: speed mult, y: phase offset

        for (let i = 0; i < count; i++) {
            for (let j = 0; j < particleCountPerNode; j++) {
                const idx = i * particleCountPerNode + j;

                // Random point inside sphere r=0.8
                const r = Math.random() * 0.8;
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);

                offsetArray[idx * 3] = r * Math.sin(phi) * Math.cos(theta);
                offsetArray[idx * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
                offsetArray[idx * 3 + 2] = r * Math.cos(phi);

                pStateArray[idx * 2] = 0.5 + Math.random(); // speed
                pStateArray[idx * 2 + 1] = Math.random() * Math.PI * 2; // phase
            }
        }

        particleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(totalParticles * 3), 3));
        particleGeo.setAttribute('aOffset', new THREE.BufferAttribute(offsetArray, 3));
        particleGeo.setAttribute('aPState', new THREE.BufferAttribute(pStateArray, 2));

        const particleMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uNodePositions: { value: [] }, // We'll update this or use instance data
            },
            vertexShader: `
                attribute vec3 aOffset;
                attribute vec2 aPState;
                uniform float uTime;

                // We'll pass node positions via an attribute since we have many particles per node
                attribute vec3 aNodePos;
                attribute float aNodeScale;
                attribute float aNodeLocked;

                varying float vOpacity;

                void main() {
                    float speed = aPState.x * mix(1.0, 0.35, aNodeLocked);
                    float phase = aPState.y;
                    float t = uTime * speed + phase;

                    // Gentle orbital movement
                    vec3 animatedOffset = aOffset;
                    animatedOffset.x += sin(t * 0.7) * 0.1;
                    animatedOffset.y += cos(t * 0.5) * 0.1;
                    animatedOffset.z += sin(t * 1.1) * 0.1;

                    vec3 worldPos = aNodePos + animatedOffset * aNodeScale;
                    vOpacity = 0.4 + sin(t * 1.5) * 0.2;

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
                    gl_PointSize = (2.5 * aNodeScale) * (300.0 / length(gl_Position.xyz));
                }
            `,
            fragmentShader: `
                varying float vOpacity;
                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;
                    float alpha = smoothstep(0.5, 0.2, dist) * vOpacity;
                    gl_FragColor = vec4(1.0, 0.7, 0.2, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        // Add node positions as attributes to the particles
        const nodePosArray = new Float32Array(totalParticles * 3);
        const nodeScaleArray = new Float32Array(totalParticles);
        const nodeLockedArray = new Float32Array(totalParticles);

        particleGeo.setAttribute('aNodePos', new THREE.BufferAttribute(nodePosArray, 3));
        particleGeo.setAttribute('aNodeScale', new THREE.BufferAttribute(nodeScaleArray, 1));
        particleGeo.setAttribute('aNodeLocked', new THREE.BufferAttribute(nodeLockedArray, 1));

        this.particleSystem = new THREE.Points(particleGeo, particleMat);
        this.particleSystem.frustumCulled = false; // Always update all for now, or chunk it
        this.scene.add(this.particleSystem);
    }

    /**
     * Create a single level node
     * @param {Object} levelConfig
     * @returns {Object}
     */
    async createNode(levelConfig) {
        return this.createGlassNode(levelConfig);
    }

    async createGlassNode(levelConfig) {
        const group = new THREE.Group();
        group.userData.levelId = levelConfig.id;
        group.userData.locked = true;
        group.userData.completed = false;
        group.userData.stars = 0;
        const chapterColor = this.getChapterColor(levelConfig.chapter || 1);

        // Position on path
        const pathPosition = levelConfig.pathPosition || (levelConfig.id - 1) / 55;
        const point = this._getPathPoint(pathPosition);
        group.position.copy(point);
        group.position.z += NODE_PATH_SURFACE_OFFSET_Z;

        // Cache the base position for per-frame floating animation (avoids getPointAt per frame)
        this.cachedBasePositions.set(levelConfig.id, group.position.clone());

        // 1. Inner "Theme" Sphere (Solid textured sphere inside)
        const themeId = levelConfig.iconThemeId
            || levelConfig.theme?.pathIcon
            || levelConfig.theme?.primary;
        const themeTex = await this.getOrLoadThemeTexture(themeId);

        // Inner sphere acts as the solid core, hiding the path line that passes through
        const innerMat = this.createFluidInnerMaterial(themeTex, chapterColor, levelConfig.id);
        const innerMesh = new THREE.Mesh(this.sharedInnerGeo, innerMat);
        group.add(innerMesh);

        // 2. Outer Glass Sphere (Moved to InstancedMesh)
        // The interactive shell is now handled by the shared instanced mesh.

        // 3. Internal Particles (Moved to Instanced System)
        // We no longer add particles to individual groups

        // Standard UI Elements (Moved to Instanced System)
        // We no longer create individual lock/star groups

        // Store chapter color for instanced glow
        group.userData.chapterColor = chapterColor;

        return {
            group,
            coreMesh: innerMesh,
            coreMaterial: innerMat,
            config: levelConfig,
            pathPosition,
            isGlassNode: true,
            innerMesh,
        };
    }

    async getOrLoadThemeTexture(themeId) {
        const iconUrl = await resolveThemeIconAssetUrl(themeId, THEME_ICON_LOOKUP);
        if (!iconUrl) {
            return null;
        }

        if (this.themeTextureCache.has(iconUrl)) {
            return this.themeTextureCache.get(iconUrl);
        }

        if (this.themeTextureLoads.has(iconUrl)) {
            return this.themeTextureLoads.get(iconUrl);
        }

        const loadPromise = new Promise((resolve) => {
            this.textureLoader.load(
                iconUrl,
                (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    this.themeTextureCache.set(iconUrl, texture);
                    this.themeTextureLoads.delete(iconUrl);
                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.warn(
                        `[LevelNodes] Failed to load theme icon texture for "${themeId || 'unknown'}":`,
                        error,
                    );
                    this.themeTextureLoads.delete(iconUrl);
                    resolve(null);
                },
            );
        });

        this.themeTextureLoads.set(iconUrl, loadPromise);
        return loadPromise;
    }

    createFluidInnerMaterial(themeTex, chapterColor, levelId) {
        const hasThemeTexture = Boolean(themeTex);
        const iconTexture = themeTex || this.fallbackIconTexture;
        const fallback = chapterColor.clone();
        const seed = ((levelId || 1) * 0.61803398875) % 1000;

        return new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: iconTexture },
                uUseTexture: { value: hasThemeTexture ? 1.0 : 0.0 },
                uFallbackColor: { value: fallback },
                uTime: { value: 0 },
                uSeed: { value: seed },
                uFlowStrength: { value: INNER_FLOW_STRENGTH },
                uWobbleStrength: { value: INNER_WOBBLE_STRENGTH },
                uLocked: { value: 0.0 },
                uCompleted: { value: 0.0 },
                uHovered: { value: 0.0 },
                uSelected: { value: 0.0 },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uSeed;
                uniform float uWobbleStrength;
                uniform float uLocked;

                varying vec2 vUv;
                varying vec3 vViewNormal;

                void main() {
                    vUv = uv;
                    vViewNormal = normalize(normalMatrix * normal);

                    vec3 transformed = position;
                    float speed = mix(0.22, 1.25, 1.0 - uLocked);
                    float phase = uTime * speed + uSeed;
                    float waveA = sin(phase + position.y * 7.0 + position.x * 5.0);
                    float waveB = cos(phase * 0.8 + position.z * 6.0 - position.y * 4.0);
                    float wobble = (waveA + waveB * 0.65) * uWobbleStrength;
                    transformed += normal * wobble;

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uMap;
                uniform float uUseTexture;
                uniform vec3 uFallbackColor;
                uniform float uTime;
                uniform float uSeed;
                uniform float uFlowStrength;
                uniform float uLocked;
                uniform float uCompleted;
                uniform float uHovered;
                uniform float uSelected;

                varying vec2 vUv;
                varying vec3 vViewNormal;

                void main() {
                    vec2 uv = vUv;
                    float speed = mix(0.28, 1.25, 1.0 - uLocked);
                    float t = uTime * speed + uSeed;

                    vec2 centered = uv - 0.5;
                    float radius = length(centered);

                    vec2 flow = vec2(
                        sin((uv.y + t * 0.42) * 10.0) + cos((uv.y * 1.7 - t * 0.31) * 5.0),
                        cos((uv.x - t * 0.37) * 10.0) + sin((uv.x * 1.4 + t * 0.33) * 5.0)
                    );

                    float swirlEnvelope = smoothstep(0.75, 0.0, radius);
                    vec2 swirlDir = vec2(-centered.y, centered.x);

                    uv += flow * (uFlowStrength * 0.010);
                    uv += swirlDir
                        * (sin(t * 1.2 + radius * 11.0) * uFlowStrength * 0.05 * swirlEnvelope);
                    uv = clamp(uv, vec2(0.01), vec2(0.99));

                    vec4 tex = texture2D(uMap, uv);
                    vec3 color = uFallbackColor;
                    if (uUseTexture > 0.5) {
                        color = tex.rgb;
                    }

                    float luma = dot(color, vec3(0.299, 0.587, 0.114));
                    color = mix(vec3(luma), color, 1.0 - (uLocked * 0.45));
                    color *= mix(0.45, 1.0, 1.0 - uLocked);
                    color += uCompleted * 0.15; // Subtle glow for completed levels

                    float rim = 1.0 - abs(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 2.2);
                    color += rim * 0.08;
                    color *= 1.0 + (uHovered * 0.10) + (uSelected * 0.06);

                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.FrontSide,
            transparent: false,
            toneMapped: false,
        });
    }

    createFallbackIconTexture() {
        const data = new Uint8Array([255, 255, 255, 255]);
        const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
    }
    // Old sprite methods removed

    /**
     * Create a 5-pointed star texture via canvas
     * @param {number} size - Canvas size
     * @returns {THREE.CanvasTexture}
     */
    createStarTexture(size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const cx = size / 2;
        const cy = size / 2;
        const outerRadius = size * 0.4;
        const innerRadius = size * 0.18;
        const spikes = 5;

        // Clear
        ctx.clearRect(0, 0, size, size);

        // Draw star with gradient fill
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerRadius);
        gradient.addColorStop(0, '#ffffcc'); // Bright center
        gradient.addColorStop(0.3, '#ffdd00'); // Golden
        gradient.addColorStop(0.7, '#ffaa00'); // Deep gold
        gradient.addColorStop(1, '#ff8800'); // Orange edge

        ctx.fillStyle = gradient;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();

        for (let i = 0; i < spikes * 2; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (i * Math.PI) / spikes - Math.PI / 2;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Add shine highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.beginPath();
        ctx.arc(cx - outerRadius * 0.2, cy - outerRadius * 0.2, outerRadius * 0.15, 0, Math.PI * 2);
        ctx.fill();

        return new THREE.CanvasTexture(canvas);
    }

    /**
     * Create a radial glow texture for sprites
     * @param {number} size - Texture size
     * @returns {THREE.CanvasTexture}
     */
    createGlowTexture(size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(
            size / 2,
            size / 2,
            0,
            size / 2,
            size / 2,
            size / 2,
        );
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(255, 220, 100, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 180, 50, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 150, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        return new THREE.CanvasTexture(canvas);
    }

    getChapterColor(chapter) {
        // ═══════════════════════════════════════════════════════════════════
        // VIBRANT CHAPTER COLORS - Saturated and eye-catching
        // ═══════════════════════════════════════════════════════════════════
        return new THREE.Color(getChapterProfile(chapter).palette?.primary ?? 0xffffff);
    }

    /**
     * Update nodes from player progress
     * @param {Object} progressData
     */
    updateFromProgress(progressData) {
        if (!progressData?.levelProgress) return;

        this.nodes.forEach((node, levelId) => {
            const levelProgress = progressData.levelProgress[levelId];
            const isUnlocked = levelId <= (progressData.furthestLevel || 1);
            const isCompleted = levelProgress?.completed || false;
            const stars = levelProgress?.stars || 0;

            this.setNodeState(levelId, {
                locked: !isUnlocked,
                completed: isCompleted,
                stars,
            });
        });

        // P3: the "current" node = the lowest unlocked level not yet completed
        // (the one the player should play next), else the furthest unlocked.
        const furthest = progressData.furthestLevel || 1;
        let current = furthest;
        for (let id = 1; id <= furthest; id += 1) {
            if (!progressData.levelProgress[id]?.completed) {
                current = id;
                break;
            }
        }
        this.currentLevelId = current;
    }

    /**
     * Set state for a specific node
     */
    setNodeState(levelId, state) {
        const node = this.nodes.get(levelId);
        if (!node) return;

        node.group.userData.locked = state.locked;
        node.group.userData.completed = state.completed;
        node.group.userData.stars = state.stars;

        // Update core material uniforms (this is the inner fluid sphere)
        if (node.coreMaterial?.uniforms) {
            if (node.coreMaterial.uniforms.uLocked) {
                node.coreMaterial.uniforms.uLocked.value = state.locked ? 1.0 : 0.0;
            }
            if (node.coreMaterial.uniforms.uCompleted) {
                node.coreMaterial.uniforms.uCompleted.value = state.completed ? 1.0 : 0.0;
            }
        }

        // Instanced UI (Lock, Stars) states are handled in update() based on userData below
        // Note: Glass and Glow effects are handled by InstancedMesh in update()
        // which pulls state from node.group.userData updated above.
    }

    /**
     * Set hover state for a node
     */
    setNodeHovered(levelId, hovered) {
        const node = this.nodes.get(levelId);
        if (!node) {
            this.hoveredNode = null;
            return;
        }

        const isHovered = hovered ? 1.0 : 0.0;

        // Update core material uniforms if they exist
        if (node.coreMaterial?.uniforms?.uHovered) {
            node.coreMaterial.uniforms.uHovered.value = isHovered;
        }

        // Scale up on hover
        const targetScale = hovered ? 1.2 : 1.0;
        node.group.scale.setScalar(targetScale);

        this.hoveredNode = hovered ? levelId : null;
    }

    /**
     * Set selected state for a node
     */
    setNodeSelected(levelId, selected) {
        const node = this.nodes.get(levelId);
        if (!node) {
            this.selectedNode = null;
            return;
        }

        const isSelected = selected ? 1.0 : 0.0;

        // Update core material uniforms if they exist
        if (node.coreMaterial?.uniforms?.uSelected) {
            node.coreMaterial.uniforms.uSelected.value = isSelected;
        }

        this.selectedNode = selected ? levelId : null;
    }

    /**
     * Get position of a node
     */
    getNodePosition(levelId) {
        const node = this.nodes.get(levelId);
        return node?.group.position.clone();
    }

    updateLayout(levelData = [], pathCurve = null) {
        if (pathCurve) {
            this.pathCurve = pathCurve;
        }

        levelData.forEach((level) => {
            const node = this.nodes.get(level.id);
            if (!node) return;

            node.config = {
                ...node.config,
                pathPosition: level.pathPosition,
            };
            node.pathPosition = level.pathPosition;
            this.updateNodePathPlacement(node);
        });

        // If the path curve changed, rebuild all cached positions
        if (pathCurve) {
            this.rebuildPositionCache();
        }
    }

    /**
     * Update path placement for a single node.
     * @param {Object} node - Node object (result of createNode)
     */
    updateNodePathPlacement(node) {
        if (!node) return;

        const point = this._getPathPoint(node.pathPosition);
        node.group.position.copy(point);
        node.group.position.z += NODE_PATH_SURFACE_OFFSET_Z;
        // Refresh cached base position
        this.cachedBasePositions.set(node.config.id, node.group.position.clone());
    }

    /**
     * Get projected screen-space metrics for a node's orb.
     * Used by the portal transition so the breach opens from the actual orb radius.
     * @param {number} levelId
     * @param {THREE.Camera} camera
     * @returns {{center: {x: number, y: number}, radius: number, onScreen: boolean, worldPosition: THREE.Vector3}|null}
     */
    getNodeCinematicMetrics(levelId, camera) {
        const node = this.nodes.get(levelId);
        if (!node?.group || !camera) {
            return null;
        }

        const worldPosition = new THREE.Vector3();
        const worldRight = new THREE.Vector3();
        const worldUp = new THREE.Vector3();
        const cameraQuaternion = new THREE.Quaternion();

        node.group.getWorldPosition(worldPosition);
        camera.getWorldQuaternion(cameraQuaternion);

        const scale = Math.max(
            Math.abs(node.group.scale.x || 1),
            Math.abs(node.group.scale.y || 1),
            Math.abs(node.group.scale.z || 1),
        );
        const orbRadiusWorld = GLASS_OUTER_RADIUS * scale;

        worldRight.set(1, 0, 0).applyQuaternion(cameraQuaternion).multiplyScalar(orbRadiusWorld);
        worldUp.set(0, 1, 0).applyQuaternion(cameraQuaternion).multiplyScalar(orbRadiusWorld);

        const centerNdc = worldPosition.clone().project(camera);
        const rightNdc = worldPosition.clone().add(worldRight).project(camera);
        const upNdc = worldPosition.clone().add(worldUp).project(camera);

        const center = {
            x: (centerNdc.x + 1) * 0.5,
            y: (1 - centerNdc.y) * 0.5,
        };
        const radiusX = Math.hypot(
            ((rightNdc.x + 1) * 0.5) - center.x,
            ((1 - rightNdc.y) * 0.5) - center.y,
        );
        const radiusY = Math.hypot(
            ((upNdc.x + 1) * 0.5) - center.x,
            ((1 - upNdc.y) * 0.5) - center.y,
        );
        const radius = Math.max(radiusX, radiusY);
        const onScreen = centerNdc.z >= -1
            && centerNdc.z <= 1
            && center.x >= 0
            && center.x <= 1
            && center.y >= 0
            && center.y <= 1
            && Number.isFinite(radius)
            && radius > 0;

        return {
            center,
            radius: Number.isFinite(radius) ? radius : 0,
            onScreen,
            worldPosition,
        };
    }

    /**
     * Raycast to find hovered node
     * @returns {number|null} Level ID or null
     */
    /**
     * Raycast against level nodes
     * @param {THREE.Raycaster} raycaster
     * @returns {number|null} Level ID or null
     */
    raycast(raycaster) {
        if (!this.glassInstancedMesh) return null;

        const intersects = raycaster.intersectObject(this.glassInstancedMesh);
        if (intersects.length > 0) {
            const [{ instanceId }] = intersects;
            const levelId = this.nodeIds[instanceId];
            const node = this.nodes.get(levelId);

            // Only interact if not locked
            if (node && !node.group.userData.locked) {
                return levelId;
            }
        }
        return null;
    }

    /**
     * Update animation
     * @param {number} deltaTime
     * @param {number} [beatPulse] - director beat pulse (AAA focal hierarchy)
     */
    update(deltaTime, beatPulse = 0) {
        this.time += deltaTime;
        this.frameCount += 1;
        this._beatPulse = beatPulse;

        if (!this.glassInstancedMesh
            || !this.glowInstancedMesh
            || !this.particleSystem
            || !this.camera
            || !this.lockInstancedMesh
            || !this.starInstancedMesh) {
            return;
        }

        if (this.glassInstancedMesh.material.uniforms?.uTime) {
            this.glassInstancedMesh.material.uniforms.uTime.value = this.time;
        }
        if (this.glowInstancedMesh.material.uniforms?.uTime) {
            this.glowInstancedMesh.material.uniforms.uTime.value = this.time;
        }
        if (this.glowInstancedMesh.material.uniforms?.uBeatPulse) {
            this.glowInstancedMesh.material.uniforms.uBeatPulse.value = this.focalHierarchy ? beatPulse : 0;
        }

        const glassStateAttr = this.glassInstancedMesh.geometry.getAttribute('aState');
        const glowColorAttr = this.glowInstancedMesh.geometry.getAttribute('aColor');
        const glowStateAttr = this.glowInstancedMesh.geometry.getAttribute('aState');

        const particleCountPerNode = 128;
        const particleNodePosAttr = this.particleSystem.geometry.getAttribute('aNodePos');
        const particleNodeScaleAttr = this.particleSystem.geometry.getAttribute('aNodeScale');
        const particleNodeLockedAttr = this.particleSystem.geometry.getAttribute('aNodeLocked');

        const matrix = new THREE.Matrix4();

        this.nodes.forEach((node) => {
            const levelId = node.config.id;
            const idx = this.instanceIdMap.get(levelId);
            const distance = Math.abs(node.pathPosition - this.cameraProgress);

            // Strict visibility culling
            const isVisible = distance < (UPDATE_PROXIMITY_THRESHOLD * 1.5);
            node.group.visible = isVisible;

            if (!isVisible) {
                matrix.makeScale(0, 0, 0);
                this.glassInstancedMesh.setMatrixAt(idx, matrix);
                this.glowInstancedMesh.setMatrixAt(idx, matrix);
                this.lockInstancedMesh.setMatrixAt(idx, matrix);
                for (let s = 0; s < 3; s++) this.starInstancedMesh.setMatrixAt(idx * 3 + s, matrix);

                // Hide particles for this node
                for (let p = 0; p < particleCountPerNode; p++) {
                    particleNodeScaleAttr.setX(idx * particleCountPerNode + p, 0);
                }
                return;
            }

            const isNear = distance < UPDATE_PROXIMITY_THRESHOLD;

            // Floating animation
            const basePos = this.cachedBasePositions.get(levelId);
            if (basePos) {
                const floatY = Math.sin(this.time * 2 + levelId) * 0.1;
                node.group.position.y = basePos.y + floatY;
            }

            // Sync instance matrices
            matrix.compose(node.group.position, node.group.quaternion, node.group.scale);
            this.glassInstancedMesh.setMatrixAt(idx, matrix);
            this.glowInstancedMesh.setMatrixAt(idx, matrix);

            // 1. Lock Billboard Matrix
            const isLocked = node.group.userData.locked;
            if (isLocked) {
                matrix.identity();
                matrix.copy(this.camera.matrixWorld);
                matrix.setPosition(node.group.position.x, node.group.position.y + 1.1, node.group.position.z + 1.3);
                // Apply node scale to lock
                const s = node.group.scale.x * 0.9;
                matrix.scale(new THREE.Vector3(s, s, s));
                this.lockInstancedMesh.setMatrixAt(idx, matrix);
            } else {
                matrix.makeScale(0, 0, 0);
                this.lockInstancedMesh.setMatrixAt(idx, matrix);
            }

            // 2. Star Billboard Matrices
            const isCompleted = node.group.userData.completed;
            const stars = node.group.userData.stars || 0;
            const starPositions = [
                new THREE.Vector3(-0.5, 1.4, 1.2),
                new THREE.Vector3(0, 1.6, 1.3),
                new THREE.Vector3(0.5, 1.4, 1.2),
            ];

            for (let s = 0; s < 3; s++) {
                if (isCompleted && s < stars) {
                    matrix.identity();
                    matrix.copy(this.camera.matrixWorld);
                    const pos = starPositions[s].clone().multiplyScalar(node.group.scale.x);
                    matrix.setPosition(node.group.position.clone().add(pos));
                    const scale = node.group.scale.x * 0.7;
                    matrix.scale(new THREE.Vector3(scale, scale, scale));
                    this.starInstancedMesh.setMatrixAt(idx * 3 + s, matrix);
                } else {
                    matrix.makeScale(0, 0, 0);
                    this.starInstancedMesh.setMatrixAt(idx * 3 + s, matrix);
                }
            }

            // Sync particle attributes
            for (let p = 0; p < particleCountPerNode; p++) {
                const pIdx = idx * particleCountPerNode + p;
                particleNodePosAttr.setXYZ(pIdx, node.group.position.x, node.group.position.y, node.group.position.z);
                particleNodeScaleAttr.setX(pIdx, node.group.scale.x);
                particleNodeLockedAttr.setX(pIdx, isLocked ? 1.0 : 0.0);
            }

            // Sync instance attributes
            const isHovered = (this.hoveredNode === levelId) ? 1.0 : 0.0;
            const isSelected = (this.selectedNode === levelId) ? 1.0 : 0.0;

            glassStateAttr.setXYZW(idx, isLocked ? 1.0 : 0.0, isCompleted ? 1.0 : 0.0, isHovered, isSelected);

            const color = node.group.userData.chapterColor || new THREE.Color(0xffffff);
            glowColorAttr.setXYZ(idx, color.r, color.g, color.b);
            const isCurrent = (this.focalHierarchy && levelId === this.currentLevelId && !isLocked) ? 1.0 : 0.0;
            glowStateAttr.setXYZ(idx, isLocked ? 1.0 : 0.0, isHovered, isCurrent);

            if (isNear) {
                if (node.coreMaterial?.uniforms?.uTime) {
                    node.coreMaterial.uniforms.uTime.value = this.time;
                }
            }
        });

        this.glassInstancedMesh.instanceMatrix.needsUpdate = true;
        this.glowInstancedMesh.instanceMatrix.needsUpdate = true;
        this.lockInstancedMesh.instanceMatrix.needsUpdate = true;
        this.starInstancedMesh.instanceMatrix.needsUpdate = true;
        glassStateAttr.needsUpdate = true;
        glowColorAttr.needsUpdate = true;
        glowStateAttr.needsUpdate = true;

        particleNodePosAttr.needsUpdate = true;
        particleNodeScaleAttr.needsUpdate = true;
        particleNodeLockedAttr.needsUpdate = true;
        if (this.particleSystem.material.uniforms?.uTime) {
            this.particleSystem.material.uniforms.uTime.value = this.time;
        }
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.nodes.forEach((node) => {
            if (node.coreMaterial) node.coreMaterial.dispose();
            if (node.glowMaterial) node.glowMaterial.dispose();
            if (node.innerMesh?.material) node.innerMesh.material.dispose();
            this.scene.remove(node.group);
        });

        // Dispose shared geometries
        this.sharedInnerGeo?.dispose();
        this.sharedGlassGeo?.dispose();
        this.sharedGlowGeo?.dispose();

        // Dispose shared textures
        this.sharedLockTextures?.lockTexture?.dispose();
        this.sharedLockTextures?.lockGlowTexture?.dispose();
        this.sharedStarTexture?.dispose();
        this.sharedGlowTexture?.dispose();

        // Dispose instanced meshes
        if (this.glassInstancedMesh) {
            this.glassInstancedMesh.geometry.dispose();
            this.glassInstancedMesh.material.dispose();
            this.scene.remove(this.glassInstancedMesh);
        }
        if (this.glowInstancedMesh) {
            this.glowInstancedMesh.geometry.dispose();
            this.glowInstancedMesh.material.dispose();
            this.scene.remove(this.glowInstancedMesh);
        }

        if (this.lockInstancedMesh) {
            this.lockInstancedMesh.geometry.dispose();
            this.lockInstancedMesh.material.dispose();
            this.scene.remove(this.lockInstancedMesh);
        }
        if (this.starInstancedMesh) {
            this.starInstancedMesh.geometry.dispose();
            this.starInstancedMesh.material.dispose();
            this.scene.remove(this.starInstancedMesh);
        }

        if (this.particleSystem) {
            this.particleSystem.geometry.dispose();
            this.particleSystem.material.dispose();
            this.scene.remove(this.particleSystem);
        }
        this.themeTextureCache.forEach((texture) => texture.dispose());
        this.themeTextureCache.clear();
        if (this.fallbackIconTexture) {
            this.fallbackIconTexture.dispose();
            this.fallbackIconTexture = null;
        }
        this.cachedBasePositions.clear();
        this.nodes.clear();
    }
}

export default LevelNodeManager;
