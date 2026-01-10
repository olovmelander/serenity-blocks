/**
 * Cosmic Exploration Effect - Split-Layer Implementation
 * 
 * Immersive cosmic visual that activates during minimap drag-to-explore.
 * Uses TWO layers:
 *   - Background layer (z-index: -1): Stars behind the game
 *   - Foreground layer (z-index: 10000): Subtle particles in front
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import {
    explorationStarVertexShader,
    explorationStarFragmentShader,
    TimeDilationShader,
} from './cosmic-exploration-shaders.js';
import { CosmicParticleSystem } from './CosmicParticleSystem.js';
import { normalizeQuality, getCosmicExplorationConfig } from '../../utils/quality.js';



export class CosmicExplorationEffect {
    constructor(options = {}) {
        this.quality = normalizeQuality(options.quality);
        this.qualityPreset = getCosmicExplorationConfig(this.quality);
        this.gameState = options.gameState || null;

        // === BACKGROUND LAYER (stars + particles behind UI) ===
        this.bgContainer = null;
        this.bgRenderer = null;
        this.bgScene = null;
        this.bgCamera = null;
        this.bgComposer = null;
        this.timeDilationPass = null;
        this.starfield = null;
        this.bgDust = null;

        // === FOREGROUND LAYER (subtle particles in front of UI) ===
        this.fgContainer = null;
        this.fgRenderer = null;
        this.fgScene = null;
        this.fgCamera = null;
        this.fgDust = null;

        // Animation state
        this.isActive = false;
        this.clock = new THREE.Clock();
        this.animationId = null;

        // Fade transitions
        this.fadeAlpha = 0;
        this.targetFadeAlpha = 0;
        this.fadeSpeed = 2.0; // 500ms fade in
        this.fadeOutSpeed = 3.33; // 300ms fade out

        // Camera tracking
        this.lastCameraRow = 0;
        this.cameraVelocity = 0;
        this.driftAccumulator = { x: 0, y: 0 };

        // Build metrics
        this.heightIntensity = 0;
        this.densityBrightness = 0.5;
        this.normalizedHeight = 0; // 0.0 (bottom) to 1.0 (top)

        // Smoothing for warp effect
        this.smoothedVelocity = 0;

        this._createContainers();
        this._initBackgroundLayer();
        this._initForegroundLayer();

        // Handle resize
        this._boundResize = this._onResize.bind(this);
        window.addEventListener('resize', this._boundResize);

        console.log('[CosmicExploration] Split-layer effect initialized:', this.quality);
    }

    _createContainers() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Background container - BEHIND the game UI
        this.bgContainer = document.createElement('div');
        this.bgContainer.id = 'cosmic-bg-layer';
        this.bgContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: ${width}px;
            height: ${height}px;
            pointer-events: none;
            z-index: -1;
            opacity: 0;
            transition: opacity 0.3s ease-out;
        `;
        document.body.appendChild(this.bgContainer);

        // Foreground container - IN FRONT of the game UI
        this.fgContainer = document.createElement('div');
        this.fgContainer.id = 'cosmic-fg-layer';
        this.fgContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: ${width}px;
            height: ${height}px;
            pointer-events: none;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s ease-out;
        `;
        document.body.appendChild(this.fgContainer);
    }

    _initBackgroundLayer() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.bgScene = new THREE.Scene();
        this.bgCamera = new THREE.PerspectiveCamera(60, width / height, 1, 20000);
        this.bgCamera.position.z = 500;

        this.bgRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.bgRenderer.setSize(width, height);
        this.bgRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.bgRenderer.setClearColor(0x000000, 1);
        this.bgContainer.appendChild(this.bgRenderer.domElement);

        // Create starfield
        this._createStarfield();

        // Create background dust particles
        this.bgDust = new CosmicParticleSystem({
            maxParticles: this.qualityPreset.bgDust,
            scene: this.bgScene,
        });

        // Post-processing
        this._setupBackgroundPostProcessing(width, height);
    }

    _initForegroundLayer() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.fgScene = new THREE.Scene();
        this.fgCamera = new THREE.PerspectiveCamera(60, width / height, 1, 5000);
        this.fgCamera.position.z = 300;

        this.fgRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.fgRenderer.setSize(width, height);
        this.fgRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.fgRenderer.setClearColor(0x000000, 0);
        this.fgContainer.appendChild(this.fgRenderer.domElement);

        // Create foreground dust - smaller, more subtle, closer to camera
        this.fgDust = new CosmicParticleSystem({
            maxParticles: this.qualityPreset.fgDust,
            scene: this.fgScene,
            isForeground: true,  // Flag for subtle settings
        });
    }

    _createStarfield() {
        const starCount = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const twinkleData = new Float32Array(starCount * 2);
        const brightness = new Float32Array(starCount);

        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xe8e8ff),
            new THREE.Color(0xd0d0ff),
            new THREE.Color(0xc0c8ff),
            new THREE.Color(0xb8c0ff),
            new THREE.Color(0xa0a8e0),
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            // Spherical distribution
            const radius = 3000 + Math.random() * 12000;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi);

            const colorIndex = Math.floor(Math.random() * starColors.length);
            const color = starColors[colorIndex];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 25 + Math.random() * 60;
            twinkleData[i2] = Math.random() * Math.PI * 2;
            twinkleData[i2 + 1] = 0.5 + Math.random() * 1.5;
            brightness[i] = 0.5 + Math.random() * 0.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: this.bgRenderer.getPixelRatio() },
                uDriftX: { value: 0 },
                uDriftY: { value: 0 },
                uFadeAlpha: { value: 0 },
                uHeight: { value: 0 }, // Height-based color shift
            },
            vertexShader: explorationStarVertexShader,
            fragmentShader: explorationStarFragmentShader,
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.bgScene.add(this.starfield);
    }

    _setupBackgroundPostProcessing(width, height) {
        this.bgComposer = new EffectComposer(this.bgRenderer);

        const renderPass = new RenderPass(this.bgScene, this.bgCamera);
        this.bgComposer.addPass(renderPass);

        if (this.qualityPreset.enableBloom) {
            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(width, height),
                this.qualityPreset.bloomStrength,
                0.4,
                0.85
            );
            this.bgComposer.addPass(bloomPass);
        }

        // Add Time Dilation / Warp Speed Pass
        this.timeDilationPass = new ShaderPass(TimeDilationShader);
        this.bgComposer.addPass(this.timeDilationPass);
    }

    start() {
        if (this.isActive) return;

        this.isActive = true;
        this.targetFadeAlpha = 1;
        this.clock.start();
        this.bgContainer.style.opacity = '1';
        this.fgContainer.style.opacity = '1';

        this._animate();
        console.log('[CosmicExploration] Effect started');
    }

    stop() {
        if (!this.isActive) return;
        this.targetFadeAlpha = 0;
        console.log('[CosmicExploration] Effect stopping (fading out)');
    }

    updateCameraPosition(newRow, deltaTime = 0.016) {
        if (!this.isActive) return;

        const velocity = (newRow - this.lastCameraRow) / deltaTime;
        this.cameraVelocity = velocity;
        this.lastCameraRow = newRow;

        this.driftAccumulator.y += velocity * 0.08;
        this.driftAccumulator.x *= 0.95;
        this.driftAccumulator.y *= 0.92;

        const maxRows = this.gameState?.board?.length || 1000;
        // Calculate normalized height for color shift (0.0 = Start/Bottom, 1.0 = Goal/Top)
        this.normalizedHeight = 1.0 - (Math.max(0, Math.min(maxRows, newRow)) / maxRows);

        this.heightIntensity = this.normalizedHeight;

        if (this.gameState?.board) {
            this._updateDensity(newRow);
        }
    }

    _updateDensity(centerRow) {
        const board = this.gameState?.board;
        if (!board) return;

        const visibleRows = 20;
        const startRow = Math.max(0, Math.floor(centerRow) - Math.floor(visibleRows / 2));
        const endRow = Math.min(board.length, startRow + visibleRows);

        let filledCells = 0;
        let totalCells = 0;

        for (let row = startRow; row < endRow; row++) {
            if (board[row]) {
                for (let col = 0; col < board[row].length; col++) {
                    totalCells++;
                    if (board[row][col] !== 0) {
                        filledCells++;
                    }
                }
            }
        }

        this.densityBrightness = totalCells > 0 ? filledCells / totalCells : 0;
    }

    _animate() {
        if (!this.isActive && this.fadeAlpha <= 0.01) {
            this._onFadeComplete();
            return;
        }

        this.animationId = requestAnimationFrame(() => this._animate());

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();

        // Update fade
        if (this.fadeAlpha < this.targetFadeAlpha) {
            this.fadeAlpha = Math.min(this.targetFadeAlpha, this.fadeAlpha + delta * this.fadeSpeed);
        } else if (this.fadeAlpha > this.targetFadeAlpha) {
            this.fadeAlpha = Math.max(this.targetFadeAlpha, this.fadeAlpha - delta * this.fadeOutSpeed);
        }

        // Smooth velocity for warp effect
        // Decay velocity if no input
        this.cameraVelocity *= 0.9;
        this.smoothedVelocity = THREE.MathUtils.lerp(this.smoothedVelocity, this.cameraVelocity, 0.1);

        // Limit maximum warp to avoid extreme artifacts and normalize
        // Velocity typical range is -50 to 50 during drag
        const warpVelocity = Math.max(-200, Math.min(200, this.smoothedVelocity));
        const normalizedWarp = warpVelocity / 100.0;

        // === BACKGROUND LAYER UPDATES ===
        if (this.starfield?.material?.uniforms) {
            const uniforms = this.starfield.material.uniforms;
            uniforms.uTime.value = elapsed;
            uniforms.uDriftX.value = this.driftAccumulator.x * 50;
            uniforms.uDriftY.value = this.driftAccumulator.y * 30;
            uniforms.uFadeAlpha.value = this.fadeAlpha;
            uniforms.uHeight.value = this.normalizedHeight;
        }

        // Update time dilation / warp effect
        if (this.timeDilationPass) {
            this.timeDilationPass.uniforms.uIntensity.value = this.fadeAlpha * 0.15;
            this.timeDilationPass.uniforms.uTime.value = elapsed;
            this.timeDilationPass.uniforms.uVelocityY.value = normalizedWarp;
        }

        if (this.bgDust) {
            this.bgDust.setDrift(-this.driftAccumulator.x, -this.driftAccumulator.y);
            this.bgDust.setDensityBrightness(this.densityBrightness);
            this.bgDust.setFadeAlpha(this.fadeAlpha);
            this.bgDust.update(elapsed);
        }

        // Slow camera rotation for immersion
        this.bgCamera.rotation.z = Math.sin(elapsed * 0.1) * 0.02;

        // === FOREGROUND LAYER UPDATES ===
        if (this.fgDust) {
            // Foreground particles move faster/more noticeably with scroll
            this.fgDust.setDrift(-this.driftAccumulator.x * 1.5, -this.driftAccumulator.y * 1.5);
            this.fgDust.setDensityBrightness(this.densityBrightness * 0.6); // Dimmer
            this.fgDust.setFadeAlpha(this.fadeAlpha * 0.5); // More transparent
            this.fgDust.update(elapsed);
        }

        this.fgCamera.rotation.z = Math.sin(elapsed * 0.12) * 0.015;

        // === RENDER BOTH LAYERS ===
        if (this.bgComposer) {
            this.bgComposer.render();
        } else {
            this.bgRenderer.render(this.bgScene, this.bgCamera);
        }

        this.fgRenderer.render(this.fgScene, this.fgCamera);

        // Check if we should fully stop
        if (this.targetFadeAlpha === 0 && this.fadeAlpha <= 0.01) {
            this.isActive = false;
        }
    }

    _onFadeComplete() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.clock.stop();
        this.bgContainer.style.opacity = '0';
        this.fgContainer.style.opacity = '0';
        console.log('[CosmicExploration] Effect fully stopped');
    }

    _onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Background
        this.bgCamera.aspect = width / height;
        this.bgCamera.updateProjectionMatrix();
        this.bgRenderer.setSize(width, height);
        if (this.bgComposer) this.bgComposer.setSize(width, height);
        this.bgContainer.style.width = `${width}px`;
        this.bgContainer.style.height = `${height}px`;

        // Foreground
        this.fgCamera.aspect = width / height;
        this.fgCamera.updateProjectionMatrix();
        this.fgRenderer.setSize(width, height);
        this.fgContainer.style.width = `${width}px`;
        this.fgContainer.style.height = `${height}px`;
    }

    dispose() {
        console.log('[CosmicExploration] Disposing effect');

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        if (this._boundResize) {
            window.removeEventListener('resize', this._boundResize);
        }

        // Dispose background
        if (this.starfield) {
            this.starfield.geometry?.dispose();
            this.starfield.material?.dispose();
            this.bgScene.remove(this.starfield);
            this.starfield = null;
        }
        if (this.bgDust) {
            this.bgDust.dispose();
            this.bgDust = null;
        }
        if (this.bgComposer) {
            this.bgComposer.dispose();
            this.bgComposer = null;
        }
        if (this.bgRenderer) {
            this.bgRenderer.dispose();
            this.bgRenderer = null;
        }
        if (this.bgContainer?.parentNode) {
            this.bgContainer.parentNode.removeChild(this.bgContainer);
        }

        // Dispose foreground
        if (this.fgDust) {
            this.fgDust.dispose();
            this.fgDust = null;
        }
        if (this.fgRenderer) {
            this.fgRenderer.dispose();
            this.fgRenderer = null;
        }
        if (this.fgContainer?.parentNode) {
            this.fgContainer.parentNode.removeChild(this.fgContainer);
        }

        this.bgScene = null;
        this.fgScene = null;
        this.bgCamera = null;
        this.fgCamera = null;
        this.isActive = false;
    }
}
