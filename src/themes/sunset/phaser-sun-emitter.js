import Phaser from 'phaser';
import {
    createParticleEmitter,
    destroyParticleEmitter,
} from '../../rendering/phaser/utils/particle-compat.js';

/**
 * Lightweight Phaser scene dedicated to rendering the animated sun core.
 * Runs inside a transparent canvas that sits underneath the DOM-based halo/lens layers.
 */
export class PhaserSunEmitter {
    /**
     * @param {HTMLElement} container
     */
    constructor(container) {
        this.container = container;
        this.game = null;
        this.scene = null;
        this.coreGlow = null;
        this.haloGlow = null;
        this.sparkEmitter = null;
        this.trailEmitter = null;
        this.pendingState = null;
        this._resolveReady = null;
        this._readyPromise = null;
        this._width = 256;
        this._height = 256;
    }

    /**
     * Initialize Phaser (idempotent).
     * @returns {Promise<void>}
     */
    init() {
        if (this.game || !this.container) {
            return this._readyPromise ?? Promise.resolve();
        }

        if (!Phaser || !Phaser.Game) {
            console.warn('[PhaserSunEmitter] Phaser runtime missing, skipping sun emitter.');
            return Promise.resolve();
        }

        const sceneConfig = {
            key: 'SunsetSunScene',
            preload: (scene) => this._preload(scene),
            create: (scene) => this._create(scene),
        };

        const config = {
            type: Phaser.WEBGL,
            width: this._width,
            height: this._height,
            transparent: true,
            backgroundColor: 'rgba(0,0,0,0)',
            parent: this.container,
            scene: sceneConfig,
        };

        this._readyPromise = new Promise((resolve, reject) => {
            this._resolveReady = resolve;
            try {
                this.game = new Phaser.Game(config);
            } catch (error) {
                console.error('[PhaserSunEmitter] Failed to create Phaser game', error);
                reject(error);
            }
        });

        return this._readyPromise;
    }

    async _preload(scene) {
        const graphics = scene.make.graphics({ x: 0, y: 0, add: false });

        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(128, 128, 120);
        graphics.generateTexture('sun-core', 256, 256);

        graphics.clear();
        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(8, 8, 8);
        graphics.generateTexture('sun-ember', 16, 16);

        graphics.destroy();
    }

    _create(scene) {
        this.scene = scene;
        const centerX = this._width / 2;
        const centerY = this._height / 2;

        this.coreGlow = scene.add.image(centerX, centerY, 'sun-core');
        this.coreGlow.setBlendMode(Phaser.BlendModes.ADD);
        this.coreGlow.setAlpha(0.85);
        this.coreGlow.setScale(0.9);

        this.haloGlow = scene.add.image(centerX, centerY, 'sun-core');
        this.haloGlow.setBlendMode(Phaser.BlendModes.SCREEN);
        this.haloGlow.setTint(0xffc38b);
        this.haloGlow.setAlpha(0.35);
        this.haloGlow.setScale(1.2);

        this.sparkEmitter = createParticleEmitter(scene, centerX, centerY, 'sun-ember', {
            lifespan: { min: 900, max: 2400 },
            speed: { min: 8, max: 42 },
            angle: { min: 200, max: 340 },
            gravityY: 14,
            scale: { start: 0.7, end: 0.05 },
            alpha: { start: 0.65, end: 0 },
            blendMode: 'ADD',
            frequency: 140, // Reduced frequency (was 90) - fewer particles
            quantity: 1,
        });

        if (this.sparkEmitter?.setDepth) {
            this.sparkEmitter.setDepth(5);
        }

        const PhaserRef = (typeof window !== 'undefined' ? window.Phaser : null) || Phaser;
        if (PhaserRef?.Geom?.Circle) {
            const circle = new PhaserRef.Geom.Circle(centerX, centerY, 70);
            this.trailEmitter = createParticleEmitter(scene, centerX, centerY, 'sun-ember', {
                lifespan: { min: 1200, max: 2600 },
                speed: { min: 5, max: 18 },
                scale: { start: 0.4, end: 0 },
                alpha: { start: 0.25, end: 0 },
                blendMode: 'ADD',
                frequency: 220, // Reduced frequency (was 160) - fewer particles
                quantity: 1, // Reduced quantity (was 2)
                emitZone: { type: 'edge', source: circle, quantity: 20 }, // Reduced zone quantity (was 28)
            });
        }

        if (this.sparkEmitter?.start) this.sparkEmitter.start();
        if (this.trailEmitter?.start) this.trailEmitter.start();

        if (this.pendingState) {
            this.setSolarState(this.pendingState);
            this.pendingState = null;
        }

        if (typeof this._resolveReady === 'function') {
            this._resolveReady();
            this._resolveReady = null;
        }
    }

    /**
     * Update visuals based on solar state.
     * @param {{intensity:number, altitude:number}} state
     */
    setSolarState(state) {
        if (!state) return;
        if (!this.scene) {
            this.pendingState = state;
            return;
        }

        const { intensity = 0.6, altitude = 0.5 } = state;
        const glowScale = 0.85 + intensity * 0.4;
        if (this.coreGlow) {
            this.coreGlow.setScale(glowScale);
            this.coreGlow.setAlpha(0.65 + intensity * 0.35);
        }
        if (this.haloGlow) {
            this.haloGlow.setScale(1.1 + altitude * 0.55);
            this.haloGlow.setAlpha(0.2 + (1 - altitude) * 0.25);
        }
        if (this.sparkEmitter) {
            // Reduced particle emission - slower frequency means fewer particles
            this.sparkEmitter.frequency = Math.max(80, 160 - intensity * 50);
        }
        if (this.trailEmitter) {
            // Reduced particle emission - slower frequency means fewer particles
            this.trailEmitter.frequency = Math.max(180, 260 - altitude * 40);
        }
    }

    /**
     * Dispose Phaser instance and emitters.
     */
    destroy() {
        destroyParticleEmitter(this.sparkEmitter);
        destroyParticleEmitter(this.trailEmitter);
        this.sparkEmitter = null;
        this.trailEmitter = null;
        this.coreGlow = null;
        this.haloGlow = null;

        if (this.game) {
            try {
                this.game.destroy(true);
            } catch (error) {
                console.warn('[PhaserSunEmitter] Unable to destroy Phaser game', error);
            }
        }
        this.game = null;
        this.scene = null;
        this._readyPromise = null;
    }
}
