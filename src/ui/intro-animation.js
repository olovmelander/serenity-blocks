/**
 * @fileoverview Epic intro animation for SERENITY BLOCKS
 * Features cosmic particle effects, nebula clouds, stardust, 3D transforms, and galaxy colors
 */

import Phaser from 'phaser';

export class IntroAnimation {
    constructor() {
        this.container = null;
        this.isActive = false;
        this.hasCompleted = false;
        this.boundHandlers = {};
        this.phaserGame = null;
        this.particleEmitters = [];
    }

    /**
     * Initialize and show the intro animation
     * @returns {Promise<void>} Resolves when user dismisses the intro
     */
    async show() {
        if (this.hasCompleted) {
            return Promise.resolve();
        }

        this.isActive = true;
        this.createIntroHTML();
        this.setupEventListeners();
        this.startAnimations();

        // Return a promise that resolves when the intro is dismissed
        return new Promise((resolve) => {
            this.onComplete = resolve;
        });
    }

    /**
     * Create the intro animation HTML structure
     */
    createIntroHTML() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'intro-animation';

        // Create Phaser canvas container
        const phaserCanvas = document.createElement('div');
        phaserCanvas.id = 'intro-phaser-canvas';
        this.container.appendChild(phaserCanvas);

        // Initialize Phaser cosmic particle system
        this.initPhaserCosmicParticles(phaserCanvas);

        // Create particle background (floating up from bottom)
        const particles = this.createParticles();
        this.container.appendChild(particles);

        // Create floating orbs
        const orbs = this.createOrbs();
        this.container.appendChild(orbs);

        // Create title container
        const titleContainer = document.createElement('div');
        titleContainer.className = 'intro-title-container';

        // Create title with individual letters
        const title = this.createAnimatedTitle();
        titleContainer.appendChild(title);

        // Add shimmer effect
        const shimmer = document.createElement('div');
        shimmer.className = 'intro-shimmer';
        titleContainer.appendChild(shimmer);

        this.container.appendChild(titleContainer);

        // Create chromatic aberration overlay
        const chromatic = document.createElement('div');
        chromatic.className = 'intro-chromatic';
        this.container.appendChild(chromatic);

        // Create prompt text
        const prompt = document.createElement('div');
        prompt.className = 'intro-prompt';
        prompt.innerHTML = 'PRESS ANY KEY / CLICK / TAP TO BEGIN';
        this.container.appendChild(prompt);

        // Add to body
        document.body.appendChild(this.container);
    }

    /**
     * Create animated title with individual letters
     * @returns {HTMLElement}
     */
    createAnimatedTitle() {
        const title = document.createElement('h1');
        title.className = 'intro-title';

        const text = 'SERENITY BLOCKS';
        const letters = text.split('');

        letters.forEach((char) => {
            if (char === ' ') {
                const space = document.createElement('span');
                space.className = 'intro-space';
                title.appendChild(space);
            } else {
                const letter = document.createElement('span');
                letter.className = 'intro-letter';
                letter.textContent = char;
                title.appendChild(letter);
            }
        });

        return title;
    }

    /**
     * Create floating particle background
     * @returns {HTMLElement}
     */
    createParticles() {
        const particlesContainer = document.createElement('div');
        particlesContainer.className = 'intro-particles';

        // Create 50 particles
        for (let i = 0; i < 50; i++) {
            const particle = document.createElement('div');
            particle.className = 'intro-particle';

            // Random size
            const size = Math.random() * 3 + 1;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;

            // Random starting position
            particle.style.left = `${Math.random() * 100}%`;

            // Random animation duration and delay
            const duration = Math.random() * 10 + 15;
            const delay = Math.random() * 5;
            particle.style.animationDuration = `${duration}s`;
            particle.style.animationDelay = `${delay}s`;

            // Random horizontal drift
            const drift = (Math.random() - 0.5) * 200;
            particle.style.setProperty('--drift', `${drift}px`);

            particlesContainer.appendChild(particle);
        }

        return particlesContainer;
    }

    /**
     * Create glowing orbs in background
     * @returns {HTMLElement}
     */
    createOrbs() {
        const orbsContainer = document.createElement('div');
        orbsContainer.className = 'intro-orbs';

        const orbConfigs = [
            { color: 'rgba(100, 200, 255, 0.3)', size: 300, x: '10%', y: '20%', floatX: 50, floatY: -30, delay: 0 },
            { color: 'rgba(147, 51, 234, 0.2)', size: 400, x: '80%', y: '70%', floatX: -60, floatY: 40, delay: 2 },
            { color: 'rgba(59, 130, 246, 0.25)', size: 250, x: '50%', y: '10%', floatX: 30, floatY: 50, delay: 4 },
            { color: 'rgba(16, 185, 129, 0.2)', size: 350, x: '20%', y: '80%', floatX: -40, floatY: -50, delay: 1 },
        ];

        orbConfigs.forEach((config) => {
            const orb = document.createElement('div');
            orb.className = 'intro-orb';
            orb.style.width = `${config.size}px`;
            orb.style.height = `${config.size}px`;
            orb.style.left = config.x;
            orb.style.top = config.y;
            orb.style.setProperty('--orb-color', config.color);
            orb.style.setProperty('--float-x', `${config.floatX}px`);
            orb.style.setProperty('--float-y', `${config.floatY}px`);
            orb.style.animationDelay = `${config.delay}s`;
            orbsContainer.appendChild(orb);
        });

        return orbsContainer;
    }

    /**
     * Create prismatic light rays
     * @returns {HTMLElement}
     */
    createLightRays() {
        const raysContainer = document.createElement('div');
        raysContainer.className = 'intro-light-rays';

        const rayColors = [
            'rgba(100, 200, 255, 0.4)',
            'rgba(147, 51, 234, 0.3)',
            'rgba(59, 130, 246, 0.4)',
            'rgba(236, 72, 153, 0.3)',
            'rgba(16, 185, 129, 0.3)',
        ];

        // Create 12 rays
        for (let i = 0; i < 12; i++) {
            const ray = document.createElement('div');
            ray.className = 'intro-ray';
            ray.style.setProperty('--ray-color', rayColors[i % rayColors.length]);
            ray.style.transform = `translate(-50%, 0) rotate(${(i * 360) / 12}deg)`;

            // Stagger the animation
            const delay = (i * 2) / 12;
            ray.style.animationDelay = `${delay}s`;

            raysContainer.appendChild(ray);
        }

        return raysContainer;
    }

    /**
     * Initialize Phaser cosmic particle system with galaxy colors
     */
    initPhaserCosmicParticles(container) {
        console.log('[IntroAnimation] Initializing Phaser cosmic particles...');

        const config = {
            type: Phaser.AUTO,
            parent: container,
            width: window.innerWidth,
            height: window.innerHeight,
            transparent: true,
            backgroundColor: 'rgba(0,0,0,0)',
            scene: {
                create: this.createCosmicScene.bind(this),
            },
        };

        try {
            this.phaserGame = new Phaser.Game(config);
            console.log('[IntroAnimation] Phaser game created successfully');
        } catch (error) {
            console.error('[IntroAnimation] Failed to create Phaser game:', error);
        }
    }

    /**
     * Create cosmic particle scene with nebula clouds, stardust, and galaxy effects
     */
    createCosmicScene() {
        console.log('[IntroAnimation] Creating cosmic scene...');
        const scene = this.phaserGame.scene.scenes[0];
        const width = scene.scale.width;
        const height = scene.scale.height;
        console.log('[IntroAnimation] Scene dimensions:', width, 'x', height);

        // Create particle textures
        const graphics = scene.make.graphics({ x: 0, y: 0, add: false });

        // Stardust particle (small, bright)
        graphics.clear();
        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(2, 2, 2);
        graphics.generateTexture('stardust', 4, 4);

        // Nebula particle (larger, soft with gradient)
        graphics.clear();
        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(10, 10, 10);
        graphics.fillStyle(0xffffff, 0.5);
        graphics.fillCircle(10, 10, 8);
        graphics.fillStyle(0xffffff, 0.2);
        graphics.fillCircle(10, 10, 6);
        graphics.generateTexture('nebula', 20, 20);

        // Cosmic dust (medium size)
        graphics.clear();
        graphics.fillStyle(0xffffff, 0.8);
        graphics.fillCircle(3, 3, 3);
        graphics.generateTexture('cosmic-dust', 6, 6);

        graphics.destroy();

        // Galaxy color palette
        const galaxyColors = [
            0x9333ea, // Purple
            0x3b82f6, // Blue
            0x06b6d4, // Cyan
            0x10b981, // Emerald
            0xec4899, // Pink
            0x8b5cf6, // Violet
            0x14b8a6, // Teal
        ];

        // Create background stars (static)
        console.log('[IntroAnimation] Creating 200 background stars...');
        for (let i = 0; i < 200; i++) {
            const star = scene.add.circle(
                Math.random() * width,
                Math.random() * height,
                Math.random() * 1.5 + 0.5,
                0xffffff,
                Math.random() * 0.8 + 0.2
            );

            // Twinkling animation
            scene.tweens.add({
                targets: star,
                alpha: Math.random() * 0.3,
                duration: Math.random() * 2000 + 1000,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
            });
        }
        console.log('[IntroAnimation] Stars created');

        // Particle emitters from center removed for cleaner look
        console.log('[IntroAnimation] Skipping center particle emitters for cleaner cosmic look');

        // Create shooting stars occasionally
        scene.time.addEvent({
            delay: 2000,
            callback: () => {
                const startX = Math.random() * width;
                const startY = Math.random() * height * 0.3;
                const angle = Math.random() * 45 + 45; // Diagonal downward

                const shootingStar = scene.add.circle(startX, startY, 2, 0xffffff, 1);
                const trail = scene.add.particles(startX, startY, 'stardust', {
                    speed: 0,
                    scale: { start: 0.5, end: 0 },
                    alpha: { start: 1, end: 0 },
                    lifespan: 500,
                    frequency: 10,
                    tint: 0x64c8ff,
                    blendMode: 'ADD',
                    follow: shootingStar,
                });

                scene.tweens.add({
                    targets: shootingStar,
                    x: startX + Math.cos(angle * Math.PI / 180) * 400,
                    y: startY + Math.sin(angle * Math.PI / 180) * 400,
                    alpha: 0,
                    duration: 1500,
                    ease: 'Cubic.easeOut',
                    onComplete: () => {
                        shootingStar.destroy();
                        trail.destroy();
                    },
                });
            },
            loop: true,
        });

        // Store scene reference for cleanup
        this.cosmicScene = scene;
    }

    /**
     * Setup event listeners for user input
     */
    setupEventListeners() {
        // Mouse click
        this.boundHandlers.click = (e) => this.handleInteraction(e);
        this.container.addEventListener('click', this.boundHandlers.click);

        // Keyboard
        this.boundHandlers.keydown = (e) => this.handleInteraction(e);
        window.addEventListener('keydown', this.boundHandlers.keydown);

        // Touch
        this.boundHandlers.touchstart = (e) => this.handleInteraction(e);
        this.container.addEventListener('touchstart', this.boundHandlers.touchstart);

        // Gamepad (check for button press)
        this.gamepadCheckInterval = setInterval(() => {
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            for (let i = 0; i < gamepads.length; i++) {
                const gp = gamepads[i];
                if (gp) {
                    // Check if any button is pressed
                    for (let j = 0; j < gp.buttons.length; j++) {
                        if (gp.buttons[j].pressed) {
                            this.handleInteraction({ type: 'gamepad' });
                            break;
                        }
                    }
                }
            }
        }, 100);
    }

    /**
     * Handle user interaction (click, key press, tap, gamepad)
     */
    handleInteraction(event) {
        if (!this.isActive) return;

        // Create ripple effect at click/touch position
        if (event.clientX !== undefined && event.clientY !== undefined) {
            this.createRipple(event.clientX, event.clientY);
            this.createBurstParticles(event.clientX, event.clientY);
        } else {
            // For keyboard/gamepad, ripple from center
            const rect = this.container.getBoundingClientRect();
            this.createRipple(rect.width / 2, rect.height / 2);
            this.createBurstParticles(rect.width / 2, rect.height / 2);
        }

        // Dismiss intro
        this.dismiss();
    }

    /**
     * Create ripple effect at position
     */
    createRipple(x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'intro-ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        ripple.style.transform = 'translate(-50%, -50%)';
        this.container.appendChild(ripple);

        setTimeout(() => ripple.remove(), 1500);
    }

    /**
     * Create particle burst effect at position
     */
    createBurstParticles(x, y) {
        const particleCount = 20;

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'intro-burst-particle';
            particle.style.left = `${x}px`;
            particle.style.top = `${y}px`;

            // Random direction
            const angle = (i / particleCount) * Math.PI * 2;
            const distance = Math.random() * 150 + 50;
            const burstX = Math.cos(angle) * distance;
            const burstY = Math.sin(angle) * distance;

            particle.style.setProperty('--burst-x', `${burstX}px`);
            particle.style.setProperty('--burst-y', `${burstY}px`);

            this.container.appendChild(particle);

            setTimeout(() => particle.remove(), 1000);
        }
    }

    /**
     * Start animation effects
     */
    startAnimations() {
        // All animations are CSS-based and start automatically
        // This method can be used for any additional JS-based effects
    }

    /**
     * Dismiss the intro animation
     */
    dismiss() {
        if (!this.isActive) return;

        this.isActive = false;
        this.hasCompleted = true;

        // Remove event listeners
        this.container.removeEventListener('click', this.boundHandlers.click);
        window.removeEventListener('keydown', this.boundHandlers.keydown);
        this.container.removeEventListener('touchstart', this.boundHandlers.touchstart);

        if (this.gamepadCheckInterval) {
            clearInterval(this.gamepadCheckInterval);
        }

        // Fade out
        this.container.classList.add('fade-out');

        // Remove from DOM after fade
        setTimeout(() => {
            // Destroy Phaser game instance
            if (this.phaserGame) {
                this.phaserGame.destroy(true);
                this.phaserGame = null;
            }
            this.particleEmitters = [];
            this.cosmicScene = null;

            if (this.container && this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
            this.container = null;

            // Resolve the promise
            if (this.onComplete) {
                this.onComplete();
            }
        }, 1000);
    }

    /**
     * Skip the intro animation (for development/testing)
     */
    skip() {
        if (this.container) {
            this.container.classList.add('hidden');
        }

        // Cleanup Phaser
        if (this.phaserGame) {
            this.phaserGame.destroy(true);
            this.phaserGame = null;
        }
        this.particleEmitters = [];
        this.cosmicScene = null;

        this.hasCompleted = true;
        if (this.onComplete) {
            this.onComplete();
        }
    }

    /**
     * Reset the intro animation (for replay)
     */
    reset() {
        this.hasCompleted = false;
        this.isActive = false;

        // Cleanup Phaser
        if (this.phaserGame) {
            this.phaserGame.destroy(true);
            this.phaserGame = null;
        }
        this.particleEmitters = [];
        this.cosmicScene = null;

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
    }
}

// Create singleton instance
export const introAnimation = new IntroAnimation();
