import { BaseTheme } from '../base-theme.js';
import { ELECTRIC_DREAMS_TETROMINOS } from './electric-dreams-tetrominos.js';
import WebGLElectricDreamsRenderer from './webgl-electric-dreams-renderer.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class ElectricDreamsTheme extends BaseTheme {
    constructor() {
        super('electric-dreams');
        this.renderer = null;
        this.canvas = null;
        this.animationTime = 0;
        this.resizeHandler = null;
        this.eventUnsubscribers = [];

        // Effect state
        // Effect state
        this.deformValue = 0;
        this.targetDeform = 0;
        this.bounceTarget = 0;
    }

    async createScene() {
        const container = this.getContainer('electric-dreams-theme');

        let themeContainer = document.getElementById('theme-background');
        if (!themeContainer) {
            themeContainer = document.body;
        }

        // Create Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'electric-dreams-webgl-canvas';
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.zIndex = '-1'; // Background

        // Remove old containers if they exist
        const oldVeins = document.getElementById('electric-veins');
        if (oldVeins) oldVeins.style.display = 'none';
        const oldParticles = document.getElementById('electric-particles');
        if (oldParticles) oldParticles.style.display = 'none';

        themeContainer.appendChild(this.canvas);
        this.registerContainer(this.canvas);

        this.renderer = new WebGLElectricDreamsRenderer(this.canvas);
        if (!this.renderer.init()) {
            console.error('Failed to init WebGL renderer for Electric Dreams');
            return;
        }

        this.resize();
        this.resizeHandler = () => this.resize();
        window.addEventListener('resize', this.resizeHandler);

        this.setupEventListeners();
        this.animate();
    }

    setupEventListeners() {
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive) {
                this.handlePieceLock(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive) {
                this.handleCombo(data);
            }
        });

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive) {
                this.handleLineClear(data);
            }
        });

        this.eventUnsubscribers.push(pieceLockUnsub, comboUnsub, lineClearUnsub);
    }

    handlePieceLock(data) {
        // Smooth surge - Bigger effect but slow onset
        // We set the TARGET, not the value directly, to avoid instant jumps
        this.targetDeform = 4.0;

        // Explosion at piece location if available, otherwise random
        // data.x and data.y might be grid coordinates. We need screen coordinates or normalized 0-1.
        // Assuming we don't have easy grid-to-screen conversion here without more context,
        // we'll use a random position near the center-bottom or just random.
        // But for a "lock" effect, random across the board is okay for this abstract theme.

        if (this.renderer) {
            this.renderer.spawnExplosion(Math.random() * 0.8 + 0.1, Math.random() * 0.8 + 0.1, 8);
        }
    }

    handleCombo(data) {
        const count = data.comboCount || 1;
        // Stronger deformation target
        this.targetDeform = 4.0 + Math.min(count * 0.8, 4.0);

        if (this.renderer) {
            // Multiple explosions for combos
            for (let i = 0; i < Math.min(count, 5); i++) {
                setTimeout(() => {
                    this.renderer.spawnExplosion(Math.random(), Math.random(), 12);
                }, i * 100);
            }
        }
    }

    handleLineClear(data) {
        // Pulse deformation target
        this.targetDeform = 5.0;
    }

    resize() {
        if (!this.renderer || !this.canvas) return;
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.renderer.resize(width, height);
    }

    animate() {
        if (!this.isActive || !this.renderer) return;

        this.animationTime += 16;

        // Super slow, viscous physics
        // 1. Smoothly move actual value towards the target (The "Swell")
        this.deformValue += (this.targetDeform - this.deformValue) * 0.02;

        // 2. Slowly decay the target back to 0 (The "Release")
        this.targetDeform += (0 - this.targetDeform) * 0.01;

        this.renderer.render(this.animationTime * 0.001, this.deformValue);

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    stop() {
        // 1. Stop listening to resize events
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // 2. Unsubscribe from event bus
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // 3. Stop the animation loop immediately
        this.isActive = false; // Ensure animate() stops immediately

        // 4. Clean up renderer
        if (this.renderer) {
            // If the renderer has a dispose method, call it. 
            // Assuming WebGLElectricDreamsRenderer might need one or we just let it go.
            // For now, just nulling it should stop the render calls.
            this.renderer = null;
        }

        // 5. Remove canvas
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;

        super.stop();
    }

    getTetrominoConfig() {
        return ELECTRIC_DREAMS_TETROMINOS;
    }
}
