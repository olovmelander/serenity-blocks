/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ NEON DISTRICT ASSET MANAGER ✧
 *  SynthCity-style texture loading for the Neon District theme
 *  PROPERLY REPLICATES SynthCity approach with MeshPhongMaterial and emissive maps
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three/webgpu';
import { WebGLRenderer } from 'three';
import { float, uniformTexture, vec3 } from 'three/tsl';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const TEXTURE_PATH = './textures/synthcity/';

// ─────────────────────────────────────────────────────────────────────────────
// Star Shader - Soft, twinkling neon sky stars
// ─────────────────────────────────────────────────────────────────────────────
export const NEON_DISTRICT_STAR_VERTEX_SHADER = `
attribute float aSize;
attribute vec2 aTwinkle; // x = phase, y = speed
attribute float aBrightness;

uniform float uTime;
uniform float uPixelRatio;

varying float vBrightness;
varying vec3 vColor;

void main() {
    vColor = color;

    float twinkle = sin(uTime * aTwinkle.y + aTwinkle.x);
    vBrightness = aBrightness * (0.65 + twinkle * 0.35);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * (200.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 2.0, 50.0);

    gl_Position = projectionMatrix * mvPosition;
}
`;

export const NEON_DISTRICT_STAR_FRAGMENT_SHADER = `
varying float vBrightness;
varying vec3 vColor;

void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center) * 2.0;
    if (dist > 1.0) discard;

    float softCircle = 1.0 - smoothstep(0.0, 1.0, dist);
    softCircle = pow(softCircle, 0.9);

    float core = 1.0 - smoothstep(0.0, 0.3, dist);
    vec3 coreColor = vColor * vBrightness * 1.2 + vec3(0.08) * core;
    float alpha = softCircle * (vBrightness + 0.15);

    gl_FragColor = vec4(coreColor, alpha);
}
`;

/**
 * Asset Manager for Neon District theme
 * Properly replicates SynthCity's material creation approach
 */
export class NeonDistrictAssets {
    constructor(renderer = null) {
        this.textures = {};
        this.materials = {};
        this.adAtlas = {
            small: null,
            large: null,
        };
        this.adAtlasInfo = {
            small: null,
            large: null,
        };
        this.loadingManager = new THREE.LoadingManager();
        this.textureLoader = new THREE.TextureLoader(this.loadingManager);
        this.renderer = null;
        this.isWebGPU = false;
        this.ktx2Ready = false;

        // KTX2 Loader setup
        this.ktx2Loader = new KTX2Loader(this.loadingManager);
        this.ktx2Loader.setTranscoderPath('./basics/basis/'); // Standard path for Basis transcoder

        // Configuration - balanced brightness
        // Use maximum anisotropy for sharp textures at oblique angles
        this.textureAnisotropy = 16;
        this.windowsEmissiveIntensity = 2.8; // Reduced to limit bloom flicker on windows
        this.adsEmissiveIntensity = 0.35; // Reduced for less glare
        this.storefrontEmissiveIntensity = 0.4; // Further reduced for less glare
        this.buildingDiffuseBoost = 1.12; // Slight lift so main buildings aren't pitch black

        // Track used storefronts to ensure uniqueness
        this.availableStorefronts = [];
        this.usedStorefronts = new Set();

        // Track loaded state
        this.loaded = false;

        if (renderer) {
            this.setRenderer(renderer);
        }
    }

    setRenderer(renderer) {
        if (!renderer) return;
        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        if (!this.ktx2Ready) {
            this.ktx2Loader.detectSupport(renderer);
            this.ktx2Ready = true;
        }
    }

    ensureKTX2Support() {
        if (this.ktx2Ready) return;
        const tempRenderer = this.renderer || new WebGLRenderer({ antialias: false });
        this.ktx2Loader.detectSupport(tempRenderer);
        this.ktx2Ready = true;
        if (!this.renderer && tempRenderer?.dispose) {
            tempRenderer.dispose();
        }
    }

    /**
     * Pad number to 2 digits (01, 02, etc.)
     */
    padNumber(num) {
        return num.toString().padStart(2, '0');
    }

    /**
     * Helper to setup texture parameters
     */
    setupTexture(tex, wrap, aniso, name, colorSpace = THREE.SRGBColorSpace) {
        if (wrap) {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
        }
        if (aniso) {
            tex.anisotropy = this.textureAnisotropy;
        }
        // High-quality filtering for sharp textures
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.colorSpace = colorSpace;

        // Store in cache
        this.textures[name] = tex;
    }

    /**
     * Fallback to standard texture loading
     */
    loadStandardTexture(name, wrap, aniso, colorSpace) {
        return new Promise((resolve) => {
            this.textureLoader.load(
                TEXTURE_PATH + name,
                (tex) => {
                    this.setupTexture(tex, wrap, aniso, name.replace('.jpg', '').replace('.png', ''), colorSpace);
                    resolve(tex);
                },
                undefined,
                () => {
                    // Silently resolve null for missing textures
                    resolve(null);
                },
            );
        });
    }

    /**
     * Load all textures (call once during init) - PARALLEL loading for speed
     */
    async loadAllTextures() {
        // Prevent reloading if already loaded
        if (this.loaded) {
            console.log('[NeonDistrictAssets] Already loaded, skipping...');
            return;
        }

        this.ensureKTX2Support();

        console.log('[NeonDistrictAssets] Loading textures...');

        const loader = this.textureLoader;
        const { ktx2Loader } = this;
        const texPath = TEXTURE_PATH;

        // Helper to load texture with high-quality settings and KTX2 fallback
        const loadTex = (name, wrap = false, aniso = true, colorSpace = THREE.SRGBColorSpace) => {
            const baseName = name.replace('.jpg', '').replace('.png', '');

            return new Promise((resolve) => {
                // TRY KTX2 FIRST (if file exists logic would be here, but we try/fail)
                // For now, we assume if .ktx2 exists we use it, otherwise fall back.
                // Since checking file existence via HTTP is slow/complex without manifest,
                // we will stick to standard loading but provide the mechanism to easy switch.

                // NOTE: To enable KTX2, ensure .ktx2 files exist and uncomment logic below
                // or ensure server serves .ktx2.
                // For this implementation, we default to standard loader to avoid 404 console spam
                // until user generates the assets.

                /*
                ktx2Loader.load(
                    texPath + baseName + '.ktx2',
                    (tex) => {
                        this.setupTexture(tex, wrap, aniso, baseName, colorSpace);
                        resolve(tex);
                    },
                    undefined,
                    () => {
                        // Fallback to standard image
                        this.loadStandardTexture(name, wrap, aniso, colorSpace).then(resolve);
                    }
                );
                */

                // Default path (Standard)
                this.loadStandardTexture(name, wrap, aniso, colorSpace).then(resolve);
            });
        };

        // Build array of all texture load promises for PARALLEL loading
        const texturePromises = [];

        // Ground
        texturePromises.push(loadTex('ground.jpg'));
        texturePromises.push(loadTex('ground_em.jpg'));

        // Storefronts - 17 variants (storefront_02 through _18)
        for (let i = 2; i <= 18; i++) {
            texturePromises.push(loadTex(`storefront_${this.padNumber(i)}.jpg`, true, true));
        }

        // Environment - load with others, configure after
        texturePromises.push(
            loadTex('environment_night.jpg').then((tex) => {
                if (tex) {
                    tex.mapping = THREE.EquirectangularReflectionMapping;
                    tex.magFilter = THREE.LinearFilter;
                    this.textures.env_night = tex;
                }
                return tex;
            }),
        );

        // Building textures (10 sets) - with wrap and anisotropy
        for (let i = 1; i <= 10; i++) {
            const id = this.padNumber(i);
            texturePromises.push(loadTex(`building_${id}.jpg`, true, true));
            texturePromises.push(loadTex(`building_${id}_em.jpg`, true, true));
            texturePromises.push(loadTex(`building_${id}_spec.jpg`, true, true, THREE.NoColorSpace));
            texturePromises.push(loadTex(`building_${id}_rough.jpg`, true, true, THREE.NoColorSpace));
        }

        // Mega building
        texturePromises.push(loadTex('mega_building_01.jpg', true, true));
        texturePromises.push(loadTex('mega_building_01_em.jpg', true, true));

        // Small ads (5)
        for (let i = 1; i <= 5; i++) {
            texturePromises.push(loadTex(`ads_${this.padNumber(i)}.jpg`));
        }

        // Large ads (18)
        for (let i = 1; i <= 18; i++) {
            texturePromises.push(loadTex(`ads_large_${this.padNumber(i)}.jpg`));
        }



        // Smoke (3)
        for (let i = 1; i <= 3; i++) {
            texturePromises.push(loadTex(`smoke_${this.padNumber(i)}.jpg`));
        }

        // Spotlights (4)
        for (let i = 1; i <= 4; i++) {
            texturePromises.push(loadTex(`spotlight_${this.padNumber(i)}.jpg`));
        }

        // Load ALL textures in parallel
        await Promise.all(texturePromises);

        console.log('[NeonDistrictAssets] Textures loaded, creating materials...');
        this.createAdAtlases();
        this.createAllMaterials();
        this.loaded = true;
    }

    createAdAtlases() {
        this.adAtlas.small = this.buildAdAtlas('ads', 5, 3, 2);
        this.adAtlas.large = this.buildAdAtlas('ads_large', 18, 6, 3);
    }

    buildAdAtlas(prefix, count, cols, rows) {
        if (typeof document === 'undefined') return null;

        const textures = [];
        let tileW = 0;
        let tileH = 0;
        for (let i = 1; i <= count; i++) {
            const id = this.padNumber(i);
            const tex = this.getTexture(`${prefix}_${id}`);
            if (!tex || !tex.image) continue;
            textures.push({ tex, index: i - 1 });
            tileW = Math.max(tileW, tex.image.width || 0);
            tileH = Math.max(tileH, tex.image.height || 0);
        }

        if (!textures.length || tileW <= 0 || tileH <= 0) return null;

        const maxTextureSize = this.renderer?.capabilities?.maxTextureSize || 8192;
        const totalW = cols * tileW;
        const totalH = rows * tileH;
        let scale = 1.0;
        if (totalW > maxTextureSize || totalH > maxTextureSize) {
            scale = Math.min(
                maxTextureSize / totalW,
                maxTextureSize / totalH,
                1.0,
            );
        }
        const scaledW = Math.max(1, Math.floor(tileW * scale));
        const scaledH = Math.max(1, Math.floor(tileH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = cols * scaledW;
        canvas.height = rows * scaledH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        textures.forEach(({ tex, index }) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            const x = col * scaledW;
            const y = row * scaledH;
            try {
                ctx.drawImage(tex.image, x, y, scaledW, scaledH);
            } catch (e) {
                // Ignore draw failures (e.g., cross-origin) and continue
            }
        });

        const atlas = new THREE.CanvasTexture(canvas);
        atlas.colorSpace = THREE.SRGBColorSpace;
        atlas.minFilter = THREE.LinearMipmapLinearFilter;
        atlas.magFilter = THREE.LinearFilter;
        atlas.generateMipmaps = true;
        atlas.wrapS = THREE.ClampToEdgeWrapping;
        atlas.wrapT = THREE.ClampToEdgeWrapping;

        const info = { cols, rows, tileW: scaledW, tileH: scaledH };
        if (prefix === 'ads') {
            this.adAtlasInfo.small = info;
        } else {
            this.adAtlasInfo.large = info;
        }

        return atlas;
    }

    getAdAtlasInfo(type) {
        const atlas = type === 'large' ? this.adAtlas.large : this.adAtlas.small;
        const info = type === 'large' ? this.adAtlasInfo.large : this.adAtlasInfo.small;
        if (!atlas || !info) return null;
        return { texture: atlas, ...info };
    }

    /**
     * Get a loaded texture by name
     */
    getTexture(name) {
        return this.textures[name] || null;
    }

    /**
     * Create all materials - EXACTLY like SynthCity does
     */
    applyEmissiveNode(material) {
        if (!this.isWebGPU || !material) return;
        if (Array.isArray(material)) {
            material.forEach((mat) => this.applyEmissiveNode(mat));
            return;
        }
        const isNodeMaterial = material.isNodeMaterial
            || material.isMeshPhongNodeMaterial
            || material.isMeshStandardNodeMaterial
            || material.isMeshPhysicalNodeMaterial;
        if (!isNodeMaterial) return;
        if (material.emissiveNode) return;

        const emissiveIntensity = Number.isFinite(material.emissiveIntensity)
            ? material.emissiveIntensity
            : 1.0;
        const emissiveColor = material.emissive?.isColor
            ? vec3(material.emissive.r, material.emissive.g, material.emissive.b)
            : null;

        if (material.emissiveMap) {
            const emissiveTex = uniformTexture(material.emissiveMap);
            const baseColor = emissiveColor ?? vec3(1.0, 1.0, 1.0);
            material.emissiveNode = emissiveTex.mul(baseColor).mul(float(emissiveIntensity));
        } else if (emissiveColor) {
            material.emissiveNode = emissiveColor.mul(float(emissiveIntensity));
        } else {
            material.emissiveNode = vec3(0.0, 0.0, 0.0);
        }

        material.needsUpdate = true;
    }

    createAllMaterials() {
        const envMap = this.getTexture('env_night');
        const MaterialClass = this.isWebGPU ? THREE.MeshPhongNodeMaterial : THREE.MeshPhongMaterial;

        // ═══════════════════════════════════════════════════════════════════════════
        // GROUND MATERIAL - with emissive color reflections
        // ═══════════════════════════════════════════════════════════════════════════
        this.materials.ground = new MaterialClass({
            map: this.getTexture('ground'),
            emissive: 0x0090ff, // Blue tint like SynthCity
            emissiveMap: this.getTexture('ground_em'),
            emissiveIntensity: 0.2,
            shininess: 0,
        });

        // ═══════════════════════════════════════════════════════════════════════════
        // STOREFRONTS - 17 variants (storefront_02 through _18) (Phong with reduced emissive)
        // ═══════════════════════════════════════════════════════════════════════════
        for (let i = 2; i <= 18; i++) {
            const id = this.padNumber(i);
            this.materials[`storefront_${id}`] = new MaterialClass({
                map: this.getTexture(`storefront_${id}`),
                emissive: 0xffffff,
                emissiveMap: this.getTexture(`storefront_${id}`), // Use diffuse as emissive
                emissiveIntensity: this.storefrontEmissiveIntensity,
                shininess: 0,
            });
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // BUILDING MATERIALS - 10 different varieties (CRITICAL for visual variety)
        // SynthCity uses MeshPhongMaterial with emissive maps for lit windows
        // ═══════════════════════════════════════════════════════════════════════════
        for (let i = 1; i <= 10; i++) {
            const id = this.padNumber(i);

            // Random emissive hue per material for color variety
            const hue = Math.random() * 360;
            const emissiveColor = new THREE.Color(`hsl(${hue}, 100%, 92%)`);

            const buildingMaterial = new MaterialClass({
                map: this.getTexture(`building_${id}`),
                specular: 0xffffff,
                specularMap: this.getTexture(`building_${id}_spec`),
                envMap,
                emissive: emissiveColor,
                emissiveMap: this.getTexture(`building_${id}_em`),
                emissiveIntensity: this.windowsEmissiveIntensity,
                bumpMap: this.getTexture(`building_${id}`),
                bumpScale: 5,
            });

            if (buildingMaterial.color?.isColor) {
                buildingMaterial.color.multiplyScalar(this.buildingDiffuseBoost);
            }

            this.materials[`building_${id}`] = buildingMaterial;
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // MEGA BUILDING MATERIAL - Special large building texture
        // ═══════════════════════════════════════════════════════════════════════════
        const megaBuildingMaterial = new MaterialClass({
            map: this.getTexture('mega_building_01'),
            specular: 0x777777,
            shininess: 1,
            emissive: 0xffffff,
            emissiveMap: this.getTexture('mega_building_01_em'),
            emissiveIntensity: this.windowsEmissiveIntensity,
            bumpMap: this.getTexture('mega_building_01'),
            bumpScale: 10,
        });
        if (megaBuildingMaterial.color?.isColor) {
            megaBuildingMaterial.color.multiplyScalar(this.buildingDiffuseBoost);
        }
        this.materials.mega_building_01 = megaBuildingMaterial;

        // ═══════════════════════════════════════════════════════════════════════════
        // ADS MATERIALS - Emissive billboards with additive blending
        // ═══════════════════════════════════════════════════════════════════════════

        // Small ads - visible billboard textures (use Phong for lighting control)
        for (let i = 1; i <= 5; i++) {
            const id = this.padNumber(i);
            this.materials[`ads_${id}`] = new MaterialClass({
                map: this.getTexture(`ads_${id}`),
                emissive: 0xffffff,
                emissiveMap: this.getTexture(`ads_${id}`),
                emissiveIntensity: this.adsEmissiveIntensity,
                shininess: 30, // Some gloss
                specular: 0x111111,
                side: THREE.DoubleSide,
            });
        }

        // Large ads (for towers) - visible billboard textures (use Phong)
        for (let i = 1; i <= 18; i++) {
            const id = this.padNumber(i);
            this.materials[`ads_large_${id}`] = new MaterialClass({
                map: this.getTexture(`ads_large_${id}`),
                emissive: 0xffffff,
                emissiveMap: this.getTexture(`ads_large_${id}`),
                emissiveIntensity: this.adsEmissiveIntensity,
                shininess: 30, // Some gloss
                specular: 0x111111,
                side: THREE.DoubleSide,
            });
        }



        // ═══════════════════════════════════════════════════════════════════════════
        // SMOKE MATERIALS - Atmospheric steam effects
        // ═══════════════════════════════════════════════════════════════════════════
        for (let i = 1; i <= 3; i++) {
            const id = this.padNumber(i);
            this.materials[`smoke_${id}`] = new MaterialClass({
                alphaMap: this.getTexture(`smoke_${id}`),
                color: 0xffffff,
                shininess: 0,
                specular: 0x000000,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                transparent: false,
            });
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // SPOTLIGHT MATERIALS - Volumetric light beams
        // ═══════════════════════════════════════════════════════════════════════════
        for (let i = 1; i <= 4; i++) {
            const id = this.padNumber(i);
            this.materials[`spotlight_${id}`] = new MaterialClass({
                alphaMap: this.getTexture(`spotlight_${id}`),
                color: 0xffffff,
                shininess: 0,
                specular: 0x000000,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                transparent: false,
            });
        }

        if (this.isWebGPU) {
            Object.values(this.materials).forEach((mat) => this.applyEmissiveNode(mat));
        }

        console.log('[NeonDistrictAssets] All materials created');
    }

    /**
     * Get material by ID (like SynthCity's getMaterial)
     */
    getMaterial(id) {
        return this.materials[id] || null;
    }

    /**
     * Get building material based on noise value (0-1)
     * Uses 6 common building materials like SynthCity
     */
    getBuildingMaterial(noise) {
        const mats = [
            'building_01',
            'building_02',
            'building_03',
            'building_04',
            'building_05',
            'building_07',
        ];
        const index = Math.floor(noise * mats.length);
        return this.getMaterial(mats[index]) || this.getMaterial('building_01');
    }

    /**
     * Get big building material based on noise value
     * Uses rare building textures for special structures
     */
    getBigBuildingMaterial(noise, rare = false) {
        if (rare) {
            const matsRare = ['building_06', 'building_08', 'building_09', 'building_10'];
            const index = Math.floor(noise * matsRare.length);
            return this.getMaterial(matsRare[index]) || this.getMaterial('building_06');
        }
        const mats = ['building_01', 'building_02', 'building_03', 'building_04', 'building_05'];
        const index = Math.floor(noise * mats.length);
        return this.getMaterial(mats[index]) || this.getMaterial('building_01');
    }

    /**
     * Get random small ad material
     */
    getRandomAdMaterial() {
        const index = Math.floor(Math.random() * 5) + 1;
        return this.getMaterial(`ads_${this.padNumber(index)}`);
    }

    /**
     * Get random large ad material
     */
    getRandomLargeAdMaterial() {
        const index = Math.floor(Math.random() * 18) + 1;
        return this.getMaterial(`ads_large_${this.padNumber(index)}`);
    }



    /**
     * Get random smoke material
     */
    getRandomSmokeMaterial() {
        const index = Math.floor(Math.random() * 3) + 1;
        return this.getMaterial(`smoke_${this.padNumber(index)}`);
    }

    /**
     * Get unique storefront material (each storefront only used once)
     * Returns null if all storefronts have been used
     */
    getRandomStorefrontMaterial() {
        // Initialize available storefronts if empty
        if (this.availableStorefronts.length === 0 && this.usedStorefronts.size === 0) {
            // Create shuffled array of storefront indices (2-18)
            for (let i = 2; i <= 18; i++) {
                this.availableStorefronts.push(i);
            }
            // Shuffle using Fisher-Yates
            for (let i = this.availableStorefronts.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.availableStorefronts[i], this.availableStorefronts[j]] = [this.availableStorefronts[j], this.availableStorefronts[i]];
            }
        }

        // If no storefronts available, return null (all used)
        if (this.availableStorefronts.length === 0) {
            return null;
        }

        // Pop from available and track as used
        const index = this.availableStorefronts.pop();
        this.usedStorefronts.add(index);

        return this.getMaterial(`storefront_${this.padNumber(index)}`);
    }

    /**
     * Reset storefront tracking (call when theme reinitializes)
     */
    resetStorefronts() {
        this.availableStorefronts = [];
        this.usedStorefronts.clear();
    }

    /**
     * Get random spotlight material
     */
    getRandomSpotlightMaterial() {
        const index = Math.floor(Math.random() * 4) + 1;
        return this.getMaterial(`spotlight_${this.padNumber(index)}`);
    }

    /**
     * Dispose all textures and materials
     */
    dispose() {
        // Dispose textures
        Object.values(this.textures).forEach((texture) => {
            if (texture && texture.dispose) texture.dispose();
        });
        this.textures = {};

        Object.values(this.adAtlas).forEach((atlas) => {
            if (atlas && atlas.dispose) atlas.dispose();
        });
        this.adAtlas = { small: null, large: null };
        this.adAtlasInfo = { small: null, large: null };

        // Dispose materials
        Object.values(this.materials).forEach((material) => {
            if (material && material.dispose) material.dispose();
        });
        this.materials = {};

        this.loaded = false;
        console.log('[NeonDistrictAssets] Disposed all assets');
    }
}

// Singleton instance
export const neonDistrictAssets = new NeonDistrictAssets();
