/**
 * @fileoverview Epic intro animation for SERENITY BLOCKS
 * Features cosmic particle effects, nebula clouds, stardust, 3D transforms, and galaxy colors
 * REMADE IN THREE.JS for true 3D visuals
 */

import ThreeJSIntroRenderer from './threejs-intro-renderer.js';

export class IntroAnimation {
    constructor() {
        this.container = null;
        this.isActive = false;
        this.isAnimating = false;
        this.hasCompleted = false;
        this.boundHandlers = {};
        this.soundManager = null;
        this.introMusicTrack = 'CosmicChimes';

        // Three.js Renderer
        this.threeCanvas = null;
        this.threeRenderer = null;
        this.animationFrameId = null;
    }

    /**
     * Initialize and show the intro animation
     * @returns {Promise<void>} Resolves when user dismisses the intro
     */
    async show(soundManager = null) {
        if (this.hasCompleted) {
            return Promise.resolve();
        }

        if (soundManager) {
            this.setSoundManager(soundManager);
        }

        this.ensureIntroMusic();

        this.isActive = true;
        this.isAnimating = true;
        this.createIntroHTML();
        this.setupEventListeners();

        // Start animation loop
        this.animate(performance.now() / 1000);

        this.startAnimations();

        // Return a promise that resolves when the intro is dismissed
        return new Promise((resolve) => {
            this.onComplete = resolve;
        });
    }

    /**
     * Animation loop for Three.js renderer
     */
    animate(time) {
        if (!this.isAnimating) return;

        // Pass time in seconds
        if (this.threeRenderer) {
            // Three.js uses seconds usually, but we can pass raw performance.now() / 1000
            // The renderer manages its own clock getDelta, etc., but might use `time` for global effects
            this.threeRenderer.update(time * 0.001);
        }

        this.animationFrameId = requestAnimationFrame(this.animate.bind(this));
    }

    /**
     * Set the shared sound manager used for intro music
     * @param {?Object} soundManager
     */
    setSoundManager(soundManager) {
        this.soundManager = soundManager;
    }

    /**
     * Ensure the intro music track is playing
     */
    ensureIntroMusic() {
        if (!this.soundManager) return;

        const trackKey = this.introMusicTrack;
        const hasTrackList = Array.isArray(this.soundManager.trackNames)
            && this.soundManager.trackNames.length > 0;

        if (hasTrackList && this.soundManager.trackNames.includes(trackKey)) {
            if (this.soundManager.musicTrack !== trackKey) {
                this.soundManager.setTrack(trackKey);
            } else if (typeof this.soundManager.isMusicPlaying === 'function'
                && !this.soundManager.isMusicPlaying()) {
                this.soundManager.startBackgroundMusic();
            }
            return;
        }

        if (typeof this.soundManager.isMusicPlaying === 'function'
            && this.soundManager.isMusicPlaying()) {
            return;
        }

        if (typeof this.soundManager.playAudioFile === 'function') {
            this.soundManager.musicTrack = trackKey;
            this.soundManager.playAudioFile('./assets/music/Cosmic Chimes.mp3');
        }
    }

    /**
     * Create the intro animation HTML structure
     */
    createIntroHTML() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'intro-animation';

        // Create WebGL canvas for Three.js (Background & core visuals)
        this.threeCanvas = document.createElement('canvas');
        this.threeCanvas.id = 'intro-webgl-canvas';
        this.threeCanvas.style.position = 'absolute';
        this.threeCanvas.style.top = '0';
        this.threeCanvas.style.left = '0';
        this.threeCanvas.style.width = '100%';
        this.threeCanvas.style.height = '100%';
        this.threeCanvas.style.zIndex = '0'; // Behind CSS overlays
        this.container.appendChild(this.threeCanvas);

        // Initialize Three.js renderer
        this.threeRenderer = new ThreeJSIntroRenderer(this.threeCanvas);
        if (this.threeRenderer.init()) {
            console.log('[IntroAnimation] Three.js renderer initialized');
        }

        // Create CSS particle background (optional extra layer, keeping for now as they look nice)
        const particles = this.createParticles();
        this.container.appendChild(particles);

        // Create floating orbs (keeping CSS orbs for extra depth/softness)
        const orbs = this.createOrbs();
        this.container.appendChild(orbs);

        // PERFORMANCE: Removed foreground particles - WebGL handles foreground particles

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
     * Create floating particle background with chromadelic colors (CSS layer)
     * @returns {HTMLElement}
     */
    createParticles() {
        const particlesContainer = document.createElement('div');
        particlesContainer.className = 'intro-particles';

        // Unified chromadelic color palette
        const colors = [
            'rgba(255, 51, 102, 0.75)', // Hot Pink
            'rgba(0, 255, 255, 0.75)',  // Cyan
            'rgba(153, 51, 255, 0.75)', // Purple
            'rgba(51, 153, 255, 0.75)', // Electric Blue
            'rgba(255, 0, 153, 0.7)',   // Magenta
            'rgba(0, 255, 102, 0.7)',   // Mint
            'rgba(255, 255, 0, 0.7)',   // Yellow
            'rgba(255, 102, 0, 0.7)',   // Orange
        ];

        // PERFORMANCE: Reduced particle count from 12 to 6 for cleaner look
        for (let i = 0; i < 6; i++) {
            const particle = document.createElement('div');
            particle.className = 'intro-particle';

            // Random size with some variation
            const size = Math.random() * 4 + 2;
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

            // Assign random color from palette
            const color = colors[Math.floor(Math.random() * colors.length)];
            particle.style.setProperty('--particle-color', color);

            particlesContainer.appendChild(particle);
        }

        return particlesContainer;
    }

    /**
     * Create floating orbs in background
     * @returns {HTMLElement}
     */
    createOrbs() {
        const orbsContainer = document.createElement('div');
        orbsContainer.className = 'intro-orbs';
        // Chromadelic orb configurations
        const orbConfigs = [
            {
                color: 'rgba(255, 51, 102, 0.25)', size: 320, x: '15%', y: '25%', floatX: 40, floatY: -25, delay: 0,
            },
            {
                color: 'rgba(153, 51, 255, 0.2)', size: 380, x: '75%', y: '65%', floatX: -50, floatY: 35, delay: 2,
            },
            {
                color: 'rgba(0, 255, 255, 0.2)', size: 280, x: '50%', y: '15%', floatX: 25, floatY: 40, delay: 3,
            },
            {
                color: 'rgba(51, 153, 255, 0.18)', size: 340, x: '25%', y: '75%', floatX: -35, floatY: -40, delay: 1,
            },
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
     * Create FOREGROUND particles for depth (High Z-Index, Blurred, Fast)
     * @returns {HTMLElement}
     */
    createForegroundParticles() {
        const container = document.createElement('div');
        container.className = 'intro-foreground-particles';
        container.style.position = 'absolute';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.pointerEvents = 'none'; // Click-through
        container.style.zIndex = '20'; // Above text
        container.style.overflow = 'hidden';

        // Chromadelic foreground palette
        const colors = [
            'rgba(255, 51, 102, 0.45)',  // Hot Pink
            'rgba(0, 255, 255, 0.45)',   // Cyan
            'rgba(153, 51, 255, 0.4)',   // Purple
            'rgba(51, 153, 255, 0.4)',   // Electric Blue
        ];

        // Minimal foreground particles
        for (let i = 0; i < 4; i++) {
            const p = document.createElement('div');

            // Smaller bokeh particles
            const size = Math.random() * 12 + 6; // 6px to 18px
            p.style.width = `${size}px`;
            p.style.height = `${size}px`;
            p.style.borderRadius = '50%';
            p.style.position = 'absolute';
            p.style.left = `${Math.random() * 100}%`;
            p.style.top = `${Math.random() * 120 - 10}%`; // Extend slightly offscreen vert

            // Stronger blur for softer bokeh
            p.style.filter = `blur(${Math.random() * 5 + 3}px)`;

            // Color with subtle glow
            p.style.background = colors[Math.floor(Math.random() * colors.length)];
            p.style.boxShadow = `0 0 12px ${p.style.background}`;

            // Faster animation for parallax (closer things move faster)
            const duration = Math.random() * 7 + 8; // 8-15s (vs 15-25s for bg)
            p.style.animation = `floatParticle ${duration}s infinite linear`;
            p.style.animationDelay = `-${Math.random() * 10}s`; // Start mid-animation

            // Larger drift
            const driftX = (Math.random() - 0.5) * 400; // Large horizontal movement
            p.style.setProperty('--drift', `${driftX}px`);

            container.appendChild(p);
        }

        return container;
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

        // Dismiss only the text, keep the background
        this.dismissText();
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
     * Create particle burst effect at position with vibrant colors (CSS)
     * PERFORMANCE: Reduced burst particles from 30 to 15
     */
    createBurstParticles(x, y) {
        const particleCount = 15;

        // Vibrant color palette for burst particles
        const burstColors = [
            '#64c8ff', // Cyan
            '#9333ea', // Purple
            '#3b82f6', // Blue
            '#ec4899', // Pink
            '#10b981', // Emerald
            '#8b5cf6', // Violet
            '#14b8a6', // Teal
            '#ff9900', // Orange
            '#ffff00', // Yellow
            '#00ffff', // Cyan
        ];

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

            // Assign random color
            const color = burstColors[i % burstColors.length];
            particle.style.backgroundColor = color;
            particle.style.boxShadow = `0 0 10px ${color}`;

            this.container.appendChild(particle);

            setTimeout(() => particle.remove(), 1000);
        }
    }

    /**
     * Start animation effects
     */
    startAnimations() {
        // All animations are CSS-based or managed by Three.js renderer
    }

    /**
     * Dismiss only the text elements (title and prompt) while keeping the background
     */
    dismissText() {
        if (!this.isActive) return;

        this.isActive = false;

        // Remove event listeners
        this.container.removeEventListener('click', this.boundHandlers.click);
        window.removeEventListener('keydown', this.boundHandlers.keydown);
        this.container.removeEventListener('touchstart', this.boundHandlers.touchstart);

        if (this.gamepadCheckInterval) {
            clearInterval(this.gamepadCheckInterval);
        }

        // Get text elements
        const titleContainer = this.container.querySelector('.intro-title-container');
        const prompt = this.container.querySelector('.intro-prompt');
        const chromatic = this.container.querySelector('.intro-chromatic');

        // Fade out prompt and chromatic effect
        if (prompt) prompt.classList.add('fade-out-text');
        if (chromatic) chromatic.classList.add('fade-out-text');

        // Transition title to top as logo
        if (titleContainer) {
            titleContainer.classList.add('shrink-to-logo');
        }

        // Lower the z-index so modal cards can appear on top
        if (this.container) {
            this.container.style.zIndex = '100';
            // Remove cursor pointer since we don't want clicks anymore
            this.container.style.cursor = 'default';
            this.container.style.pointerEvents = 'none';
        }

        // After animation completes, clean up and resolve
        setTimeout(() => {
            if (prompt) prompt.style.display = 'none';
            if (chromatic) chromatic.style.display = 'none';

            // Resolve the promise
            if (this.onComplete) {
                this.onComplete();
            }
        }, 1000);
    }

    /**
     * Dismiss the intro animation completely
     */
    dismiss() {
        // Allow dismissal even if not active anymore
        if (!this.container) return;

        this.isActive = false;
        this.isAnimating = false;
        this.hasCompleted = true;

        // Remove event listeners if still attached
        if (this.container) {
            this.container.removeEventListener('click', this.boundHandlers.click);
            this.container.removeEventListener('touchstart', this.boundHandlers.touchstart);
        }
        window.removeEventListener('keydown', this.boundHandlers.keydown);

        if (this.gamepadCheckInterval) {
            clearInterval(this.gamepadCheckInterval);
        }

        // Fade out
        if (this.container) {
            this.container.classList.add('fade-out');
        }

        // Remove from DOM after fade
        setTimeout(() => {
            // Cleanup Three.js
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            if (this.threeRenderer) {
                this.threeRenderer.destroy();
                this.threeRenderer = null;
            }

            if (this.container && this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
            this.container = null;

            // Resolve the promise if not already resolved
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

        // Cleanup Three.js
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.threeRenderer) {
            this.threeRenderer.destroy();
            this.threeRenderer = null;
        }

        this.hasCompleted = true;
        this.isAnimating = false;
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
        this.isAnimating = false;

        // Cleanup Three.js
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.threeRenderer) {
            this.threeRenderer.destroy();
            this.threeRenderer = null;
        }

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
    }

    /**
     * Show only the background animation with shrunken logo at top
     * (for returning to start modal from gameplay)
     */
    showBackgroundOnly(soundManager = null) {
        // If already showing, do nothing
        if (this.container && document.body.contains(this.container)) {
            return;
        }

        if (soundManager) {
            this.setSoundManager(soundManager);
        }

        this.ensureIntroMusic();
        this.isActive = false; // Not active for interaction
        this.isAnimating = true; // Keep animating
        this.hasCompleted = true; // Mark as completed so show() won't work

        // Create container
        this.container = document.createElement('div');
        this.container.id = 'intro-animation';
        this.container.classList.add('background-only'); // Add class for background-only mode
        this.container.style.zIndex = '100';
        this.container.style.pointerEvents = 'none';

        // Create WebGL canvas for Three.js
        this.threeCanvas = document.createElement('canvas');
        this.threeCanvas.id = 'intro-webgl-canvas';
        this.threeCanvas.style.position = 'absolute';
        this.threeCanvas.style.top = '0';
        this.threeCanvas.style.left = '0';
        this.threeCanvas.style.width = '100%';
        this.threeCanvas.style.height = '100%';
        this.threeCanvas.style.zIndex = '0'; // Behind everything
        this.container.appendChild(this.threeCanvas);

        // Initialize Three.js renderer
        this.threeRenderer = new ThreeJSIntroRenderer(this.threeCanvas);
        if (this.threeRenderer.init()) {
            console.log('[IntroAnimation] Three.js renderer initialized (Background Only)');
        }

        // Start animation loop
        this.animate(performance.now() / 1000);

        // Create CSS particles
        const particles = this.createParticles();
        this.container.appendChild(particles);

        // Create floating orbs
        const orbs = this.createOrbs();
        this.container.appendChild(orbs);

        // Create title container with shrunken logo
        const titleContainer = document.createElement('div');
        titleContainer.className = 'intro-title-container shrink-to-logo';

        // Create title with individual letters
        const title = this.createAnimatedTitle();
        titleContainer.appendChild(title);

        // Add shimmer effect
        const shimmer = document.createElement('div');
        shimmer.className = 'intro-shimmer';
        titleContainer.appendChild(shimmer);

        this.container.appendChild(titleContainer);

        // Add to DOM
        document.body.appendChild(this.container);

        // Trigger animations
        requestAnimationFrame(() => {
            this.container.classList.add('active');
        });
    }
}

// Create singleton instance
export const introAnimation = new IntroAnimation();
