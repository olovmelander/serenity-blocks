/**
 * @fileoverview Epic intro animation for SERENITY BLOCKS
 * Features cosmic particle effects, nebula clouds, stardust, 3D transforms, and galaxy colors
 * Uses WebGPU renderer with TSL shaders when available, falls back to WebGL
 */

import { INTRO_PHASES } from './intro-visual-config.js';
import { performanceMonitor } from '../utils/performance-monitor.js';

export class IntroAnimation {
    constructor() {
        this.container = null;
        this.isActive = false;
        this.isAnimating = false;
        this.hasCompleted = false;
        this.boundHandlers = {};
        this.soundManager = null;
        this.introMusicTrack = 'CosmicChimes';
        this.isLoadingMasked = false;
        this.loadingIndicator = null;
        this.loadingPromise = null;
        this.loadingPromiseLabel = 'LOADING ASSETS';
        this.smoothedAudioPulse = 0;
        this.dismissPromise = null;

        // Three.js Renderer
        this.threeCanvas = null;
        this.threeRenderer = null;
        this.animationFrameId = null;
        this.boundAnimate = this.animate.bind(this);
        this.phaseTimers = [];
        this.lastTitleBoundsSync = 0;
        this.currentPhase = INTRO_PHASES.BOOT;
        this.menuBgReady = false;
        const params = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search)
            : new URLSearchParams();
        this.flags = {
            // Keep v2 on by default for active development, allow explicit opt-out.
            introV2: params.get('introV2') !== '0',
        };
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

        this.menuBgReady = false;
        this.clearPhaseTimers();
        this.isActive = true;
        this.isAnimating = true;
        await this.createIntroHTML();
        this.setupEventListeners();

        this.setRendererPhase(INTRO_PHASES.BOOT, true);
        this.schedulePhase(INTRO_PHASES.REVEAL, 220);
        this.schedulePhase(INTRO_PHASES.IDLE, 1900);

        // Start animation loop
        this.startRenderLoop();

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
        if (!this.isAnimating) {
            this.animationFrameId = null;
            return;
        }

        // Pass time in seconds
        if (this.threeRenderer) {
            const pulse = this.getMusicPulse();
            this.threeRenderer.setAudioPulse?.(pulse);
            this.threeRenderer.update();
            if (this.isActive) {
                this.syncTitleBounds(time);
            }
        }

        this.animationFrameId = requestAnimationFrame(this.boundAnimate);
    }

    startRenderLoop() {
        if (this.animationFrameId !== null) return;
        this.animationFrameId = requestAnimationFrame(this.boundAnimate);
    }

    emitPhaseChanged(phase) {
        this.currentPhase = phase;
        window.dispatchEvent(new CustomEvent('intro:phaseChanged', {
            detail: { phase },
        }));
    }

    setRendererPhase(phase, immediate = false) {
        this.threeRenderer?.setPhase?.(phase, immediate);
        this.emitPhaseChanged(phase);

        if (phase === INTRO_PHASES.MENU_BG) {
            this.menuBgReady = true;
            window.dispatchEvent(new CustomEvent('intro:menuBgReady', {
                detail: { phase },
            }));
        }
    }

    clearPhaseTimers() {
        this.phaseTimers.forEach((timerId) => clearTimeout(timerId));
        this.phaseTimers.length = 0;
    }

    schedulePhase(phase, delayMs) {
        const timerId = setTimeout(() => {
            this.setRendererPhase(phase);
        }, delayMs);
        this.phaseTimers.push(timerId);
    }

    syncTitleBounds(timeMs = performance.now()) {
        if (!this.threeRenderer?.setTitleBounds || !this.container) return;
        if (timeMs - this.lastTitleBoundsSync < 120) return;

        const titleContainer = this.container.querySelector('.intro-title-container');
        if (!titleContainer) return;
        const rect = titleContainer.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        this.threeRenderer.setTitleBounds({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
        });
        this.lastTitleBoundsSync = timeMs;
    }

    waitForMenuBgReady(timeoutMs = 2200) {
        if (this.menuBgReady) return Promise.resolve();

        return new Promise((resolve) => {
            let settled = false;
            let timerId = null;
            const done = () => {
                if (settled) return;
                settled = true;
                if (timerId !== null) clearTimeout(timerId);
                resolve();
            };
            const onReady = () => done();
            timerId = setTimeout(() => {
                window.removeEventListener('intro:menuBgReady', onReady);
                done();
            }, timeoutMs);
            window.addEventListener('intro:menuBgReady', onReady, { once: true });
        });
    }

    /**
     * Derive a simple beat pulse from current music playback time.
     * Returns a stable 0..1 envelope that can drive visual accents.
     */
    getMusicPulse() {
        const audioEl = this.soundManager?.audioElement;
        if (!audioEl || audioEl.paused || audioEl.ended) return 0;

        if (this.soundManager?.hasAudioAnalyzer?.() && this.soundManager?.getAudioAnalysis) {
            const analysis = this.soundManager.getAudioAnalysis(1 / 60);
            const weightedEnergy = (analysis.bassEnergy * 0.6)
                + (analysis.midEnergy * 0.25)
                + (analysis.trebleEnergy * 0.15);
            this.smoothedAudioPulse = this.smoothedAudioPulse * 0.78 + weightedEnergy * 0.22;
            const beatBoost = analysis.beatDetected ? 0.18 : 0;
            return Math.min(1, this.smoothedAudioPulse * 1.6 + beatBoost);
        }

        const t = audioEl.currentTime;
        const primary = Math.max(0, Math.sin(t * Math.PI * 2 * 1.85));
        const secondary = Math.max(0, Math.sin(t * Math.PI * 2 * 3.7));
        return Math.min(1, primary * 0.7 + secondary * 0.3);
    }

    setLoadingPromise(promise, label = 'LOADING ASSETS') {
        if (!promise || typeof promise.then !== 'function') {
            this.loadingPromise = null;
            return;
        }
        this.loadingPromiseLabel = label;
        this.loadingPromise = Promise.resolve(promise)
            .catch((error) => {
                console.error('[IntroAnimation] Loading promise failed:', error);
            })
            .finally(() => {
                this.loadingPromise = null;
            });
    }

    async waitForLoadingPromise() {
        if (!this.loadingPromise) return;
        await this.loadingPromise;
    }

    /**
     * Initialize the 3D renderer. Tries WebGPU first, falls back to WebGL.
     */
    async initRenderer(canvas) {
        const initStartedAt = typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now();
        const hasWebGPU = typeof navigator !== 'undefined' && Boolean(navigator.gpu);
        performanceMonitor.recordEvent('startup_intro_renderer_init_started', {
            introV2: this.flags.introV2,
            hasWebGPU,
        });

        // Keep a fallback path for rollout / regression checks.
        if (this.flags.introV2 && hasWebGPU) {
            try {
                const { default: WebGPURenderer } = await import('./threejs-intro-renderer-webgpu.js');
                const webgpuRenderer = new WebGPURenderer(canvas);
                const success = await webgpuRenderer.init();
                if (success) {
                    this.threeRenderer = webgpuRenderer;
                    this.isWebGPU = true;
                    this.threeRenderer.setVisualProfile?.('cinematic_clean');
                    performanceMonitor.recordEvent('startup_intro_renderer_init_completed', {
                        backend: 'webgpu',
                        durationMs: (typeof performance !== 'undefined' && performance.now
                            ? performance.now()
                            : Date.now()) - initStartedAt,
                    });
                    console.log('[IntroAnimation] WebGPU renderer initialized');
                    return;
                }
                // WebGPU init returned false, fall through to WebGL
                webgpuRenderer.destroy?.();
            } catch (err) {
                console.warn('[IntroAnimation] WebGPU init failed, falling back to WebGL:', err);
            }
        }

        // Fallback: WebGL renderer
        const { default: ThreeJSIntroRenderer } = await import('./threejs-intro-renderer.js');
        this.threeRenderer = new ThreeJSIntroRenderer(canvas);
        if (this.threeRenderer.init()) {
            this.isWebGPU = false;
            performanceMonitor.recordEvent('startup_intro_renderer_init_completed', {
                backend: 'webgl',
                durationMs: (typeof performance !== 'undefined' && performance.now
                    ? performance.now()
                    : Date.now()) - initStartedAt,
            });
            console.log('[IntroAnimation] WebGL renderer initialized (fallback)');
        } else {
            performanceMonitor.recordEvent('startup_intro_renderer_init_completed', {
                backend: 'failed',
                durationMs: (typeof performance !== 'undefined' && performance.now
                    ? performance.now()
                    : Date.now()) - initStartedAt,
            });
        }
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
    async createIntroHTML() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'intro-animation';

        // Create canvas for Three.js (Background & core visuals)
        this.threeCanvas = document.createElement('canvas');
        this.threeCanvas.id = 'intro-webgl-canvas';
        this.threeCanvas.style.position = 'absolute';
        this.threeCanvas.style.top = '0';
        this.threeCanvas.style.left = '0';
        this.threeCanvas.style.width = '100%';
        this.threeCanvas.style.height = '100%';
        this.threeCanvas.style.zIndex = '0'; // Behind CSS overlays
        this.container.appendChild(this.threeCanvas);

        // Initialize renderer: try WebGPU first, fall back to WebGL
        await this.initRenderer(this.threeCanvas);
        this.setLoadingState(false);

        // Phase 5: CSS particles/orbs removed; visuals are now GPU-native in both WebGPU and WebGL paths.
        this.threeRenderer.setBackgroundMode?.(false);

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

        // Warp overlay for dismiss transition polish
        const warpOverlay = document.createElement('div');
        warpOverlay.className = 'intro-warp-overlay';
        this.container.appendChild(warpOverlay);

        // Create prompt text
        const prompt = document.createElement('div');
        prompt.className = 'intro-prompt';
        prompt.innerHTML = 'PRESS ANY KEY / CLICK / TAP TO BEGIN';
        this.container.appendChild(prompt);

        // Loading mask indicator (Phase 7 loading integration)
        this.loadingIndicator = document.createElement('div');
        this.loadingIndicator.className = 'intro-loading-indicator';
        this.loadingIndicator.textContent = 'LOADING ASSETS';
        this.loadingIndicator.style.display = 'none';
        this.container.appendChild(this.loadingIndicator);

        // Add to body
        document.body.appendChild(this.container);
        this.syncTitleBounds(performance.now());
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
     * Setup event listeners for user input
     */
    setupEventListeners() {
        // Mouse click
        this.boundHandlers.click = () => this.handleInteraction();
        this.container.addEventListener('click', this.boundHandlers.click);

        // Keyboard
        this.boundHandlers.keydown = () => this.handleInteraction();
        window.addEventListener('keydown', this.boundHandlers.keydown);

        // Touch
        this.boundHandlers.touchstart = () => this.handleInteraction();
        this.container.addEventListener('touchstart', this.boundHandlers.touchstart, { passive: true });

        // Optional external loading mask hook:
        // window.dispatchEvent(new CustomEvent('intro-loading-state', { detail: { loading: true, label: '...' } }))
        this.boundHandlers.loadingState = (event) => {
            const detail = event?.detail || {};
            this.setLoadingState(Boolean(detail.loading), detail.label);
        };
        window.addEventListener('intro-loading-state', this.boundHandlers.loadingState);

        // Gamepad (check for button press)
        this.gamepadCheckInterval = setInterval(() => {
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            for (let i = 0; i < gamepads.length; i++) {
                const gp = gamepads[i];
                if (gp) {
                    // Check if any button is pressed
                    for (let j = 0; j < gp.buttons.length; j++) {
                        if (gp.buttons[j].pressed) {
                            this.handleInteraction();
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
    handleInteraction() {
        if (!this.isActive) return;

        // Dismiss only the text, keep the background
        const prompt = this.container?.querySelector('.intro-prompt');
        if (prompt) {
            prompt.remove();
        }
        if (this.loadingIndicator) {
            this.loadingIndicator.remove();
            this.loadingIndicator = null;
        }

        this.threeRenderer?.startWarpDismiss?.(1.2);
        this.setRendererPhase(INTRO_PHASES.DISMISS);
        this.setLoadingState(false);
        this.dismissText();
    }

    setLoadingState(isLoading, label = 'LOADING ASSETS') {
        this.isLoadingMasked = Boolean(isLoading);
        if (!this.loadingIndicator) return;

        if (this.isLoadingMasked) {
            this.loadingIndicator.textContent = label;
            this.loadingIndicator.style.display = '';
            this.loadingIndicator.classList.add('visible');
        } else {
            this.loadingIndicator.classList.remove('visible');
            this.loadingIndicator.style.display = 'none';
        }
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

        this.clearPhaseTimers();
        this.isActive = false;

        // Remove event listeners
        this.container.removeEventListener('click', this.boundHandlers.click);
        window.removeEventListener('keydown', this.boundHandlers.keydown);
        this.container.removeEventListener('touchstart', this.boundHandlers.touchstart);
        window.removeEventListener('intro-loading-state', this.boundHandlers.loadingState);

        if (this.gamepadCheckInterval) {
            clearInterval(this.gamepadCheckInterval);
        }

        // Get text elements
        const titleContainer = this.container.querySelector('.intro-title-container');
        const prompt = this.container.querySelector('.intro-prompt');
        const chromatic = this.container.querySelector('.intro-chromatic');

        // Hide bottom prompt immediately to avoid residual glow smear on dismiss.
        if (prompt) prompt.style.display = 'none';
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

        this.threeRenderer?.setBackgroundMode?.(true);
        this.setRendererPhase(INTRO_PHASES.DISMISS);

        // Signal completion near the midpoint of the warp to mask theme loading hitch.
        if (this.onComplete) {
            const handoverPromise = new Promise(resolve => setTimeout(resolve, 380));
            handoverPromise.then(() => {
                if (this.onComplete) {
                    this.onComplete();
                    this.onComplete = null;
                }
            });
        }

        // After the warp transition reaches a stable point, switch to MENU_BG loop.
        setTimeout(async () => {
            if (prompt) prompt.style.display = 'none';
            if (chromatic) chromatic.style.display = 'none';

            await this.waitForLoadingPromise();
            this.setRendererPhase(INTRO_PHASES.MENU_BG);
        }, 850);
    }

    /**
     * Dismiss the intro animation completely
     */
    dismiss() {
        if (this.dismissPromise) {
            return this.dismissPromise;
        }

        // Allow dismissal even if not active anymore
        if (!this.container) {
            return Promise.resolve();
        }

        this.clearPhaseTimers();
        this.isActive = false;
        this.isAnimating = false;
        this.hasCompleted = true;

        // Remove event listeners if still attached
        if (this.container) {
            this.container.removeEventListener('click', this.boundHandlers.click);
            this.container.removeEventListener('touchstart', this.boundHandlers.touchstart);
        }
        window.removeEventListener('keydown', this.boundHandlers.keydown);
        window.removeEventListener('intro-loading-state', this.boundHandlers.loadingState);

        if (this.gamepadCheckInterval) {
            clearInterval(this.gamepadCheckInterval);
        }

        // Fade out
        if (this.container) {
            this.container.classList.add('fade-out');
        }

        this.dismissPromise = new Promise((resolve) => {
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
                this.loadingIndicator = null;
                this.loadingPromise = null;
                this.smoothedAudioPulse = 0;

                // Resolve the promise if not already resolved
                if (this.onComplete) {
                    this.onComplete();
                    this.onComplete = null;
                }

                this.dismissPromise = null;
                resolve();
            }, 1000);
        });

        return this.dismissPromise;
    }

    /**
     * Skip the intro animation (for development/testing)
     */
    skip() {
        this.clearPhaseTimers();
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
        this.dismissPromise = null;
        if (this.onComplete) {
            this.onComplete();
            this.onComplete = null;
        }
    }

    /**
     * Reset the intro animation (for replay)
     */
    reset() {
        this.clearPhaseTimers();
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
        this.loadingIndicator = null;
        this.loadingPromise = null;
        this.smoothedAudioPulse = 0;
        this.dismissPromise = null;
    }

    /**
     * Show only the background animation with shrunken logo at top
     * (for returning to start modal from gameplay)
     */
    async showBackgroundOnly(soundManager = null) {
        // If already showing, check if it's hidden and revive it
        if (this.container && document.body.contains(this.container)) {
            if (this.container.style.display === 'none') {
                console.log('[IntroAnimation] Reviving hidden container');
                this.container.style.removeProperty('display');
                this.container.style.display = '';

                // Ensure correct state for background only
                this.container.classList.add('background-only');
                this.container.classList.remove('warp-dismiss');
                this.container.style.zIndex = '100';
                this.container.style.pointerEvents = 'none';

                const titleContainer = this.container.querySelector('.intro-title-container');
                if (titleContainer) {
                    titleContainer.classList.add('shrink-to-logo');
                }

                // Hide prompt/chromatic if they exist (cleanup from full intro)
                const prompt = this.container.querySelector('.intro-prompt');
                if (prompt) prompt.style.display = 'none';
                const chromatic = this.container.querySelector('.intro-chromatic');
                if (chromatic) chromatic.style.display = 'none';
                this.setLoadingState(false);

                // Ensure music
                this.ensureIntroMusic();
                this.isAnimating = true;
                this.threeRenderer?.setBackgroundMode?.(true);
                this.setRendererPhase(INTRO_PHASES.MENU_BG, true);
                this.startRenderLoop();
            }
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

        // Initialize renderer (WebGPU with WebGL fallback)
        await this.initRenderer(this.threeCanvas);
        this.threeRenderer?.setBackgroundMode?.(true);
        this.setRendererPhase(INTRO_PHASES.MENU_BG, true);

        // Start animation loop
        this.startRenderLoop();

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

        const warpOverlay = document.createElement('div');
        warpOverlay.className = 'intro-warp-overlay';
        this.container.appendChild(warpOverlay);

        this.loadingIndicator = document.createElement('div');
        this.loadingIndicator.className = 'intro-loading-indicator';
        this.loadingIndicator.textContent = 'LOADING ASSETS';
        this.loadingIndicator.style.display = 'none';
        this.container.appendChild(this.loadingIndicator);
        this.setLoadingState(false);

        // Add to DOM
        document.body.appendChild(this.container);
        this.syncTitleBounds(performance.now());

        // Trigger animations
        requestAnimationFrame(() => {
            this.container.classList.add('active');
        });
    }
}

// Create singleton instance
export const introAnimation = new IntroAnimation();
