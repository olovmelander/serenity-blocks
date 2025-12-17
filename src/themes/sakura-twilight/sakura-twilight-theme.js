/**
 * @fileoverview Sakura Twilight Theme - Instanced Optimization
 * Features:
 * - HIGH PERFORMANCE: Uses THREE.InstancedMesh for forest (3 draw calls vs 360)
 * - Custom Vertex Shader for volumetric gradient on instances
 * - Perlin noise wind animation
 * - Atmospheric falling petals
 * - Twilight fog and lighting
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BaseTheme } from '../base-theme.js';
import modelUrl from '/src/themes/sakura-twilight/assets/landscape-glb.glb?url';
import foxModelUrl from '/src/themes/sakura-twilight/assets/Fox.glb?url';
import { eventBus, EVENTS } from '../../events/event-bus.js';



export default class SakuraTwilightTheme extends BaseTheme {
    constructor() {
        super('sakura-twilight');

        // Three.js components
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.clock = new THREE.Clock();

        // Resources
        this.sharedCanopyMaterial = null; // Single material for all leaves
        this.instancedMeshes = []; // Store [canopyMesh, trunkMesh, landscapeMesh]

        this.pulseIntensity = 0; // Current pulse value (0 to 1)

        this.animationId = null;

        // Configuration
        this.config = {
            canopyPrefix: 'NOVA_COPA',

            // Shader Parameters (Volumetric Gradient)
            gradientStart: -1.0,
            gradientEnd: 2.7,
            highlightStart: 0.5,
            highlightEnd: 1.8,

            // Wind Parameters (Trees)
            windStrength: 0.1,
            windSpeed: 0.5,
            windFrequency: 5.0,

            // Colors (Sakura Palette)
            litColor: new THREE.Color('#ffb7c5'),
            shadowColor: new THREE.Color('#db7093'),
            highlightColor: new THREE.Color('#fff0f5'),
            fogColor: new THREE.Color('#2d1b4e'),

            // Grass Parameters
            grassBaseColor: new THREE.Color('#1a4d1a'),  // Darker base
            grassTipColor: new THREE.Color('#4cff4c'),   // Brighter tips
            grassWindStrength: 0.12,  // Increased for visible sway
            grassWindSpeed: 1.2,
        };

        this.petals = null;
        this.petalData = [];
        this.grassMaterial = null; // Custom grass material

        // Celestial objects
        this.moonGroup = null;
        this.moonMesh = null;
        this.moonGlowLayers = [];
        this.starfield = null;
        this.starPositions = []; // Store star positions for constellation lines

        // Constellation effect
        this.constellationLines = null;
        this.constellationMaterial = null;
        this.constellationOpacity = 0;
        this.constellationTargetOpacity = 0;

        // Lanterns
        this.lanterns = [];
        this.lanternLights = [];

        // Fox agents - two foxes with different behaviors
        this.foxes = [];
        this.foxMixers = [];

        this.eventUnsubscribers = [];
    }

    async createScene() {
        console.log('[SakuraTheme] Initialization started (Optimized)');

        const container = document.getElementById('sakura-twilight-theme');
        if (!container) return;

        container.innerHTML = '';

        // 1. Setup Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        // 2. Setup Scene
        this.scene = new THREE.Scene();
        this.scene.background = this.config.fogColor;
        this.scene.fog = new THREE.Fog(this.config.fogColor, 10, 80);

        // 3. Setup Camera
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(20, 4, 30); // Raised slightly
        this.camera.lookAt(0, 4, 0); // Look at tree mid-height

        // 4. Setup Lights - TWILIGHT ATMOSPHERE
        // Cool blue ambient for moonlit night
        const ambientLight = new THREE.AmbientLight(0x6677aa, 0.8);
        this.scene.add(ambientLight);

        // Subtle warm directional (simulates last rays of sunset or ambient glow)
        const dirLight = new THREE.DirectionalLight(0xeeddff, 0.6);
        dirLight.position.set(50, 80, 50);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 1024;  // Reduced for performance
        dirLight.shadow.mapSize.height = 1024;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 200;
        dirLight.shadow.camera.left = -100;
        dirLight.shadow.camera.right = 100;
        dirLight.shadow.camera.top = 100;
        dirLight.shadow.camera.bottom = -100;
        this.scene.add(dirLight);

        // 5. Load Assets & Generate Forest
        await this.loadModelAndCreateForest();
        this.createPetals();
        this.createGrass(); // Add animated grass
        this.createMoon();  // Add moon with glow
        this.createStarfield();  // Add twinkling stars
        this.createLanterns();  // Add glowing lanterns
        await this.loadFoxes();  // Add wandering foxes

        this.setupEventListeners();
        this.isActive = true;
        this.animate();

        // 6. Listeners & Loop
        window.addEventListener('resize', this.onWindowResize.bind(this));

        console.log('[SakuraTheme] Initialization complete');
    }

    async loadModelAndCreateForest() {
        const loader = new GLTFLoader();
        try {
            const gltf = await loader.loadAsync(modelUrl);

            // --- Extract Geometries and Materials ---
            let trunkGeo = null, trunkMat = null;
            let groundGeo = null, groundMat = null;
            let canopyMat = null;

            // Collect ALL canopy geometries to merge later
            const canopyGeometries = [];
            let canopyOffset = new THREE.Vector3();
            let groundOffset = new THREE.Vector3();
            let trunkOffset = new THREE.Vector3();

            // First pass: update world matrices
            gltf.scene.updateMatrixWorld(true);

            gltf.scene.traverse((obj) => {
                if (obj.isMesh) {
                    const name = obj.name.toLowerCase();

                    if (name.includes('copa') || name.includes('leaves') || name.includes(this.config.canopyPrefix.toLowerCase())) {
                        // Clone geometry and apply world transform
                        const geo = obj.geometry.clone();
                        geo.applyMatrix4(obj.matrixWorld);
                        canopyGeometries.push(geo);

                        // Capture material from first canopy only
                        if (!canopyMat) {
                            canopyMat = obj.material.clone();

                            // Calculate Local Center for shader (based on first canopy)
                            obj.geometry.computeBoundingBox();
                            const center = new THREE.Vector3();
                            obj.geometry.boundingBox.getCenter(center);
                            // Transform center to world space
                            center.applyMatrix4(obj.matrixWorld);
                            this.localCanopyCenter = center;

                            console.log('[SakuraTheme] First canopy center:', center);
                        }
                    } else if (name.includes('landscape') || name.includes('ground')) {
                        if (!groundGeo) {
                            groundGeo = obj.geometry.clone();
                            groundGeo.applyMatrix4(obj.matrixWorld);
                            groundMat = obj.material.clone();
                            groundMat.color.setHex(0x2d5a27); // Grass green
                        }
                    } else if (name.includes('trunk') || name.includes('tronco') || name.includes('arvore') || name.includes('bark')) {
                        if (!trunkGeo) {
                            trunkGeo = obj.geometry.clone();
                            trunkGeo.applyMatrix4(obj.matrixWorld);
                            // Don't translate here - will do it after merging canopy
                            // so both use the same offset

                            trunkMat = new THREE.MeshStandardMaterial({
                                color: 0x3d2b1f,
                                roughness: 0.9
                            });
                        }
                    }
                }
            });

            // Merge all canopy geometries into one
            if (canopyGeometries.length === 0) {
                console.error('[SakuraTheme] No canopy geometries found!');
                return;
            }
            console.log(`[SakuraTheme] Merging ${canopyGeometries.length} canopy geometries`);
            const mergedCanopyGeo = BufferGeometryUtils.mergeGeometries(canopyGeometries, false);

            if (!trunkGeo || !mergedCanopyGeo) {
                console.error('[SakuraTheme] Missing tree parts!');
                return;
            }

            // CRITICAL FIX: Use TRUNK's base Y as the ground reference
            // Both trunk and canopy must be translated by the SAME offset
            // to maintain their relative positioning
            trunkGeo.computeBoundingBox();
            const trunkBaseY = trunkGeo.boundingBox.min.y;

            // Translate both geometries by trunk's base Y
            trunkGeo.translate(0, -trunkBaseY, 0);
            mergedCanopyGeo.translate(0, -trunkBaseY, 0);

            // Compute canopy center for shader (after translation)
            mergedCanopyGeo.computeBoundingBox();
            const mergedCenter = new THREE.Vector3();
            mergedCanopyGeo.boundingBox.getCenter(mergedCenter);
            this.localCanopyCenter = mergedCenter;
            console.log('[SakuraTheme] Tree grounded. Trunk baseY offset:', trunkBaseY, 'Canopy center:', mergedCenter);

            // Create Procedural Ground Layer
            this.createGroundLayer();

            // --- InstancedMesh Creation ---
            const count = 100; // Reduced from 200 for performance (fog hides distant areas)
            const matrix = new THREE.Matrix4();
            const position = new THREE.Vector3();
            const rotation = new THREE.Euler();
            const quaternion = new THREE.Quaternion();
            const scale = new THREE.Vector3();

            // 1. Trunk Instances (Standard Material) - geometry has world transform baked in
            const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
            trunkMesh.castShadow = false;  // Disabled - shadows from canopy are enough
            trunkMesh.receiveShadow = true;

            // 2. Ground/Landscape Instances (DISABLED - using procedural terrain)
            // if (groundGeo && groundMat) {
            //     landscapeMesh = new THREE.InstancedMesh(groundGeo, groundMat, count);
            //     landscapeMesh.receiveShadow = true;
            // }

            // 3. Canopy Instances (With Custom Material) - using MERGED geometry
            this.setupSharedCanopyMaterial(canopyMat);
            const canopyMesh = new THREE.InstancedMesh(mergedCanopyGeo, this.sharedCanopyMaterial, count);
            canopyMesh.castShadow = false;  // Disabled - will enable per-instance via frustum later
            canopyMesh.receiveShadow = true;
            canopyMesh.customDepthMaterial = new THREE.MeshDepthMaterial({
                depthPacking: THREE.RGBADepthPacking,
                map: canopyMat.map,
                alphaTest: 0.5
            });

            // 4. Shadow/Dirt Decals (Grounding the trees)
            const shadowGeo = new THREE.PlaneGeometry(1, 1);
            const shadowTexture = this.createShadowTexture();
            const shadowMat = new THREE.MeshBasicMaterial({
                map: shadowTexture,
                transparent: true,
                depthWrite: false, // Don't write to depth buffer to avoid z-fighting artifacts
                polygonOffset: true,
                polygonOffsetFactor: -1, // Pull forward slightly
                color: 0x000000,
                opacity: 0.6
            });
            const shadowMesh = new THREE.InstancedMesh(shadowGeo, shadowMat, count);

            // --- Scatter Logic ---
            const setInstance = (index, pos, rotY, s) => {
                // Pos is the TREE position (already sunk)
                position.copy(pos);
                rotation.set(0, rotY, 0);
                quaternion.setFromEuler(rotation);
                scale.set(s, s, s);
                matrix.compose(position, quaternion, scale);

                trunkMesh.setMatrixAt(index, matrix);
                canopyMesh.setMatrixAt(index, matrix);

                // Place shadow decal at TERRAIN level
                // Trees are now at exact terrain height (no sink)
                const terrainApprox = pos.y;

                const shadowScale = s * 3.5;
                scale.set(shadowScale, shadowScale, shadowScale);
                rotation.set(-Math.PI / 2, 0, 0);
                quaternion.setFromEuler(rotation);

                const shadowPos = pos.clone();
                shadowPos.y = terrainApprox + 0.1; // Place 0.1 above terrain

                matrix.compose(shadowPos, quaternion, scale);
                shadowMesh.setMatrixAt(index, matrix);
            };

            // Tree height offset - minimal to sit in short grass
            const treeHeightOffset = 0.1;

            // Store tree data for procedural lantern placement
            this.treeData = [];

            // Hero Tree - placed at origin (adjusted for terrain)
            const heroY = this.getTerrainHeight(0, -5) + treeHeightOffset;
            const heroPos = new THREE.Vector3(0, heroY, -5);
            setInstance(0, heroPos, 0, 1.3);
            this.treeData.push({ pos: heroPos.clone(), scale: 1.3 });

            // Foreground trees - framing the view on left and right
            // Camera is at (20, 4, 30), looking at (0, 4, 0)
            const foregroundTrees = [
                // Very close to camera - framing edges
                { x: 32, z: 42, scale: 1.2 },  // Right edge, very close
                { x: 6, z: 40, scale: 1.1 },   // Left edge, very close
                { x: 28, z: 36, scale: 0.95 }, // Right mid-close
                { x: 12, z: 38, scale: 1.0 },  // Left mid-close
                // Mid-distance framing
                { x: 30, z: 32, scale: 1.1 },  // Right side
                { x: 8, z: 35, scale: 0.9 },   // Left side
                { x: 35, z: 25, scale: 1.0 },  // Right side, mid
                { x: 5, z: 28, scale: 1.2 },   // Left side, mid
                // Center-front trees to fill the gap
                { x: 18, z: 22, scale: 0.95 }, // Center-left 
                { x: 12, z: 18, scale: 1.0 },  // Center 
                { x: 6, z: 12, scale: 0.9 },   // Left-center front
                { x: -5, z: 10, scale: 1.1 },  // Far left front
                { x: 25, z: 18, scale: 0.85 }, // Center-right
            ];

            let placedCount = 1; // Already placed hero tree
            foregroundTrees.forEach(tree => {
                const y = this.getTerrainHeight(tree.x, tree.z) + treeHeightOffset;
                const pos = new THREE.Vector3(tree.x, y, tree.z);
                setInstance(placedCount, pos, Math.random() * Math.PI * 2, tree.scale);
                this.treeData.push({ pos: pos.clone(), scale: tree.scale });
                placedCount++;
            });

            // Random Trees - avoid spawning near camera (20, 4, 30)
            const cameraPos = new THREE.Vector2(20, 30); // Camera XZ position
            const cameraExclusionRadius = 8; // Reduced to allow more trees
            let attempts = 0;
            const maxAttempts = count * 3;

            while (placedCount < count && attempts < maxAttempts) {
                attempts++;
                const angle = Math.random() * Math.PI * 2;
                const radius = 15 + Math.random() * 55; // Min 15, max 70 (closer trees)
                const x = Math.cos(angle) * radius;
                const z = Math.sin(angle) * radius;

                // Check distance from camera
                const distFromCamera = Math.sqrt((x - cameraPos.x) ** 2 + (z - cameraPos.y) ** 2);

                if (distFromCamera > cameraExclusionRadius) {
                    const s = 0.7 + Math.random() * 0.7;
                    const terrainY = this.getTerrainHeight(x, z);
                    const treeY = terrainY + treeHeightOffset; // Raised above grass
                    const pos = new THREE.Vector3(x, treeY, z);
                    setInstance(placedCount, pos, Math.random() * Math.PI * 2, s);
                    this.treeData.push({ pos: pos.clone(), scale: s });
                    placedCount++;
                }
            }

            // Update instance counts if we placed fewer trees
            trunkMesh.count = placedCount;
            canopyMesh.count = placedCount;
            shadowMesh.count = placedCount;

            trunkMesh.instanceMatrix.needsUpdate = true;
            canopyMesh.instanceMatrix.needsUpdate = true;
            shadowMesh.instanceMatrix.needsUpdate = true;

            this.scene.add(trunkMesh);
            this.scene.add(canopyMesh);
            this.scene.add(shadowMesh); // Add shadows
            // if (landscapeMesh) this.scene.add(landscapeMesh); // Disabled landscape

            this.trunkMesh = trunkMesh;
            this.canopyMesh = canopyMesh;
            // this.landscapeMesh = landscapeMesh; // Removed invalid reference
            this.shadowMesh = shadowMesh;

            console.log(`[SakuraTheme] Forest generated (Optimized). Instances: ${placedCount}`);

        } catch (error) {
            console.error('[SakuraTheme] Error loading model:', error);
        }
    }

    // Verdant-hills style terrain height function
    getTerrainHeight(x, z) {
        // Gentler rolling hills for sakura forest (Flattened to fit camera)
        return (Math.sin(x * 0.025) * 12 +
            Math.sin(z * 0.02) * 10 +
            Math.sin(x * 0.06 + z * 0.04) * 5 +
            Math.cos(x * 0.04 - z * 0.03) * 7) * 0.15 - 2.0;
    }

    createGroundLayer() {
        // VERDANT-HILLS STYLE: Procedural rolling terrain
        const size = 300;
        const segments = 64;

        const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        // Apply height displacement using getTerrainHeight
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            const y = this.getTerrainHeight(x, z);
            positions.setY(i, y);
        }
        geometry.computeVertexNormals();

        // Terrain shader with natural grass coloring and fog
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uGrassColor1: { value: new THREE.Color(0x0a2a15) },  // Dark blue-green (moonlit)
                uGrassColor2: { value: new THREE.Color(0x1a4a2a) },  // Muted teal
                uFogColor: { value: this.config.fogColor },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying float vHeight;
                
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    vHeight = position.y;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uGrassColor1;
                uniform vec3 uGrassColor2;
                uniform vec3 uFogColor;
                
                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying float vHeight;
                
                void main() {
                    float heightFactor = smoothstep(-10.0, 25.0, vHeight);
                    vec3 baseColor = mix(uGrassColor1, uGrassColor2, heightFactor);
                    
                    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
                    float lighting = max(0.4, dot(vNormal, lightDir));
                    vec3 color = baseColor * lighting;
                    
                    float dist = length(vWorldPosition - cameraPosition);
                    float fogFactor = smoothstep(20.0, 100.0, dist);
                    color = mix(color, uFogColor, fogFactor);
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        });

        this.terrain = new THREE.Mesh(geometry, material);
        this.terrain.name = 'terrain';
        this.scene.add(this.terrain);
        this.groundMesh = this.terrain;
    }

    createGrass() {
        if (!this.scene) return;

        // --- GENERATE PROCEDURAL GRASS TEXTURE ---
        const grassTexture = this.createGrassTexture();

        // --- FLUFFY BILLBOARD GEOMETRY (4 quads at 45° intervals) ---
        // More planes = fluffier appearance from all angles
        const clumpSize = 2.0;
        const clumpHeight = 0.5; // Short grass
        const numPlanes = 4; // 4 planes for fluffy look

        const positions = [];
        const uvs = [];
        const normals = [];

        // UV scaling - show more of texture to include natural tapered tips
        const uvTop = 0.85; // Show bottom 85% of texture (includes rounded tips)

        for (let i = 0; i < numPlanes; i++) {
            const angle = (i / numPlanes) * Math.PI; // 0, 45, 90, 135 degrees
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const halfSize = clumpSize / 2;

            // Two triangles per plane (6 vertices)
            // Triangle 1
            positions.push(-halfSize * cos, 0, -halfSize * sin);
            positions.push(halfSize * cos, 0, halfSize * sin);
            positions.push(halfSize * cos, clumpHeight, halfSize * sin);
            // Triangle 2
            positions.push(-halfSize * cos, 0, -halfSize * sin);
            positions.push(halfSize * cos, clumpHeight, halfSize * sin);
            positions.push(-halfSize * cos, clumpHeight, -halfSize * sin);

            // UVs - use uvTop instead of 1.0 to crop texture naturally
            uvs.push(0, 0, 1, 0, 1, uvTop);
            uvs.push(0, 0, 1, uvTop, 0, uvTop);

            // Normals pointing up for soft lighting
            for (let j = 0; j < 6; j++) {
                normals.push(0, 1, 0);
            }
        }

        const clumpGeo = new THREE.BufferGeometry();
        clumpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        clumpGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        clumpGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));

        // --- FLUFFY GRASS SHADER MATERIAL ---
        // UV-based gradient: dark at base, bright at tips (fake AO)
        // Includes fake lantern lighting for warm glow effect
        const grassMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uWindStrength: { value: 0.12 },
                uGrassTexture: { value: grassTexture },
                uBaseColor: { value: new THREE.Color(0x0a2a1a) },  // Dark blue-green base (moonlit)
                uTipColor: { value: new THREE.Color(0x2a5a3a) },   // Muted teal-green tips
                uFogColor: { value: this.config.fogColor },
                uFogNear: { value: 20.0 },
                uFogFar: { value: 80.0 },
                uMoonlightTint: { value: new THREE.Color(0xaabbdd) },  // Cool moonlight
                // Lantern glow - just pass a few key positions
                uLanternColor: { value: new THREE.Color(0xffaa55) },  // Warm orange
                uLanternRadius: { value: 15.0 },  // How far the glow reaches
                uPulseIntensity: { value: 0.0 }, // Dynamic pulse on piece lock
            },
            vertexShader: `
                uniform float uTime;
                uniform float uWindStrength;
                uniform float uPulseIntensity;

                varying vec2 vUv;
                varying float vFogDepth;
                varying float vLanternGlow;  // Pass to fragment shader

                void main() {
                    vUv = uv;

                    vec3 pos = position;

                    // Wind animation based on height (uv.y)
                    vec4 worldPos;
                    #ifdef USE_INSTANCING
                        worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
                    #else
                        worldPos = modelMatrix * vec4(position, 1.0);
                    #endif

                    float windPhase = worldPos.x * 0.4 + worldPos.z * 0.3 + uTime * 1.8;
                    float wind = sin(windPhase) * uWindStrength;
                    float wind2 = sin(windPhase * 0.7 + 1.3) * uWindStrength * 0.5;

                    // Apply wind more at the tips (quadratic falloff)
                    float heightFactor = uv.y * uv.y;
                    pos.x += wind * heightFactor;
                    pos.z += wind2 * heightFactor;

                    // Fake lantern glow - procedural pattern creating pools of warm light
                    // Using multiple overlapping sine waves for organic feel
                    float glow1 = sin(worldPos.x * 0.2 + 1.0) * sin(worldPos.z * 0.15) * 0.5 + 0.5;
                    float glow2 = sin(worldPos.x * 0.12 + 3.0) * sin(worldPos.z * 0.18 + 2.0) * 0.5 + 0.5;
                    float glow3 = sin(worldPos.x * 0.25) * sin(worldPos.z * 0.22 + 1.0) * 0.5 + 0.5;
                    float combinedGlow = max(max(glow1, glow2), glow3);
                    
                    // Dynamic pulse expands the glow radius - subtle effect
                    float pulseBoost = 1.0 + uPulseIntensity * 0.8; // Subtle 1.8x brightness at peak
                    float threshold = 0.4 - uPulseIntensity * 0.15; // Slight widening
                    
                    // Threshold to create distinct pools, boost intensity, apply to tips
                    vLanternGlow = smoothstep(threshold, 0.8, combinedGlow) * 0.8 * (0.3 + heightFactor * 0.7) * pulseBoost;

                    #ifdef USE_INSTANCING
                        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
                    #else
                        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    #endif

                    vFogDepth = -mvPosition.z;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D uGrassTexture;
                uniform vec3 uBaseColor;
                uniform vec3 uTipColor;
                uniform vec3 uFogColor;
                uniform float uFogNear;
                uniform float uFogFar;
                uniform vec3 uLanternColor;

                varying vec2 vUv;
                varying float vFogDepth;
                varying float vLanternGlow;

                void main() {
                    vec4 texColor = texture2D(uGrassTexture, vUv);

                    // Hard alpha cutoff like tree leaves - crisp at all distances
                    if (texColor.a < 0.5) discard;

                    // UV-based gradient: dark base to bright tips (fake ambient occlusion)
                    float gradient = smoothstep(0.0, 0.7, vUv.y);
                    vec3 grassColor = mix(uBaseColor, uTipColor, gradient);

                    // Blend with texture
                    vec3 finalColor = grassColor * texColor.rgb * 1.2;
                    
                    // Add subtle moonlight blue tint to tips
                    vec3 moonTint = vec3(0.7, 0.75, 0.9);  // Cool blue
                    finalColor = mix(finalColor, finalColor * moonTint, gradient * 0.4);

                    // Add warm lantern glow - subtle warmth normally, distinct pulse on lock
                    finalColor = finalColor + uLanternColor * vLanternGlow * 0.30;

                    // Apply fog
                    float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
                    finalColor = mix(finalColor, uFogColor, fogFactor);

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            side: THREE.DoubleSide,
            depthWrite: true,
            alphaTest: 0.5,  // Hard cutoff like tree leaves
        });

        this.grassMaterial = grassMat;

        // --- INSTANCING ---
        // 1. Calculate total instances needed
        const baseGrassCount = 500;
        let treeGrassCount = 0;
        const clumpsPerTree = 5;

        let treePositions = [];
        if (this.trunkMesh) {
            treeGrassCount = this.trunkMesh.count * clumpsPerTree;
            // Extract positions
            const mat = new THREE.Matrix4();
            const pos = new THREE.Vector3();
            for (let i = 0; i < this.trunkMesh.count; i++) {
                this.trunkMesh.getMatrixAt(i, mat);
                pos.setFromMatrixPosition(mat);
                treePositions.push(pos.clone());
            }
        }

        const totalGrassCount = baseGrassCount + treeGrassCount;
        const grassMesh = new THREE.InstancedMesh(clumpGeo, grassMat, totalGrassCount);
        grassMesh.renderOrder = 0; // Render with opaque objects (alphaTest handles transparency)
        const dummy = new THREE.Object3D();

        let idx = 0;

        // 2. Place Grass AROUND TREES first (to hide roots)
        treePositions.forEach(treePos => {
            for (let k = 0; k < clumpsPerTree; k++) {
                const angle = (k / clumpsPerTree) * Math.PI * 2 + Math.random();
                const dist = 0.3 + Math.random() * 0.4; // VERY close to trunk (0.3-0.7 units)

                const lx = treePos.x + Math.cos(angle) * dist;
                const lz = treePos.z + Math.sin(angle) * dist;
                // Terrain height at this specific spot
                const ly = this.getTerrainHeight(lx, lz);

                dummy.position.set(lx, ly, lz);

                // Point slightly outward or random
                dummy.rotation.y = Math.random() * Math.PI * 2;

                // Normal height grass, just slightly bigger/denser around trees
                const s = 1.0 + Math.random() * 0.5; // 1.0-1.5x size
                dummy.scale.set(s, s * 1.2, s); // Normal height to match field grass

                dummy.updateMatrix();
                grassMesh.setMatrixAt(idx++, dummy.matrix);
            }
        });

        // 3. Place Grass with HEAVY front bias - most grass near/in front of camera
        // Camera at (20, 4, 30), looking toward (0, 4, 0)
        const cameraX = 20;
        const cameraZ = 30;

        for (let i = 0; i < baseGrassCount; i++) {
            // HEAVY front bias - pow 0.3 means most values cluster near 0 (front)
            const t = Math.pow(Math.random(), 0.3);

            // Front zone: large area around and in front of camera
            // Spread more widely on X axis for framing, closer on Z for depth
            const frontX = cameraX + (Math.random() - 0.5) * 50;  // Wider X spread
            const frontZ = cameraZ + 5 + (Math.random() - 0.5) * 15;  // In front of camera

            // Middle zone: between camera and look target
            const midX = 10 + (Math.random() - 0.5) * 40;
            const midZ = 15 + (Math.random() - 0.5) * 25;

            // Interpolate heavily toward front
            const x = frontX + t * (midX - frontX);
            const z = frontZ + t * (midZ - frontZ);

            const y = this.getTerrainHeight(x, z);

            dummy.position.set(x, y, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;

            // Larger grass in front for more visual impact
            const distScale = 1.2 - t * 0.4; // 1.2 at front, 0.8 at back
            const scale = (0.8 + Math.random() * 0.5) * distScale;
            dummy.scale.set(scale, scale * (0.9 + Math.random() * 0.3), scale);

            dummy.updateMatrix();
            grassMesh.setMatrixAt(idx++, dummy.matrix);
        }

        grassMesh.instanceMatrix.needsUpdate = true;
        grassMesh.frustumCulled = false;
        grassMesh.receiveShadow = true;

        this.scene.add(grassMesh);
        this.grassMesh = grassMesh;

        console.log(`[SakuraTheme] Created ${totalGrassCount} grass clumps (billboard style)`);
    }

    createGrassTexture() {
        const canvas = document.createElement('canvas');
        const size = 1024; // Higher resolution for smooth quality like tree leaves
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Enable smoothing for anti-aliased edges
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Clear with transparent
        ctx.clearRect(0, 0, size, size);

        // Helper: Draw natural grass blade with bezier curves and soft edges
        const drawBlade = (x, height, baseWidth, tipWidth, lean, curve, colors, alpha = 1.0) => {
            const gradient = ctx.createLinearGradient(x, size, x + lean, size - height);
            gradient.addColorStop(0, colors.base);
            gradient.addColorStop(0.25, colors.mid1);
            gradient.addColorStop(0.5, colors.mid2);
            gradient.addColorStop(0.75, colors.mid3);
            gradient.addColorStop(1, colors.tip);

            ctx.globalAlpha = alpha;

            // Add soft shadow for anti-aliased edges (like tree leaves)
            ctx.shadowColor = colors.mid2;
            ctx.shadowBlur = 2;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            ctx.beginPath();
            ctx.moveTo(x - baseWidth / 2, size);

            // Natural curved blade shape using bezier
            ctx.bezierCurveTo(
                x - baseWidth / 4, size - height * 0.35,
                x + curve - tipWidth, size - height * 0.7,
                x + lean, size - height
            );
            ctx.bezierCurveTo(
                x + curve + tipWidth, size - height * 0.7,
                x + baseWidth / 4, size - height * 0.35,
                x + baseWidth / 2, size
            );
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();

            // Reset shadow
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1.0;
        };

        // Color palettes
        const darkPalette = {
            base: '#0a1a0a', mid1: '#152515', mid2: '#1f3f1f', mid3: '#2a5a2a', tip: '#3a7a3a'
        };
        const midPalette = {
            base: '#101f10', mid1: '#1a3a1a', mid2: '#2d5d2d', mid3: '#4a8a4a', tip: '#6aba6a'
        };
        const brightPalette = {
            base: '#152a15', mid1: '#2a4a2a', mid2: '#4a7a4a', mid3: '#6aaa6a', tip: '#8ada8a'
        };
        const accentPalette = {
            base: '#1a3a1a', mid1: '#3a6a3a', mid2: '#5a9a5a', mid3: '#7aca7a', tip: '#9afa9a'
        };

        // Layer 1: Dark background blades - WIDER + SOLID for alphaTest
        for (let i = 0; i < 12; i++) {
            const x = Math.random() * size;
            const height = 400 + Math.random() * 500;
            const baseWidth = 40 + Math.random() * 40;  // Much wider
            const tipWidth = 8 + Math.random() * 10;    // Wider tips
            const lean = (Math.random() - 0.5) * 140;
            const curve = (Math.random() - 0.5) * 80;
            drawBlade(x, height, baseWidth, tipWidth, lean, curve, darkPalette, 1.0);  // Full opacity
        }

        // Layer 2: Main blades (evenly distributed) - WIDER + SOLID
        const mainCount = 14;
        for (let i = 0; i < mainCount; i++) {
            const x = (i / mainCount) * size + (Math.random() - 0.5) * 40;
            const height = 550 + Math.random() * 450;
            const baseWidth = 45 + Math.random() * 45;  // Much wider
            const tipWidth = 10 + Math.random() * 10;   // Wider tips
            const lean = (Math.random() - 0.5) * 160;
            const curve = (Math.random() - 0.5) * 100;
            const palette = Math.random() > 0.4 ? midPalette : brightPalette;
            drawBlade(x, height, baseWidth, tipWidth, lean, curve, palette, 1.0);  // Full opacity
        }

        // Layer 3: Bright accent blades - WIDER + SOLID
        for (let i = 0; i < 10; i++) {
            const x = Math.random() * size;
            const height = 650 + Math.random() * 350;
            const baseWidth = 35 + Math.random() * 35;  // Much wider
            const tipWidth = 8 + Math.random() * 8;     // Wider tips
            const lean = (Math.random() - 0.5) * 180;
            const curve = (Math.random() - 0.5) * 90;
            drawBlade(x, height, baseWidth, tipWidth, lean, curve, accentPalette, 1.0);  // Full opacity
        }

        // Layer 4: Medium detail blades - WIDER (no thin wispy ones)
        for (let i = 0; i < 10; i++) {
            const x = Math.random() * size;
            const height = 400 + Math.random() * 500;
            const baseWidth = 25 + Math.random() * 25;  // Wider than before
            const tipWidth = 6 + Math.random() * 6;     // Thicker tips
            const lean = (Math.random() - 0.5) * 120;
            const curve = (Math.random() - 0.5) * 60;
            const palette = Math.random() > 0.5 ? brightPalette : accentPalette;
            drawBlade(x, height, baseWidth, tipWidth, lean, curve, palette, 1.0);  // Full opacity
        }

        // Layer 5: Thick accent strands (formerly hair-like, now solid for alphaTest)
        ctx.lineCap = 'round';
        for (let i = 0; i < 8; i++) {
            const x = Math.random() * size;
            const height = 300 + Math.random() * 500;
            const lean = (Math.random() - 0.5) * 100;
            const ctrlX = x + (Math.random() - 0.5) * 80;
            const ctrlY = size - height * 0.5;

            const gradient = ctx.createLinearGradient(x, size, x + lean, size - height);
            gradient.addColorStop(0, 'rgb(40, 100, 40)');      // Fully opaque
            gradient.addColorStop(0.5, 'rgb(80, 160, 80)');
            gradient.addColorStop(1, 'rgb(130, 210, 130)');

            ctx.beginPath();
            ctx.moveTo(x, size);
            ctx.quadraticCurveTo(ctrlX, ctrlY, x + lean, size - height);
            ctx.lineWidth = 8 + Math.random() * 10;  // Much thicker strands
            ctx.strokeStyle = gradient;
            ctx.stroke();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.anisotropy = 16; // Maximum anisotropy for smooth quality
        texture.generateMipmaps = true;
        return texture;
    }

    createShadowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Radial Gradient (Black center -> Transparent edge)
        const gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.8)');   // Dark center
        gradient.addColorStop(0.5, 'rgba(10, 10, 0, 0.4)'); // Dirt-like middle
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');     // Transparent edge

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    setupSharedCanopyMaterial(baseMat) {
        this.sharedCanopyMaterial = new THREE.MeshLambertMaterial({
            map: baseMat.map,
            color: baseMat.color,
            alphaMap: baseMat.map,
            transparent: true,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
        });

        // Store locaCenter for shader injection
        const localCenter = this.localCanopyCenter || new THREE.Vector3(0, 5, 0);

        this.sharedCanopyMaterial.onBeforeCompile = (shader) => {
            this.sharedCanopyMaterial.userData.shader = shader;

            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uLocalCanopyCenter = { value: localCenter };
            // Lantern Lighting Uniforms
            shader.uniforms.uLanternPositions = { value: new Float32Array(200 * 3) }; // 200 lanterns max
            shader.uniforms.uLanternCount = { value: 0 };
            shader.uniforms.uPulseIntensity = { value: 0.0 }; // Dynamic pulse

            shader.uniforms.uLightDirection = { value: new THREE.Vector3(0.5, 0.8, 0.5).normalize() };

            // Colors
            shader.uniforms.uLitColor = { value: this.config.litColor };
            shader.uniforms.uShadowColor = { value: this.config.shadowColor };
            shader.uniforms.uHighlightColor = { value: this.config.highlightColor };

            // Gradient Params
            shader.uniforms.uGradientStart = { value: this.config.gradientStart };
            shader.uniforms.uGradientEnd = { value: this.config.gradientEnd };
            shader.uniforms.uHighlightStart = { value: this.config.highlightStart };
            shader.uniforms.uHighlightEnd = { value: this.config.highlightEnd };

            shader.uniforms.uWindStrength = { value: this.config.windStrength };
            shader.uniforms.uWindKey = { value: 0.1 }; // Extra param for noise scale
            shader.uniforms.uWindSpeed = { value: this.config.windSpeed };

            // --- Shader Injection ---

            // 1. Common: Uniforms & Helpers
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `
                #include <common>

                uniform float uTime;
                uniform float uWindStrength;
                uniform float uWindSpeed;
                uniform vec3 uLocalCanopyCenter;
                
                // Lantern Lighting
                uniform vec3 uLanternPositions[200];
                uniform float uLanternCount;
                uniform float uPulseIntensity; // Pulse uniform
                
                varying vec3 vLanternLight; // Pass lighting to fragment

                // Perlin Noise 
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
                float snoise(vec3 v) {
                const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
                const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
                    vec3 i = floor(v + dot(v, C.yyy));
                    vec3 x0 = v - i + dot(i, C.xxx);
                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min(g.xyz, l.zxy);
                    vec3 i2 = max(g.xyz, l.zxy);
                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;
                i = mod289(i);
                    vec4 p = permute(permute(permute(
                    i.z + vec4(0.0, i1.z, i2.z, 1.0))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
                    float n_ = 0.142857142857;
                    vec3  ns = n_ * D.wyz - D.xzx;
                    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
                    vec4 x_ = floor(j * ns.z);
                    vec4 y_ = floor(j - 7.0 * x_);
                    vec4 x = x_ * ns.x + ns.yyyy;
                    vec4 y = y_ * ns.x + ns.yyyy;
                    vec4 h = 1.0 - abs(x) - abs(y);
                    vec4 b0 = vec4(x.xy, y.xy);
                    vec4 b1 = vec4(x.zw, y.zw);
                    vec4 s0 = floor(b0) * 2.0 + 1.0;
                    vec4 s1 = floor(b1) * 2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));
                    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
                    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
                    vec3 p0 = vec3(a0.xy, h.x);
                    vec3 p1 = vec3(a0.zw, h.y);
                    vec3 p2 = vec3(a1.xy, h.z);
                    vec3 p3 = vec3(a1.zw, h.w);
                    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
                p0 *= norm.x;
                p1 *= norm.y;
                p2 *= norm.z;
                p3 *= norm.w;
                    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
                m = m * m;
                return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
            }

                varying vec3 vSakuraWorldPos;
                varying vec3 vInstanceCenterWorld;
            `
            );

            // 2. Vertex: Wind and Lighting Calculation
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
            #include <begin_vertex>

                // --- Calculate World Position First ---
                #ifdef USE_INSTANCING
                    vec4 vWorldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
                #else
                    vec4 vWorldPos = modelMatrix * vec4(transformed, 1.0);
                #endif
                
                vSakuraWorldPos = vWorldPos.xyz;

                // --- Lantern Lighting (Simple Point Light Sum) ---
                vec3 lightAccumulation = vec3(0.0);
                // Check closest lanterns (brute force manageable for vertex count)
                
                float maxCount = uLanternCount; 
                // Loop unrolling hint?
                for (int i = 0; i < 200; i++) {
                     if (float(i) >= maxCount) break;
                     vec3 lPos = uLanternPositions[i];
                     float dist = distance(vWorldPos.xyz, lPos);
                     
                     // Light falloff - subtle pulse effect
                     float radius = 25.0 + uPulseIntensity * 8.0;
                     if (dist < radius) {
                         float atten = 1.0 - smoothstep(0.0, radius, dist);
                         // Subtle boost during pulse
                         float intensity = 5.0 * (1.0 + uPulseIntensity * 0.8); 
                         lightAccumulation += vec3(1.0, 0.7, 0.3) * atten * intensity; 
                     }
                }
                vLanternLight = lightAccumulation;


                // --- Wind Animation ---
                // LOD: Skip expensive wind animation for distant trees
                float distToCamera = length(vWorldPos.xyz - cameraPosition);
                float windLOD = 1.0 - smoothstep(30.0, 50.0, distToCamera);  // Full wind < 30, none > 50
                
                // Wind Animation (only compute if visible)
                float windOffset = 0.0;
                if (windLOD > 0.01) {
                    float noise = snoise(vec3(position.x * 0.5, position.z * 0.5, uTime * uWindSpeed));
                    windOffset = noise * uWindStrength * (position.y * 0.1) * windLOD;
                }

            transformed.x += windOffset;
            transformed.z += windOffset;
            `
            );

            // 3. Project Vertex: Compute Varyings
            shader.vertexShader = shader.vertexShader.replace(
                '#include <project_vertex>',
                `
            #include <project_vertex>

                // Calculate Scale-Corrected World Position for gradient
                vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
            vSakuraWorldPos = worldPos.xyz;

            // Calculate Instance Center
            #ifdef USE_INSTANCING
                    vec4 centerLocal = instanceMatrix * vec4(uLocalCanopyCenter, 1.0);
            vInstanceCenterWorld = (modelMatrix * centerLocal).xyz;
            #else
            vInstanceCenterWorld = (modelMatrix * vec4(uLocalCanopyCenter, 1.0)).xyz;
            #endif
                `
            );

            // 4. Fragment Shader
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `
            #include <common>

                uniform vec3 uLitColor;
                uniform vec3 uShadowColor;
                uniform vec3 uHighlightColor;
                uniform vec3 uLightDirection;
                uniform vec3 uLocalCanopyCenter;
                
                uniform float uGradientStart;
                uniform float uGradientEnd;
                uniform float uHighlightStart;
                uniform float uHighlightEnd;
                uniform float uPulseIntensity; // Pulse for piece lock/combo
                
                varying vec3 vSakuraWorldPos;
                varying vec3 vInstanceCenterWorld;
                varying vec3 vLanternLight;
            `
            );

            // 4. Fragment: Custom Gradient Color + Lantern Light
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `
            #include <map_fragment>

            // Gradient Logic
            vec3 centerWorld = uLocalCanopyCenter; 
            #ifdef USE_INSTANCING
                 centerWorld += vInstanceCenterWorld;
            #endif

            float height = vSakuraWorldPos.y - centerWorld.y;
            float t = smoothstep(uGradientStart, uGradientEnd, height);
            
            // Mix base colors
            vec3 gradientColor = mix(uShadowColor, uLitColor, t);

            // Highlight Logic (Top of canopy)
            float h = smoothstep(uHighlightStart, uHighlightEnd, height);
            gradientColor = mix(gradientColor, uHighlightColor, h * 0.5);
            
            // Combine: Texture * Gradient + Lantern Light (Additive glow)
            diffuseColor.rgb *= gradientColor;
            
            // Add lantern glow
            diffuseColor.rgb += vLanternLight * 0.8;
            
            // Add global pulse effect (subtle warm orange flash during piece lock/combo)
            vec3 pulseColor = vec3(1.0, 0.6, 0.2); // Warm lantern color
            diffuseColor.rgb += pulseColor * uPulseIntensity * 0.25;
            `
            );
        };
    }

    createPetals() {
        if (!this.scene) return;
        const count = 500;
        const geometry = new THREE.PlaneGeometry(0.15, 0.15);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffb7c5, side: THREE.DoubleSide, transparent: true, opacity: 0.8
        });

        this.petals = new THREE.InstancedMesh(geometry, material, count);
        this.petalData = [];

        const dummy = new THREE.Object3D();
        for (let i = 0; i < count; i++) {
            dummy.position.set((Math.random() - 0.5) * 120, Math.random() * 30 + 5, (Math.random() - 0.5) * 120);
            dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            dummy.updateMatrix();
            this.petals.setMatrixAt(i, dummy.matrix);

            this.petalData.push({
                velocity: new THREE.Vector3((Math.random() - 0.5) * 0.05, -(Math.random() * 0.05 + 0.02), (Math.random() - 0.5) * 0.05),
                rotationSpeed: new THREE.Vector3(Math.random() * 0.02, Math.random() * 0.02, Math.random() * 0.02)
            });
        }
        this.petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.petals);
    }

    updatePetals() {
        if (!this.petals) return;
        const dummy = new THREE.Object3D();
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        for (let i = 0; i < this.petals.count; i++) {
            this.petals.getMatrixAt(i, matrix);
            matrix.decompose(position, quaternion, scale);
            position.add(this.petalData[i].velocity);

            if (position.y < -2) {
                position.y = 30;
                position.x = (Math.random() - 0.5) * 120;
                position.z = (Math.random() - 0.5) * 120;
            }

            dummy.position.copy(position);
            dummy.quaternion.copy(quaternion);
            dummy.scale.copy(scale);
            dummy.rotateX(this.petalData[i].rotationSpeed.x);
            dummy.rotateY(this.petalData[i].rotationSpeed.y);
            dummy.rotateZ(this.petalData[i].rotationSpeed.z);
            dummy.updateMatrix();
            this.petals.setMatrixAt(i, dummy.matrix);
        }
        this.petals.instanceMatrix.needsUpdate = true;
    }

    createMoon() {
        const moonSize = 50;  // Much smaller for proper scale

        // Create moon group for positioning - further away for better scale
        this.moonGroup = new THREE.Group();
        this.moonGroup.position.set(-300, 250, -800);  // Upper left, far back
        this.scene.add(this.moonGroup);

        // Moon sphere with detailed crater shader (adapted from blood-moon)
        const geometry = new THREE.SphereGeometry(moonSize, 48, 48);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vLocalPos;
                varying vec3 vViewPosition;

            void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);
                vLocalPos = position;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
            `,
            fragmentShader: `
                uniform float uTime;
                
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vLocalPos;
                varying vec3 vViewPosition;

                // Noise functions for surface detail
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
                
                float snoise(vec3 v) {
                const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
                const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
                    vec3 i = floor(v + dot(v, C.yyy));
                    vec3 x0 = v - i + dot(i, C.xxx);
                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min(g.xyz, l.zxy);
                    vec3 i2 = max(g.xyz, l.zxy);
                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;
                i = mod289(i);
                    vec4 p = permute(permute(permute(
                    i.z + vec4(0.0, i1.z, i2.z, 1.0))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
                    float n_ = 0.142857142857;
                    vec3 ns = n_ * D.wyz - D.xzx;
                    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
                    vec4 x_ = floor(j * ns.z);
                    vec4 y_ = floor(j - 7.0 * x_);
                    vec4 x = x_ * ns.x + ns.yyyy;
                    vec4 y = y_ * ns.x + ns.yyyy;
                    vec4 h = 1.0 - abs(x) - abs(y);
                    vec4 b0 = vec4(x.xy, y.xy);
                    vec4 b1 = vec4(x.zw, y.zw);
                    vec4 s0 = floor(b0) * 2.0 + 1.0;
                    vec4 s1 = floor(b1) * 2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));
                    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
                    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
                    vec3 p0 = vec3(a0.xy, h.x);
                    vec3 p1 = vec3(a0.zw, h.y);
                    vec3 p2 = vec3(a1.xy, h.z);
                    vec3 p3 = vec3(a1.zw, h.w);
                    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
                p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
                    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
                m = m * m;
                return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
            }
                
                float fbm(vec3 p) {
                    float v = 0.0;
                    float a = 0.5;
                for (int i = 0; i < 5; i++) {
                    v += a * snoise(p);
                    p *= 2.0;
                    a *= 0.5;
                }
                return v;
            }

                // Crater with bowl and rim
                float sharpCrater(vec3 pos, vec3 center, float size, float depth) {
                    float d = length(pos - center);
                    float bowl = smoothstep(size, size * 0.15, d);
                    float rim = smoothstep(size * 1.35, size * 0.95, d) * smoothstep(size * 0.8, size * 1.0, d);
                return -bowl * depth + rim * depth * 0.7;
            }

            void main() {
                    vec3 viewDir = normalize(vViewPosition);
                    vec3 pos = normalize(vLocalPos) * 5.0;

                    // Natural silver moon colors
                    vec3 brightHighland = vec3(0.92, 0.90, 0.85);
                    vec3 darkMaria = vec3(0.45, 0.43, 0.40);
                    vec3 craterFloor = vec3(0.25, 0.24, 0.22);
                    vec3 craterRim = vec3(1.0, 0.98, 0.95);

                    // Maria (dark seas)
                    float maria1 = smoothstep(0.2, 0.6, fbm(pos * 0.5 + vec3(1.5, 0.8, 0.3)));
                    float maria2 = smoothstep(0.25, 0.65, fbm(pos * 0.6 + vec3(-2.0, 1.2, 0.8)));
                    float totalMaria = max(maria1, maria2 * 0.9);
                    vec3 baseColor = mix(brightHighland, darkMaria, totalMaria);

                    // Major craters (visible bowl shapes)
                    float craters = 0.0;
                craters += sharpCrater(pos, vec3(2.2, 0.5, 0.8), 1.2, 0.5);
                craters += sharpCrater(pos, vec3(-1.5, 1.5, 1.0), 1.0, 0.45);
                craters += sharpCrater(pos, vec3(0.5, -1.8, 1.3), 0.9, 0.4);
                craters += sharpCrater(pos, vec3(-0.8, 0.2, -2.0), 1.1, 0.45);
                craters += sharpCrater(pos, vec3(1.8, -0.8, 1.5), 0.8, 0.38);

                // Medium craters
                craters += sharpCrater(pos, vec3(1.5, 0.0, 2.0), 0.5, 0.3);
                craters += sharpCrater(pos, vec3(-1.0, 1.8, 1.2), 0.45, 0.28);
                craters += sharpCrater(pos, vec3(0.8, -1.2, 1.8), 0.4, 0.25);

                    // Apply crater coloring
                    float floorDepth = max(0.0, -craters * 4.0);
                baseColor = mix(baseColor, craterFloor, smoothstep(0.0, 1.0, floorDepth) * 0.8);
                    float rimBrightness = max(0.0, craters * 3.0);
                baseColor = mix(baseColor, craterRim, smoothstep(0.0, 0.7, rimBrightness) * 0.6);

                    // Surface texture
                    float roughness = fbm(pos * 4.0) * 0.08 + snoise(pos * 12.0) * 0.04;
                baseColor += vec3(roughness);

                    // Dramatic lighting
                    vec3 lightDir = normalize(vec3(0.5, 0.6, 0.5));
                    float diffuse = max(0.0, dot(vNormal, lightDir));
                diffuse = 0.2 + diffuse * 0.8;
                    
                    vec3 litColor = baseColor * diffuse;

                    // Strong rim glow (silver-blue)
                    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 4.0);
                    vec3 rimGlow = vec3(0.85, 0.9, 1.0);
                litColor += rimGlow * fresnel * 0.8;

                // Emissive glow for brightness
                litColor *= 1.3;

                gl_FragColor = vec4(litColor, 1.0);
            }
            `,
        });

        this.moonMesh = new THREE.Mesh(geometry, material);
        this.moonMesh.renderOrder = 100;
        this.moonGroup.add(this.moonMesh);

        // Enhanced glow layers (brighter, more layers)
        const glowConfigs = [
            { size: moonSize * 1.4, color: 0xffffff, opacity: 0.5, z: -3 },
            { size: moonSize * 1.8, color: 0xeeeeff, opacity: 0.35, z: -6 },
            { size: moonSize * 2.3, color: 0xddddff, opacity: 0.25, z: -10 },
            { size: moonSize * 3.0, color: 0xccccff, opacity: 0.15, z: -15 },
            { size: moonSize * 4.0, color: 0xbbbbee, opacity: 0.08, z: -20 },
        ];

        for (const config of glowConfigs) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(0.1, 'rgba(250, 252, 255, 0.9)');
            gradient.addColorStop(0.3, 'rgba(220, 230, 255, 0.5)');
            gradient.addColorStop(0.6, 'rgba(180, 200, 240, 0.2)');
            gradient.addColorStop(1, 'rgba(150, 170, 220, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const glowGeo = new THREE.PlaneGeometry(config.size, config.size);
            const glowMat = new THREE.MeshBasicMaterial({
                map: texture,
                color: config.color,
                transparent: true,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.position.set(0, 0, config.z);
            glow.renderOrder = 50;
            this.moonGlowLayers.push(glow);
            this.moonGroup.add(glow);
        }

        // Moonlight with shadows - stronger light
        const moonLight = new THREE.DirectionalLight(0xaaccff, 0.6);
        moonLight.position.set(-300, 250, -400);
        moonLight.target.position.set(0, 0, 0);
        moonLight.castShadow = true;
        moonLight.shadow.mapSize.width = 1024;
        moonLight.shadow.mapSize.height = 1024;
        moonLight.shadow.camera.near = 100;
        moonLight.shadow.camera.far = 800;
        moonLight.shadow.camera.left = -100;
        moonLight.shadow.camera.right = 100;
        moonLight.shadow.camera.top = 100;
        moonLight.shadow.camera.bottom = -100;
        this.scene.add(moonLight);
        this.scene.add(moonLight.target);
        this.moonLight = moonLight;

        console.log('[SakuraTheme] Moon created with glow layers');
    }

    createStarfield() {
        const backgroundStarCount = 1200;
        const activeStarCount = 150; // Stars that move and connect
        const totalStars = backgroundStarCount + activeStarCount;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(totalStars * 3);
        const colors = new Float32Array(totalStars * 3);
        const sizes = new Float32Array(totalStars);
        const phases = new Float32Array(totalStars);

        this.activeStarData = []; // Store physics data for moving stars

        // Star colors for twilight sky (whites, blues, pale yellows)
        const starColors = [
            new THREE.Color(0xffffff),  // White
            new THREE.Color(0xffeedd),  // Warm white
            new THREE.Color(0xddddff),  // Pale blue
            new THREE.Color(0xaabbff),  // Light blue
            new THREE.Color(0xffffff),  // White
        ];

        // 1. Create Static Background Stars
        for (let i = 0; i < backgroundStarCount; i++) {
            const i3 = i * 3;
            // Spread stars across upper hemisphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 0.7);  // Bias toward top
            const radius = 800 + Math.random() * 1500;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = Math.abs(radius * Math.cos(phi)) + 100;
            positions[i3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 500;

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 2.0 + Math.random() * 4.0;
            phases[i] = Math.random() * Math.PI * 2;
        }

        // 2. Create Active Moving Stars (for constellations)
        // Use SPHERICAL distribution to cover the entire visible sky dome
        // Camera is at (20, 4, 30) looking toward (0, 4, 0) - so mostly looking at negative Z

        for (let i = backgroundStarCount; i < totalStars; i++) {
            const i3 = i * 3;

            // Use spherical coordinates for even sky coverage
            // theta: azimuth angle (0 to 2*PI for full circle around sky)
            // phi: elevation angle (biased toward upper hemisphere)
            const theta = Math.random() * Math.PI * 2; // Full 360 degrees
            const phi = Math.acos(1 - Math.random() * 0.6); // 0 to ~53 degrees from zenith

            // Larger radius so stars appear behind moon and trees
            const radius = 1000 + Math.random() * 500;

            // Convert to Cartesian - spread across the entire visible sky
            const pos = new THREE.Vector3(
                radius * Math.sin(phi) * Math.cos(theta),
                radius * Math.cos(phi) + 100, // Bias upward, +100 to stay above horizon
                radius * Math.sin(phi) * Math.sin(theta) - 600 // Shift back so visible from camera
            );

            positions[i3] = pos.x;
            positions[i3 + 1] = pos.y;
            positions[i3 + 2] = pos.z;

            // Make active stars warm and subtle, not bright blue
            colors[i3] = 1.0;     // R
            colors[i3 + 1] = 0.95; // G (Warm)
            colors[i3 + 2] = 0.85; // B (Gold-ish)

            sizes[i] = 3.0 + Math.random() * 4.0; // Slightly larger
            phases[i] = Math.random() * Math.PI * 2;

            // Store physics data
            this.activeStarData.push({
                index: i, // Index in the main buffer
                position: pos.clone(),
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.3, // Slightly faster drift
                    (Math.random() - 0.5) * 0.15,
                    (Math.random() - 0.5) * 0.3
                )
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        // Mark position as dynamic so we can update active stars
        geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: `
                attribute float aSize;
                attribute float aPhase;
                uniform float uTime;
                varying float vAlpha;
                varying vec3 vColor;

            void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;

                // Size attenuation
                gl_PointSize = aSize * (300.0 / -mvPosition.z);
                gl_PointSize = clamp(gl_PointSize, 2.0, 8.0);

                // Twinkle effect
                float twinkle = sin(uTime * 2.0 + aPhase) * 0.3 + 0.7;
                vAlpha = twinkle;

                vColor = color;
            }
            `,
            fragmentShader: `
                varying float vAlpha;
                varying vec3 vColor;

            void main() {
                    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
                    float dist = length(circCoord);
                if (dist > 1.0) discard;

                    // Soft glow
                    float alpha = (1.0 - dist * dist) * vAlpha;

                    // Bright core
                    float core = 1.0 - smoothstep(0.0, 0.3, dist);
                    vec3 color = vColor + vec3(0.3) * core;

                gl_FragColor = vec4(color, alpha);
            }
            `,
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);

        // Create dynamic line system
        this.createConstellationLines();

        console.log('[SakuraTheme] Starfield created with', totalStars, 'stars');
    }

    /**
     * Create dynamic constellation lines connecting moving stars
     */
    createConstellationLines() {
        if (!this.activeStarData) return;

        // Max lines is typically (N * (N-1)) / 2, but we limit connections per star
        // Let's allocate a safe buffer size. 150 stars, maybe 5 connections each? = 750 lines = 1500 vertices
        const MAX_LINES = 2000;
        const vertexCount = MAX_LINES * 2;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(vertexCount * 3);
        const alphas = new Float32Array(vertexCount); // Per-vertex opacity based on distance

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));

        // Use custom shader for gradient fade lines
        this.constellationMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(0xfff5e6) }, // Warm White/Gold (Peaceful)
                uGlobalOpacity: { value: 0.0 } // Controlled by combo
            },
            vertexShader: `
                attribute float alpha;
                varying float vAlpha;
                
                void main() {
                    vAlpha = alpha;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uGlobalOpacity;
                varying float vAlpha;

                void main() {
                    gl_FragColor = vec4(uColor, vAlpha * uGlobalOpacity);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true // Ensure correct Z-sorting
        });

        this.constellationLines = new THREE.LineSegments(geometry, this.constellationMaterial);
        this.constellationLines.renderOrder = -1; // Draw early, as background
        // Important: set draw range to 0 initially
        this.constellationLines.geometry.setDrawRange(0, 0);
        this.constellationGeom = geometry;

        this.scene.add(this.constellationLines);
    }

    /**
     * Update active stars and rebuild constellation lines
     */
    updateConstellations(deltaTime) {
        if (!this.activeStarData || !this.constellationLines) return;

        // 1. Move Active Stars
        const positions = this.starfield.geometry.attributes.position.array;

        // Boundaries for wrapping - match spherical distribution (wider area)
        const boundX = 1500;
        const boundZ_Min = -1600;
        const boundZ_Max = 200;   // Can be behind camera too
        const boundY_Min = 100;
        const boundY_Max = 1000;

        // Animate Velocity
        const speedMult = 1.0;

        this.activeStarData.forEach(star => {
            // Apply velocity
            star.position.x += star.velocity.x * deltaTime * speedMult;
            star.position.y += star.velocity.y * deltaTime * speedMult;
            star.position.z += star.velocity.z * deltaTime * speedMult;

            // Wrap around boundaries
            if (star.position.x > boundX) star.position.x = -boundX;
            if (star.position.x < -boundX) star.position.x = boundX;

            if (star.position.y > boundY_Max) star.position.y = boundY_Min;
            if (star.position.y < boundY_Min) star.position.y = boundY_Max;

            if (star.position.z > boundZ_Max) star.position.z = boundZ_Min;
            if (star.position.z < boundZ_Min) star.position.z = boundZ_Max;

            // Update main buffer
            positions[star.index * 3] = star.position.x;
            positions[star.index * 3 + 1] = star.position.y;
            positions[star.index * 3 + 2] = star.position.z;
        });

        this.starfield.geometry.attributes.position.needsUpdate = true;


        // 2. Rebuild Lines
        // Calculate dynamic connection distance
        // MUCH larger during combo for dramatic full-sky effect
        const isCombo = this.constellationTargetOpacity > 0.1;
        const connectDist = isCombo ? 400 : 150; // Increased from 250 to 400
        const connectDistSq = connectDist * connectDist;

        const linePos = this.constellationGeom.attributes.position.array;
        const lineAlpha = this.constellationGeom.attributes.alpha.array;

        let vertexIndex = 0;
        let lineCount = 0;

        // Iterate through active stars
        // Optimization: spatial grid would be better, but N=150 is small enough for N^2/2 loop
        const count = this.activeStarData.length;

        // Reset connection counts
        this.activeStarData.forEach(s => s.connections = 0);
        const MAX_CONNECTIONS = 2; // Strict limit for "chain" look (constellations)

        for (let i = 0; i < count; i++) {
            const s1 = this.activeStarData[i];

            // Skip if star is already full
            if (s1.connections >= MAX_CONNECTIONS) continue;

            for (let j = i + 1; j < count; j++) {
                const s2 = this.activeStarData[j];

                // Skip if target star is full
                if (s2.connections >= MAX_CONNECTIONS) continue;

                // Fast distance check
                const dx = s1.position.x - s2.position.x;
                const dy = s1.position.y - s2.position.y;
                const dz = s1.position.z - s2.position.z;

                const distSq = dx * dx + dy * dy + dz * dz;

                if (distSq < connectDistSq) {
                    // Normalize distance for alpha (1.0 at 0 dist, 0.0 at max dist)
                    const dist = Math.sqrt(distSq);
                    const alpha = 1.0 - (dist / connectDist);

                    // Add segment
                    linePos[vertexIndex] = s1.position.x;
                    linePos[vertexIndex + 1] = s1.position.y;
                    linePos[vertexIndex + 2] = s1.position.z;
                    lineAlpha[vertexIndex / 3] = alpha;

                    linePos[vertexIndex + 3] = s2.position.x;
                    linePos[vertexIndex + 4] = s2.position.y;
                    linePos[vertexIndex + 5] = s2.position.z;
                    lineAlpha[vertexIndex / 3 + 1] = alpha;

                    vertexIndex += 6;
                    lineCount++;

                    // Increment connection counts
                    s1.connections++;
                    s2.connections++;

                    if (s1.connections >= MAX_CONNECTIONS) break; // Move to next star if s1 is now full

                    if (lineCount >= 2000) break; // Safety break
                }
            }
            if (lineCount >= 2000) break;
        }

        this.constellationGeom.setDrawRange(0, vertexIndex / 3);
        this.constellationGeom.attributes.position.needsUpdate = true;
        this.constellationGeom.attributes.alpha.needsUpdate = true;
    }

    createLanterns() {
        if (!this.treeData || this.treeData.length === 0) {
            console.warn('[SakuraTheme] No tree data available for lanterns');
            return;
        }

        // Clean up old lanterns if any
        if (this.lanternMeshes) {
            this.lanternMeshes.forEach(mesh => {
                this.scene.remove(mesh);
                if (mesh.geometry) mesh.geometry.dispose();
                // Material might be shared, be careful
            });
        }
        this.lanternMeshes = [];
        this.lanternLights = []; // Clear old lights array

        // --- Configuration ---
        const lanternsPerTreeMin = 3;
        const lanternsPerTreeMax = 7;  // Increased for 300+ total lanterns
        const lanternProbability = 0.98; // 98% of trees have lanterns

        // --- Geometries (Simplified for performance) ---
        // Reduced radial segments from 8 to 6
        const bodyGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.25, 6);
        const capGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 6); // Shared for top/bottom
        // Longer string to reach up into canopy (1.2 units instead of 0.6)
        const stringGeo = new THREE.CylinderGeometry(0.01, 0.01, 1.2, 3);

        // --- Materials ---
        // Emissive Body (Self-lit look without real light cost)
        const bodyMat = new THREE.MeshBasicMaterial({
            color: 0xffaa44,
            transparent: true,
            opacity: 0.95,
        });

        // Dark Cap Material
        const capMat = new THREE.MeshBasicMaterial({
            color: 0x221100,
        });

        // String Material
        const stringMat = new THREE.MeshBasicMaterial({
            color: 0x110a05
        });

        // --- Calculate Positions ---
        const instances = [];
        const dummy = new THREE.Object3D();
        const cameraRefPos = new THREE.Vector3(20, 0, 30); // Approximate camera ground position

        this.treeData.forEach((tree, index) => {
            // Always include foreground trees (first 14), otherwise use probability
            const isForeground = index < 14;
            if (!isForeground && Math.random() > lanternProbability) return;

            // Cull distant trees (remove lanterns from furthest back)
            const distToCamera = tree.pos.distanceTo(cameraRefPos);
            if (distToCamera > 50) return;

            const count = Math.floor(Math.random() * (lanternsPerTreeMax - lanternsPerTreeMin + 1)) + lanternsPerTreeMin;
            const treeScale = tree.scale || 1.0;

            for (let i = 0; i < count; i++) {
                // Procedural Offset logic
                // Lanterns hang from branches - keep closer to trunk for realistic look
                const angle = Math.random() * Math.PI * 2;
                // Reduced branch radius - keep closer to trunk (0.5 to 1.5 units out)
                const branchRadius = (0.5 + Math.random() * 1.0) * treeScale;

                const offsetX = Math.cos(angle) * branchRadius;
                const offsetZ = Math.sin(angle) * branchRadius;

                // Height: Position lanterns within the canopy area (higher up)
                // Tree canopies are around Y=3.0-5.0, lanterns hang from lower branches
                // Base height: 2.5 to 3.5 (within canopy)
                const baseHangY = 2.5 + Math.random() * 1.0;

                // Boost height for lanterns closer to camera (so they're more visible)
                const heightBoost = Math.max(0, 0.8 * (1 - distToCamera / 35)); // Reduced boost
                const hangY = baseHangY + heightBoost;

                const posX = tree.pos.x + offsetX;
                const posY = hangY;
                const posZ = tree.pos.z + offsetZ;

                // Random rotation for natural look
                const rotY = Math.random() * Math.PI * 2;

                // Slight swing rotation (static for now, can animate in shader later)
                const swingX = (Math.random() - 0.5) * 0.1;
                const swingZ = (Math.random() - 0.5) * 0.1;

                dummy.position.set(posX, posY, posZ);
                dummy.rotation.set(swingX, rotY, swingZ);
                dummy.scale.set(1, 1, 1);
                dummy.updateMatrix();

                instances.push(dummy.matrix.clone());
            }
        });

        const totalLanterns = instances.length;
        console.log(`[SakuraTheme] Generating ${totalLanterns} procedural lanterns`);

        // --- Create InstancedMeshes ---
        const meshBody = new THREE.InstancedMesh(bodyGeo, bodyMat, totalLanterns);
        const meshTop = new THREE.InstancedMesh(capGeo, capMat, totalLanterns);
        const meshBottom = new THREE.InstancedMesh(capGeo, capMat, totalLanterns); // Reuse cap geo
        const meshString = new THREE.InstancedMesh(stringGeo, stringMat, totalLanterns);

        // Fill Matrices
        const matBody = new THREE.Matrix4();
        const matTop = new THREE.Matrix4();
        const matBottom = new THREE.Matrix4();
        const matString = new THREE.Matrix4();

        // Relative offsets for parts
        const topOffset = new THREE.Vector3(0, 0.15, 0);   // Top of body (0.25 height / 2 + cap half height)
        const bottomOffset = new THREE.Vector3(0, -0.15, 0); // Bottom of body
        const stringOffset = new THREE.Vector3(0, 0.425, 0); // Center of string (above body)

        for (let i = 0; i < totalLanterns; i++) {
            const baseMatrix = instances[i];

            // Body is at base positions
            meshBody.setMatrixAt(i, baseMatrix);

            // Top Cap
            matTop.copy(baseMatrix);
            matTop.multiply(new THREE.Matrix4().makeTranslation(0, 0.15, 0)); // Move local up
            meshTop.setMatrixAt(i, matTop);

            // Bottom Cap
            matBottom.copy(baseMatrix);
            matBottom.multiply(new THREE.Matrix4().makeTranslation(0, -0.15, 0)); // Move local down
            meshBottom.setMatrixAt(i, matBottom);

            // String - longer (1.2 units), centered above body to reach into canopy
            matString.copy(baseMatrix);
            matString.multiply(new THREE.Matrix4().makeTranslation(0, 0.725, 0)); // Move up (0.6 + 0.125)
            meshString.setMatrixAt(i, matString);
        }

        meshBody.instanceMatrix.needsUpdate = true;
        meshTop.instanceMatrix.needsUpdate = true;
        meshBottom.instanceMatrix.needsUpdate = true;
        meshString.instanceMatrix.needsUpdate = true;

        this.scene.add(meshBody);
        this.scene.add(meshTop);
        this.scene.add(meshBottom);
        this.scene.add(meshString);

        this.lanternMeshes.push(meshBody, meshTop, meshBottom, meshString);

        // Create Glow Sprites for atmosphere (using a separate efficient method)
        this.createLanternGlows(instances);

        // --- Pass Lantern Positions to Shader ---
        if (this.sharedCanopyMaterial && this.sharedCanopyMaterial.userData.shader) {
            const shader = this.sharedCanopyMaterial.userData.shader;
            const positions = shader.uniforms.uLanternPositions.value;
            let count = 0;

            // Fill uniform array
            // We use the 'instances' matrices to extract positions
            const pos = new THREE.Vector3();
            const rot = new THREE.Quaternion();
            const scl = new THREE.Vector3();

            // Shuffle instances to get a random spread if we have > 60
            // (Simple slice for now is fine as they are tree-ordered)

            const max = Math.min(totalLanterns, 200);
            for (let i = 0; i < max; i++) {
                instances[i].decompose(pos, rot, scl);
                positions[i * 3] = pos.x;
                positions[i * 3 + 1] = pos.y;
                positions[i * 3 + 2] = pos.z;
                count++;
            }

            shader.uniforms.uLanternCount.value = count;
            this.sharedCanopyMaterial.needsUpdate = true; // Trigger?
            console.log(`[SakuraTheme] Uploaded ${count} lanterns to canopy shader`);
        }
    }

    createLanternGlows(matrices) {
        // Create a single geometry with vertices at lantern positions
        // Use Points material for very efficient glow bilboards
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const sizes = [];

        const pos = new THREE.Vector3();
        const rot = new THREE.Quaternion();
        const scl = new THREE.Vector3();

        matrices.forEach(mat => {
            mat.decompose(pos, rot, scl);
            positions.push(pos.x, pos.y, pos.z);
            sizes.push(1.0 + Math.random() * 0.5); // Varied size
        });

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

        // Create simplified glow texture programmatically
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32; // Small texture
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255, 170, 60, 1.0)');
        grad.addColorStop(0.4, 'rgba(255, 120, 20, 0.3)');
        grad.addColorStop(1.0, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);

        this.lanternGlowMaterial = new THREE.PointsMaterial({
            map: texture,
            size: 2.5,
            sizeAttenuation: true,
            color: 0xffaa44,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.lanternGlowPoints = new THREE.Points(geometry, this.lanternGlowMaterial);
        this.scene.add(this.lanternGlowPoints);
    }

    createHeroLights(matrices) {
        // Find 5 lanterns closest to camera (20, 4, 30) to cast real shadows
        const cameraPos = new THREE.Vector3(20, 4, 30);
        const candidates = [];
        const pos = new THREE.Vector3();
        const rot = new THREE.Quaternion();
        const scl = new THREE.Vector3();

        matrices.forEach((mat, index) => {
            mat.decompose(pos, rot, scl);
            const dist = pos.distanceTo(cameraPos);
            candidates.push({ index, pos: pos.clone(), dist });
        });

        // Sort by distance
        candidates.sort((a, b) => a.dist - b.dist);

        // Take top 5
        const heroCount = Math.min(candidates.length, 5);
        console.log(`[SakuraTheme] Creating ${heroCount} Hero Lights`);

        for (let i = 0; i < heroCount; i++) {
            const c = candidates[i];
            const light = new THREE.PointLight(0xffaa55, 1.5, 12, 2);
            light.position.copy(c.pos);
            light.castShadow = true;
            // Optimize shadow map
            light.shadow.mapSize.width = 512;
            light.shadow.mapSize.height = 512;
            light.shadow.bias = -0.001;
            light.shadow.camera.near = 0.5;
            light.shadow.camera.far = 15;

            this.scene.add(light);
            // Store for cleanup if needed, but static lights don't need update loop
        }
    }

    /**
     * Load and setup two foxes with autonomous wandering behavior
     * Fox 1: Stays near the hero tree (center)
     * Fox 2: Roams the entire visible terrain
     */
    async loadFoxes() {
        const loader = new GLTFLoader();

        try {
            const gltf = await loader.loadAsync(foxModelUrl);

            // Extract animations from the loaded model
            const animations = {};
            gltf.animations.forEach(clip => {
                animations[clip.name] = clip;
            });

            console.log('[SakuraTheme] Fox animations:', Object.keys(animations));

            // Create two foxes - both can roam freely across the entire scene
            const foxConfigs = [
                {
                    name: 'fox-1',
                    startPos: new THREE.Vector3(5, 0, 10),
                    wanderRadius: 80,  // Entire visible scene
                    wanderCenter: new THREE.Vector3(10, 0, 15),  // Center of scene
                    speed: { walk: 2.5, run: 4.0 },  // Reduced run speed
                    scale: 0.008
                },
                {
                    name: 'fox-2',
                    startPos: new THREE.Vector3(-10, 0, 25),
                    wanderRadius: 80,  // Entire visible scene
                    wanderCenter: new THREE.Vector3(10, 0, 15),  // Same center
                    speed: { walk: 2.8, run: 4.5 },  // Slightly different speeds
                    scale: 0.009  // Slightly different size
                }
            ];

            for (const config of foxConfigs) {
                // Clone the fox model using SkeletonUtils for proper skinned mesh cloning
                // This ensures animations work correctly on cloned instances
                const foxModel = SkeletonUtils.clone(gltf.scene);

                // Set initial position on terrain
                const startY = this.getTerrainHeight(config.startPos.x, config.startPos.z);
                foxModel.position.set(config.startPos.x, startY, config.startPos.z);
                foxModel.scale.setScalar(config.scale);

                // Enable shadows on all meshes
                foxModel.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                // Find bones for procedural animations
                // The Fox model has a skeleton with named bones
                const bones = {};
                foxModel.traverse((child) => {
                    if (child.isBone) {
                        // Store bones by name for procedural animation
                        const name = child.name.toLowerCase();
                        if (name.includes('tail')) {
                            if (!bones.tail) bones.tail = [];
                            bones.tail.push(child);
                        }
                        if (name.includes('head')) {
                            bones.head = child;
                        }
                        if (name.includes('spine') || name.includes('back')) {
                            bones.spine = child;
                        }
                    }
                });

                // Log found bones for debugging
                console.log(`[SakuraTheme] ${config.name} bones found:`, Object.keys(bones));

                // Create animation mixer for this fox
                const mixer = new THREE.AnimationMixer(foxModel);

                // Clone and setup animations for this mixer
                const foxAnimations = {};
                for (const [name, clip] of Object.entries(animations)) {
                    const action = mixer.clipAction(clip);
                    foxAnimations[name] = action;
                }

                // Start with Survey (idle) animation
                if (foxAnimations['Survey']) {
                    foxAnimations['Survey'].play();
                }

                // Create fox state object for wandering AI
                const foxState = {
                    model: foxModel,
                    mixer: mixer,
                    animations: foxAnimations,
                    config: config,
                    position: foxModel.position.clone(),
                    targetPosition: foxModel.position.clone(),
                    direction: new THREE.Vector3(0, 0, 1),
                    currentAction: 'Survey',
                    state: 'idle', // 'idle', 'walking', 'running'
                    waitTimer: 1 + Math.random() * 3, // Initial wait 1-4 seconds
                    stateTimer: 0,
                    // Procedural animation state
                    bones: bones,
                    proceduralTime: Math.random() * 100, // Offset so foxes aren't synchronized
                    tailPhase: Math.random() * Math.PI * 2,
                    headLookTarget: new THREE.Vector3(),
                    breathPhase: Math.random() * Math.PI * 2,
                    // Greeting interaction state
                    greetingPartner: null,  // Reference to other fox during greeting
                    greetingPhase: 0,       // 0-1 progress through greeting animation
                    greetingType: 0,        // Random greeting type (bow, circle, hop)
                    originalY: 0,           // For hop animation
                    greetingCooldown: 0     // Cooldown timer to prevent repeat greetings
                };

                this.foxes.push(foxState);
                this.foxMixers.push(mixer);
                this.scene.add(foxModel);

                console.log(`[SakuraTheme] Created ${config.name} at`, config.startPos);
            }

            console.log(`[SakuraTheme] Loaded ${this.foxes.length} foxes`);

        } catch (error) {
            console.error('[SakuraTheme] Error loading fox model:', error);
        }
    }

    /**
     * Pick a new random target for a fox within its wander zone
     */
    pickNewFoxTarget(fox) {
        const config = fox.config;
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * config.wanderRadius;

        const targetX = config.wanderCenter.x + Math.cos(angle) * distance;
        const targetZ = config.wanderCenter.z + Math.sin(angle) * distance;
        const targetY = this.getTerrainHeight(targetX, targetZ);

        fox.targetPosition.set(targetX, targetY, targetZ);
    }

    /**
     * Transition fox to a new state with animation blending
     */
    transitionFoxState(fox, newState) {
        const animationMap = {
            'idle': 'Survey',
            'walking': 'Walk',
            'running': 'Run'
        };

        const newActionName = animationMap[newState];
        const oldAction = fox.animations[fox.currentAction];
        const newAction = fox.animations[newActionName];

        if (oldAction && newAction && fox.currentAction !== newActionName) {
            // Smooth crossfade between animations
            newAction.reset();
            newAction.setEffectiveTimeScale(1);
            newAction.setEffectiveWeight(1);
            newAction.crossFadeFrom(oldAction, 0.3, true);
            newAction.play();
        }

        fox.currentAction = newActionName;
        fox.state = newState;
        fox.stateTimer = 0;
    }

    /**
     * Update all foxes - called each frame from animate()
     */
    updateFoxes(deltaTime) {
        const GREETING_DISTANCE = 3.0;  // Distance to trigger greeting
        const GREETING_DURATION = 3.0;  // Seconds for greeting animation

        // First pass: check for collisions and trigger greetings
        for (let i = 0; i < this.foxes.length; i++) {
            const fox = this.foxes[i];

            // Update greeting cooldown
            if (fox.greetingCooldown > 0) {
                fox.greetingCooldown -= deltaTime;
            }

            // Skip if already greeting or on cooldown
            if (fox.state === 'greeting' || fox.greetingCooldown > 0) continue;

            // Check distance to other foxes
            for (let j = i + 1; j < this.foxes.length; j++) {
                const otherFox = this.foxes[j];
                if (otherFox.state === 'greeting' || otherFox.greetingCooldown > 0) continue;

                const distance = fox.position.distanceTo(otherFox.position);

                if (distance < GREETING_DISTANCE) {
                    // Foxes meet! Start cute greeting interaction
                    this.startFoxGreeting(fox, otherFox);
                }
            }
        }

        // Second pass: update each fox's state
        for (const fox of this.foxes) {
            const config = fox.config;

            switch (fox.state) {
                case 'idle':
                    fox.waitTimer -= deltaTime;
                    if (fox.waitTimer <= 0) {
                        // Pick new target and start moving
                        this.pickNewFoxTarget(fox);

                        // Decide walk or run based on distance
                        const distance = fox.position.distanceTo(fox.targetPosition);
                        if (distance > 15 && Math.random() > 0.5) {
                            this.transitionFoxState(fox, 'running');
                        } else {
                            this.transitionFoxState(fox, 'walking');
                        }
                    }
                    break;

                case 'walking':
                case 'running':
                    const distanceToTarget = fox.position.distanceTo(fox.targetPosition);

                    if (distanceToTarget < 1.0) {
                        // Reached target, go idle
                        this.transitionFoxState(fox, 'idle');
                        fox.waitTimer = 2 + Math.random() * 5; // Wait 2-7 seconds

                    } else {
                        // Move toward target
                        const speed = fox.state === 'running'
                            ? config.speed.run
                            : config.speed.walk;

                        // Calculate direction (XZ only)
                        fox.direction.subVectors(fox.targetPosition, fox.position);
                        fox.direction.y = 0;
                        fox.direction.normalize();

                        // Move position
                        const movement = fox.direction.clone().multiplyScalar(speed * deltaTime);
                        fox.position.add(movement);

                        // Update Y to follow terrain
                        fox.position.y = this.getTerrainHeight(fox.position.x, fox.position.z);

                        // Update model position
                        fox.model.position.copy(fox.position);

                        // Rotate fox to face movement direction
                        if (fox.direction.lengthSq() > 0.001) {
                            const targetAngle = Math.atan2(fox.direction.x, fox.direction.z);
                            // Smooth rotation
                            const currentRotY = fox.model.rotation.y;
                            let angleDiff = targetAngle - currentRotY;
                            // Normalize angle difference
                            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                            fox.model.rotation.y += angleDiff * Math.min(1, deltaTime * 5);
                        }

                        // Transition from running to walking when close to target
                        if (fox.state === 'running' && distanceToTarget < 5) {
                            this.transitionFoxState(fox, 'walking');
                        }
                    }
                    break;

                case 'greeting':
                    // Cute greeting interaction!
                    this.updateFoxGreeting(fox, deltaTime, GREETING_DURATION);
                    break;
            }

            // Update procedural animations for this fox
            fox.proceduralTime += deltaTime;
            this.updateFoxProceduralAnimations(fox, deltaTime);
        }
    }

    /**
     * Start a cute greeting interaction between two foxes
     */
    startFoxGreeting(fox1, fox2) {
        // Pick a random greeting type
        const greetingType = Math.floor(Math.random() * 3); // 0: bow, 1: hop, 2: circle

        // Set up both foxes for greeting
        [fox1, fox2].forEach((fox, i) => {
            fox.state = 'greeting';
            fox.greetingPartner = i === 0 ? fox2 : fox1;
            fox.greetingPhase = 0;
            fox.greetingType = greetingType;
            fox.originalY = fox.position.y;

            // Switch to Survey animation (looks like they're paying attention)
            if (fox.animations['Survey']) {
                const oldAction = fox.animations[fox.currentAction];
                const newAction = fox.animations['Survey'];
                if (oldAction && newAction) {
                    newAction.reset();
                    newAction.crossFadeFrom(oldAction, 0.2, true);
                    newAction.play();
                }
                fox.currentAction = 'Survey';
            }
        });

        console.log('[SakuraTheme] Foxes greeting! Type:', ['bow', 'hop', 'circle'][greetingType]);
    }

    /**
     * Update greeting animation for a fox
     */
    updateFoxGreeting(fox, deltaTime, duration) {
        fox.greetingPhase += deltaTime / duration;

        if (fox.greetingPhase >= 1.0) {
            // Greeting finished! Set cooldown and wander away
            const partner = fox.greetingPartner;

            // Set cooldown to prevent immediate re-greeting (10-15 seconds)
            fox.greetingCooldown = 10 + Math.random() * 5;

            // Pick a new target that moves AWAY from the partner
            if (partner) {
                const awayDir = new THREE.Vector3().subVectors(fox.position, partner.position);
                awayDir.y = 0;
                awayDir.normalize();

                // Move 15-25 units away
                const awayDist = 15 + Math.random() * 10;
                fox.targetPosition.set(
                    fox.position.x + awayDir.x * awayDist,
                    0,
                    fox.position.z + awayDir.z * awayDist
                );
                fox.targetPosition.y = this.getTerrainHeight(fox.targetPosition.x, fox.targetPosition.z);
            }

            // Start walking away
            this.transitionFoxState(fox, 'walking');
            fox.greetingPartner = null;
            fox.model.position.y = fox.position.y;  // Reset Y

            console.log('[SakuraTheme] Fox finished greeting, wandering off happily!');
            return;
        }

        const partner = fox.greetingPartner;
        if (!partner) return;

        const phase = fox.greetingPhase;
        const t = Math.sin(phase * Math.PI);  // Smooth in-out curve

        // Make foxes face each other
        const toPartner = new THREE.Vector3().subVectors(partner.position, fox.position);
        toPartner.y = 0;
        if (toPartner.lengthSq() > 0.001) {
            const targetAngle = Math.atan2(toPartner.x, toPartner.z);
            fox.model.rotation.y += (targetAngle - fox.model.rotation.y) * deltaTime * 3;
        }

        // Perform greeting animation based on type
        switch (fox.greetingType) {
            case 0:  // Bow - dip head forward
                // Handled by enhanced procedural animation during greeting
                break;

            case 1:  // Playful hop
                // Jump up and down!
                const hopHeight = Math.sin(phase * Math.PI * 4) * 0.3 * (1 - phase);
                fox.model.position.y = fox.position.y + Math.max(0, hopHeight);
                break;

            case 2:  // Circle around each other
                const circleRadius = 1.5;
                const circleSpeed = 2 * Math.PI;  // Full circle
                const angle = phase * circleSpeed;
                const midpoint = new THREE.Vector3().addVectors(fox.position, partner.position).multiplyScalar(0.5);

                // Offset from midpoint
                const circleX = Math.cos(angle + (fox === this.foxes[0] ? 0 : Math.PI)) * circleRadius;
                const circleZ = Math.sin(angle + (fox === this.foxes[0] ? 0 : Math.PI)) * circleRadius;

                fox.model.position.x = midpoint.x + circleX * t;
                fox.model.position.z = midpoint.z + circleZ * t;
                fox.model.position.y = this.getTerrainHeight(fox.model.position.x, fox.model.position.z);
                break;
        }
    }

    /**
     * Apply procedural animations to fox bones
     * These add life on top of the base glTF animations
     */
    updateFoxProceduralAnimations(fox, deltaTime) {
        const time = fox.proceduralTime;
        const bones = fox.bones;
        const isGreeting = fox.state === 'greeting';

        // Tail wagging - much faster during greeting (excited!), otherwise based on movement
        if (bones.tail && bones.tail.length > 0) {
            const wagSpeed = isGreeting ? 18 :  // Super excited during greeting!
                fox.state === 'running' ? 12 :
                    fox.state === 'walking' ? 8 : 4;
            const wagAmount = isGreeting ? 0.6 :  // Extra wagging during greeting!
                fox.state === 'running' ? 0.4 :
                    fox.state === 'walking' ? 0.25 : 0.15;

            bones.tail.forEach((tailBone, i) => {
                // Each tail segment wags with increasing amplitude and delay
                const segmentDelay = i * 0.2;
                const segmentAmp = wagAmount * (1 + i * 0.3);
                tailBone.rotation.z = Math.sin((time + segmentDelay) * wagSpeed + fox.tailPhase) * segmentAmp;
                // Slight up-down motion too
                tailBone.rotation.x += Math.sin((time + segmentDelay) * wagSpeed * 0.5) * segmentAmp * 0.3;
            });
        }

        // Head movement - playful bowing during greeting, otherwise normal behavior
        if (bones.head) {
            if (isGreeting) {
                // Playful bowing during greeting!
                const bowPhase = fox.greetingPhase;
                const bowAmount = Math.sin(bowPhase * Math.PI * 3) * 0.3;  // Multiple bows
                bones.head.rotation.x += bowAmount;
                // Also do excited side-to-side
                bones.head.rotation.y += Math.sin(time * 6) * 0.1;
            } else if (fox.state === 'idle') {
                // Look around curiously when idle
                const lookSpeed = 0.8;
                const lookAmount = 0.15;
                bones.head.rotation.y += Math.sin(time * lookSpeed + fox.tailPhase) * lookAmount * 0.3;
                bones.head.rotation.x += Math.sin(time * lookSpeed * 0.7) * lookAmount * 0.2;
            } else {
                // Slight bobbing when walking/running
                const bobSpeed = fox.state === 'running' ? 15 : 8;
                const bobAmount = fox.state === 'running' ? 0.05 : 0.03;
                bones.head.rotation.x += Math.sin(time * bobSpeed) * bobAmount;
            }
        }

        // Breathing - subtle spine/body expansion (more visible when idle)
        if (bones.spine) {
            const breathSpeed = isGreeting ? 5 : (fox.state === 'idle' ? 2 : 3);  // Faster breathing when excited
            const breathAmount = isGreeting ? 0.04 : (fox.state === 'idle' ? 0.03 : 0.015);
            const breathValue = Math.sin(time * breathSpeed + fox.breathPhase) * breathAmount;
            bones.spine.rotation.x += breathValue;
        }
    }


    animate() {
        if (!this.isActive || !this.renderer) return;
        this.animationId = requestAnimationFrame(this.animate.bind(this));

        const deltaTime = this.clock.getDelta();
        const time = this.clock.getElapsedTime();

        // Update Fox animation mixers and AI
        for (const mixer of this.foxMixers) {
            mixer.update(deltaTime);
        }
        this.updateFoxes(deltaTime);

        // Update Pulse Decay
        if (this.pulseIntensity > 0) {
            this.pulseIntensity -= deltaTime * 1.5; // Slower fade out (over ~0.6s)

            if (this.pulseIntensity < 0.01) this.pulseIntensity = 0;

            // Animate Lantern Points (The glowing orbs themselves) - subtle growth
            if (this.lanternGlowMaterial) {
                // Base size 2.5, pulse up to 4.0 (was 8.5)
                this.lanternGlowMaterial.size = 2.5 + this.pulseIntensity * 1.5;
                // Base opacity 0.8, pulse up to 0.95
                this.lanternGlowMaterial.opacity = 0.8 + this.pulseIntensity * 0.15;
            }
        } else if (this.lanternGlowMaterial && this.lanternGlowMaterial.size > 2.51) {
            // Reset to base
            this.lanternGlowMaterial.size = 2.5;
            this.lanternGlowMaterial.opacity = 0.8;
        }

        // Update Shader Uniform (Shared Material)
        if (this.sharedCanopyMaterial && this.sharedCanopyMaterial.userData.shader) {
            this.sharedCanopyMaterial.userData.shader.uniforms.uTime.value = time;
            if (this.sharedCanopyMaterial.userData.shader.uniforms.uPulseIntensity) {
                // Debug log occasionally if pulsing
                // if (this.pulseIntensity > 0.5 && Math.random() < 0.05) console.log('Pulsing canopy!', this.pulseIntensity);

                this.sharedCanopyMaterial.userData.shader.uniforms.uPulseIntensity.value = this.pulseIntensity;
            }
        }

        // Update Grass Wind Animation (ShaderMaterial has uniforms directly)
        if (this.grassMaterial?.uniforms?.uTime) {
            this.grassMaterial.uniforms.uTime.value = time;
        }
        if (this.grassMaterial?.uniforms?.uPulseIntensity) {
            this.grassMaterial.uniforms.uPulseIntensity.value = this.pulseIntensity;
        }

        // Animate constellation lines (fade in/out on combo)
        if (this.constellationMaterial) {
            // Update Positions & Mesh
            this.updateConstellations(deltaTime);

            // Smoothly interpolate opacity towards target
            const lerpSpeed = deltaTime * 3.0; // Smooth transition
            this.constellationOpacity += (this.constellationTargetOpacity - this.constellationOpacity) * lerpSpeed;

            // Decay target opacity over time (auto-fade out)
            this.constellationTargetOpacity *= 0.98; // Slow decay (stay visible for ~2s after combo)
            if (this.constellationTargetOpacity < 0.05) this.constellationTargetOpacity = 0.05; // Keep FAINTLY visible at all times? Or 0? Let's keep faint.

            // Apply to material
            // this.constellationMaterial.opacity = this.constellationOpacity; // OLD

            // NEW: Shader uniform
            if (this.constellationMaterial.uniforms) {
                this.constellationMaterial.uniforms.uGlobalOpacity.value = this.constellationOpacity;
                // Pulsing color shift during combo - Subtle Gold Warmth
                if (this.constellationTargetOpacity > 0.5) {
                    const hue = (time * 0.1) % 1.0;
                    // Very subtle shift around warm gold
                    this.constellationMaterial.uniforms.uColor.value.setHSL(0.1 + Math.sin(time * 0.5) * 0.02, 0.8, 0.9);
                } else {
                    this.constellationMaterial.uniforms.uColor.value.setHex(0xfff5e6); // Default warm white
                }
            }
        }

        // Starfield is now static (no twinkling)

        // Update Moon shader and animate position
        if (this.moonMesh?.material?.uniforms?.uTime) {
            this.moonMesh.material.uniforms.uTime.value = time;
        }

        // Animate moon moving slowly across the sky (right to left, loops)
        if (this.moonGroup) {
            // Complete journey in ~5 minutes (300 seconds) for slow, peaceful movement
            const moonCycleTime = 300.0;
            // Offset by 90 seconds so moon starts in visible center area
            const offsetTime = time + 90.0;
            const t = (offsetTime % moonCycleTime) / moonCycleTime;  // 0 to 1

            // Move from right (+300) to left (-400)
            const startX = 300;
            const endX = -400;
            const moonX = startX + (endX - startX) * t;

            // Slight arc - highest at middle of journey
            const arcHeight = Math.sin(t * Math.PI) * 40;
            const baseY = 250;

            this.moonGroup.position.x = moonX;
            this.moonGroup.position.y = baseY + arcHeight;

            // Update moonlight to follow moon
            if (this.moonLight) {
                this.moonLight.position.x = moonX;
                this.moonLight.position.y = baseY + arcHeight;
            }
        }

        // Animate lantern flickering (Global efficiency)
        if (this.lanternGlowPoints && this.lanternGlowPoints.material) {
            const flicker = Math.sin(time * 8) * 0.05 + Math.sin(time * 20) * 0.02;
            this.lanternGlowPoints.material.opacity = 0.8 + flicker;
        }

        this.updatePetals();

        // Create subtle camera float/sway for atmosphere
        if (this.camera) {
            const swaySpeed = 0.15;
            const swayAmount = 2.0;
            const bobSpeed = 0.2;
            const bobAmount = 0.3;

            // Base position is (20, 4, 30)
            this.camera.position.x = 20 + Math.sin(time * swaySpeed) * swayAmount;
            this.camera.position.y = 4 + Math.sin(time * bobSpeed) * bobAmount;
            // Keep looking at target
            this.camera.lookAt(0, 4, 0);
        }

        if (this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    stop() {
        console.log('[SakuraTheme] Stopping...');
        this.isActive = false;
        if (this.animationId) cancelAnimationFrame(this.animationId);
        window.removeEventListener('resize', this.onWindowResize);

        // Remove event subscriptions
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Cleanup fox resources
        for (const mixer of this.foxMixers) {
            mixer.stopAllAction();
        }
        this.foxMixers = [];

        for (const fox of this.foxes) {
            if (fox.model) {
                this.scene?.remove(fox.model);
            }
        }
        this.foxes = [];

        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('sakura-twilight-theme');
            if (container) container.innerHTML = '';
        }
    }

    /**
     * Called when a piece is locked
     * Triggers a visual pulse effect
     */
    onPieceLock() {
        // Trigger pulse
        this.pulseIntensity = 1.0;
        console.log('[SakuraTheme] Pulse!');
    }

    /**
     * Called on combo
     * Triggers a visual pulse effect and constellation lines
     */
    onCombo() {
        // Trigger pulse
        this.pulseIntensity = 1.0;

        // Trigger constellation lines to fade in (full opacity for visibility)
        this.constellationTargetOpacity = 0.8; // Slightly lower max opacity for subtlety

        // REMOVED: Velocity explosion - keep it peaceful!

        console.log('[SakuraTheme] Combo Pulse + Constellation (Peaceful)!');
    }

    setupEventListeners() {
        // Subscribe to game events
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.PIECE_LOCK, () => this.onPieceLock()),
            eventBus.on(EVENTS.COMBO, () => this.onCombo())
        );
    }
}
