/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ NEON DISTRICT ASSET MANAGER ✧
 *  SynthCity-style texture loading for the Neon District theme
 *  PROPERLY REPLICATES SynthCity approach with MeshPhongMaterial and emissive maps
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

const TEXTURE_PATH = './textures/synthcity/';

/**
 * Asset Manager for Neon District theme
 * Properly replicates SynthCity's material creation approach
 */
export class NeonDistrictAssets {
    constructor() {
        this.textures = {};
        this.materials = {};
        this.loadingManager = new THREE.LoadingManager();
        this.textureLoader = new THREE.TextureLoader(this.loadingManager);

        // Configuration - balanced brightness
        this.textureAnisotropy = 8;
        this.windowsEmissiveIntensity = 3.0;  // Higher to punch through fog on distant buildings
        this.adsEmissiveIntensity = 0.4;      // Reduced for less glare
        this.storefrontEmissiveIntensity = 0.55; // Further reduced for less glare

        // Track loaded state
        this.loaded = false;
    }

    /**
     * Pad number to 2 digits (01, 02, etc.)
     */
    padNumber(num) {
        return num.toString().padStart(2, '0');
    }

    /**
     * Load all textures (call once during init) - PARALLEL loading for speed
     */
    async loadAllTextures() {
        console.log('[NeonDistrictAssets] Loading textures...');

        const loader = this.textureLoader;
        const texPath = TEXTURE_PATH;

        // Helper to load texture with settings
        const loadTex = (name, wrap = false, aniso = true) => {
            return new Promise((resolve) => {
                loader.load(texPath + name,
                    (tex) => {
                        if (wrap) {
                            tex.wrapS = THREE.RepeatWrapping;
                            tex.wrapT = THREE.RepeatWrapping;
                        }
                        if (aniso) {
                            tex.anisotropy = this.textureAnisotropy;
                        }
                        this.textures[name.replace('.jpg', '').replace('.png', '')] = tex;
                        resolve(tex);
                    },
                    undefined,
                    () => {
                        // Silently resolve null for missing textures
                        resolve(null);
                    }
                );
            });
        };

        // Build array of all texture load promises for PARALLEL loading
        const texturePromises = [];

        // Ground
        texturePromises.push(loadTex('ground.jpg'));
        texturePromises.push(loadTex('ground_em.jpg'));

        // Storefronts - 6 variants (storefront_02 through _07)
        for (let i = 2; i <= 7; i++) {
            texturePromises.push(loadTex(`storefront_${this.padNumber(i)}.jpg`, true, true));
        }

        // Environment - load with others, configure after
        texturePromises.push(
            loadTex('environment_night.jpg').then(tex => {
                if (tex) {
                    tex.mapping = THREE.EquirectangularReflectionMapping;
                    tex.magFilter = THREE.LinearFilter;
                    this.textures['env_night'] = tex;
                }
                return tex;
            })
        );

        // Building textures (10 sets) - with wrap and anisotropy
        for (let i = 1; i <= 10; i++) {
            const id = this.padNumber(i);
            texturePromises.push(loadTex(`building_${id}.jpg`, true, true));
            texturePromises.push(loadTex(`building_${id}_em.jpg`, true, true));
            texturePromises.push(loadTex(`building_${id}_spec.jpg`, true, true));
            texturePromises.push(loadTex(`building_${id}_rough.jpg`, true, true));
        }

        // Mega building
        texturePromises.push(loadTex('mega_building_01.jpg', true, true));
        texturePromises.push(loadTex('mega_building_01_em.jpg', true, true));

        // Small ads (5)
        for (let i = 1; i <= 5; i++) {
            texturePromises.push(loadTex(`ads_${this.padNumber(i)}.jpg`));
        }

        // Large ads (10)
        for (let i = 1; i <= 10; i++) {
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
        this.createAllMaterials();
        this.loaded = true;
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
    createAllMaterials() {
        const envMap = this.getTexture('env_night');

        // ═══════════════════════════════════════════════════════════════════════════
        // GROUND MATERIAL - with emissive color reflections
        // ═══════════════════════════════════════════════════════════════════════════
        this.materials['ground'] = new THREE.MeshPhongMaterial({
            map: this.getTexture('ground'),
            emissive: 0x0090ff,  // Blue tint like SynthCity
            emissiveMap: this.getTexture('ground_em'),
            emissiveIntensity: 0.2,
            shininess: 0
        });

        // ═══════════════════════════════════════════════════════════════════════════
        // STOREFRONTS - 6 variants (storefront_02 through _07) (Phong with reduced emissive)
        // ═══════════════════════════════════════════════════════════════════════════
        for (let i = 2; i <= 7; i++) {
            const id = this.padNumber(i);
            this.materials[`storefront_${id}`] = new THREE.MeshPhongMaterial({
                map: this.getTexture(`storefront_${id}`),
                emissive: 0xffffff,
                emissiveMap: this.getTexture(`storefront_${id}`),  // Use diffuse as emissive
                emissiveIntensity: this.storefrontEmissiveIntensity,
                shininess: 0
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
            const emissiveColor = new THREE.Color(`hsl(${hue}, 100%, 95%)`);

            this.materials[`building_${id}`] = new THREE.MeshPhongMaterial({
                map: this.getTexture(`building_${id}`),
                specular: 0xffffff,
                specularMap: this.getTexture(`building_${id}_spec`),
                envMap: envMap,
                emissive: emissiveColor,
                emissiveMap: this.getTexture(`building_${id}_em`),
                emissiveIntensity: this.windowsEmissiveIntensity,
                bumpMap: this.getTexture(`building_${id}`),
                bumpScale: 5
            });
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // MEGA BUILDING MATERIAL - Special large building texture
        // ═══════════════════════════════════════════════════════════════════════════
        this.materials['mega_building_01'] = new THREE.MeshPhongMaterial({
            map: this.getTexture('mega_building_01'),
            specular: 0x777777,
            shininess: 1,
            emissive: 0xffffff,
            emissiveMap: this.getTexture('mega_building_01_em'),
            emissiveIntensity: this.windowsEmissiveIntensity,
            bumpMap: this.getTexture('mega_building_01'),
            bumpScale: 10
        });

        // ═══════════════════════════════════════════════════════════════════════════
        // ADS MATERIALS - Emissive billboards with additive blending
        // ═══════════════════════════════════════════════════════════════════════════

        // Small ads - visible billboard textures (use Phong for lighting control)
        for (let i = 1; i <= 5; i++) {
            const id = this.padNumber(i);
            this.materials[`ads_${id}`] = new THREE.MeshPhongMaterial({
                map: this.getTexture(`ads_${id}`),
                emissive: 0xffffff,
                emissiveMap: this.getTexture(`ads_${id}`),
                emissiveIntensity: this.adsEmissiveIntensity,
                shininess: 30, // Some gloss
                specular: 0x111111,
                side: THREE.DoubleSide
            });
        }

        // Large ads (for towers) - visible billboard textures (use Phong)
        for (let i = 1; i <= 10; i++) {
            const id = this.padNumber(i);
            this.materials[`ads_large_${id}`] = new THREE.MeshPhongMaterial({
                map: this.getTexture(`ads_large_${id}`),
                emissive: 0xffffff,
                emissiveMap: this.getTexture(`ads_large_${id}`),
                emissiveIntensity: this.adsEmissiveIntensity,
                shininess: 30, // Some gloss
                specular: 0x111111,
                side: THREE.DoubleSide
            });
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // SMOKE MATERIALS - Atmospheric steam effects
        // ═══════════════════════════════════════════════════════════════════════════
        for (let i = 1; i <= 3; i++) {
            const id = this.padNumber(i);
            this.materials[`smoke_${id}`] = new THREE.MeshPhongMaterial({
                alphaMap: this.getTexture(`smoke_${id}`),
                color: 0xffffff,
                shininess: 0,
                specular: 0x000000,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                transparent: false
            });
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // SPOTLIGHT MATERIALS - Volumetric light beams
        // ═══════════════════════════════════════════════════════════════════════════
        for (let i = 1; i <= 4; i++) {
            const id = this.padNumber(i);
            this.materials[`spotlight_${id}`] = new THREE.MeshPhongMaterial({
                alphaMap: this.getTexture(`spotlight_${id}`),
                color: 0xffffff,
                shininess: 0,
                specular: 0x000000,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                transparent: false
            });
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
            'building_07'
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
        } else {
            const mats = ['building_01', 'building_02', 'building_03', 'building_04', 'building_05'];
            const index = Math.floor(noise * mats.length);
            return this.getMaterial(mats[index]) || this.getMaterial('building_01');
        }
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
        const index = Math.floor(Math.random() * 10) + 1;
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
     * Get random storefront material (6 variants: 02-07)
     */
    getRandomStorefrontMaterial() {
        const index = Math.floor(Math.random() * 6) + 2;  // 2-7
        return this.getMaterial(`storefront_${this.padNumber(index)}`);
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
        Object.values(this.textures).forEach(texture => {
            if (texture && texture.dispose) texture.dispose();
        });
        this.textures = {};

        // Dispose materials
        Object.values(this.materials).forEach(material => {
            if (material && material.dispose) material.dispose();
        });
        this.materials = {};

        this.loaded = false;
        console.log('[NeonDistrictAssets] Disposed all assets');
    }
}

// Singleton instance
export const neonDistrictAssets = new NeonDistrictAssets();
