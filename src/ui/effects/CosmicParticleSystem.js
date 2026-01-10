/**
 * Cosmic Particle System
 * 
 * Optimized pooled particle system for cosmic dust effects during exploration.
 * Particles drift based on camera velocity and brightness varies with block density.
 */

import * as THREE from 'three';
import { cosmicDustVertexShader, cosmicDustFragmentShader } from './cosmic-exploration-shaders.js';

export class CosmicParticleSystem {
    constructor(options = {}) {
        this.maxParticles = options.maxParticles || 200;
        this.scene = options.scene;
        this.isForeground = options.isForeground || false;

        this.particles = null;
        this.geometry = null;
        this.material = null;

        // Dynamic uniforms
        this.driftX = 0;
        this.driftY = 0;
        this.densityBrightness = 0.5;
        this.fadeAlpha = 0;

        this._createParticles();
    }

    _createParticles() {
        this.geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(this.maxParticles * 3);
        const sizes = new Float32Array(this.maxParticles);
        const randoms = new Float32Array(this.maxParticles);
        const speeds = new Float32Array(this.maxParticles);

        // Foreground particles are closer, smaller, and more spread out
        const spreadX = this.isForeground ? 3000 : 4000;
        const spreadY = this.isForeground ? 2000 : 3000;
        const zNear = this.isForeground ? -100 : -500;
        const zDepth = this.isForeground ? 600 : 2000;
        const sizeMin = this.isForeground ? 6 : 15;
        const sizeMax = this.isForeground ? 20 : 45;

        for (let i = 0; i < this.maxParticles; i++) {
            const i3 = i * 3;

            positions[i3] = (Math.random() - 0.5) * spreadX;
            positions[i3 + 1] = (Math.random() - 0.5) * spreadY;
            positions[i3 + 2] = zNear - Math.random() * zDepth;

            sizes[i] = sizeMin + Math.random() * sizeMax;
            randoms[i] = Math.random();
            speeds[i] = 0.3 + Math.random() * 0.7;
        }

        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        this.geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        this.geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uDriftX: { value: 0 },
                uDriftY: { value: 0 },
                uDensityBrightness: { value: 0.5 },
                uFadeAlpha: { value: 0 },
            },
            vertexShader: cosmicDustVertexShader,
            fragmentShader: cosmicDustFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.particles = new THREE.Points(this.geometry, this.material);

        if (this.scene) {
            this.scene.add(this.particles);
        }
    }

    /**
     * Set drift direction based on camera velocity
     * @param {number} driftX - Horizontal drift (-1 to 1)
     * @param {number} driftY - Vertical drift (-1 to 1)
     */
    setDrift(driftX, driftY) {
        this.driftX = driftX;
        this.driftY = driftY;
    }

    /**
     * Set brightness based on block density
     * @param {number} density - 0 to 1
     */
    setDensityBrightness(density) {
        this.densityBrightness = Math.max(0, Math.min(1, density));
    }

    /**
     * Set fade alpha for transitions
     * @param {number} alpha - 0 to 1
     */
    setFadeAlpha(alpha) {
        this.fadeAlpha = alpha;
    }

    /**
     * Update particle system
     * @param {number} time - Elapsed time in seconds
     */
    update(time) {
        if (!this.material) return;

        const uniforms = this.material.uniforms;
        uniforms.uTime.value = time;
        uniforms.uDriftX.value = this.driftX * 100; // Scale for visual effect
        uniforms.uDriftY.value = this.driftY * 100;
        uniforms.uDensityBrightness.value = this.densityBrightness;
        uniforms.uFadeAlpha.value = this.fadeAlpha;
    }

    /**
     * Add to scene
     */
    addToScene(scene) {
        if (this.particles && !this.particles.parent) {
            scene.add(this.particles);
            this.scene = scene;
        }
    }

    /**
     * Remove from scene
     */
    removeFromScene() {
        if (this.particles && this.particles.parent) {
            this.particles.parent.remove(this.particles);
        }
    }

    /**
     * Dispose of resources
     */
    dispose() {
        this.removeFromScene();

        if (this.geometry) {
            this.geometry.dispose();
            this.geometry = null;
        }

        if (this.material) {
            this.material.dispose();
            this.material = null;
        }

        this.particles = null;
    }
}
