import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SOLAR_ECLIPSE_TETROMINOS } from './solar-eclipse-tetrominos.js';

export default class SolarEclipseTheme extends BaseTheme {
    constructor() {
        super('solar-eclipse');
        this.eventUnsubscribers = [];
        this.coronaParticles = [];
        this.stars = [];
        this.animationFrame = null;
        this.driftTargets = [];

        // Shared drift state for smooth parallax
        this.driftAngle = 0;
        this.driftSpeed = 0.00001;
        this.driftRadiusX = 0;
        this.driftRadiusY = 0;
        this.driftX = 0;
        this.driftY = 0;
        this.lastDriftTime = 0;
        this.driftAngleSecondary = Math.random() * Math.PI * 2;
        this.driftSpeedSecondary = 0.000007;
        this.noiseCurrentX = 0;
        this.noiseCurrentY = 0;
        this.noiseTargetX = 0;
        this.noiseTargetY = 0;
        this.nextNoiseChange = 0;
        this.coronaCanvas = null;
        this.coronaCtx = null;
        this.coronaCenterX = 0;
        this.coronaCenterY = 0;
        this.qualityChangeHandler = null;
        this.starsContainer = null;
        this.flareContainer = null;
        this.cmeContainer = null;
        this.burstContainer = null;
        this.qualityPresets = {
            'Minimal': {
                starCount: 40,
                coronaParticles: 80,
                solarFlares: 3,
                cmeLimit: 1,
                burstLimit: 1,
                driftRadiusScale: 0.25,
            },
            'Low': {
                starCount: 60,
                coronaParticles: 120,
                solarFlares: 4,
                cmeLimit: 1,
                burstLimit: 2,
                driftRadiusScale: 0.35,
            },
            'Medium': {
                starCount: 100,
                coronaParticles: 200,
                solarFlares: 6,
                cmeLimit: 2,
                burstLimit: 3,
                driftRadiusScale: 0.5,
            },
            'High': {
                starCount: 140,
                coronaParticles: 260,
                solarFlares: 8,
                cmeLimit: 3,
                burstLimit: 4,
                driftRadiusScale: 0.65,
            },
            'Ultra': {
                starCount: 180,
                coronaParticles: 340,
                solarFlares: 10,
                cmeLimit: 4,
                burstLimit: 5,
                driftRadiusScale: 0.8,
            },
            'Extreme': {
                starCount: 250,
                coronaParticles: 480,
                solarFlares: 14,
                cmeLimit: 6,
                burstLimit: 7,
                driftRadiusScale: 1.0,
            }
        };
        this.currentQuality = 'Medium';
        this.activePreset = this.qualityPresets['Medium'];
    }

    applyQualityPreset(quality, { skipRefresh = false } = {}) {
        if (!this.qualityPresets[quality]) {
            console.warn(`Solar Eclipse: Unknown quality preset "${quality}", defaulting to Medium`);
            quality = 'Medium';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        if (!skipRefresh) {
            this.refreshQualityDependentElements();
        }

        console.log(`🌘 Solar Eclipse: Applying ${quality} quality preset`);
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'Medium';
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;

        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
        }

        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;

            this.applyQualityPreset(newQuality);
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    refreshQualityDependentElements() {
        this.createStars(true);
        this.createSolarFlares(true);
        if (this.coronaCanvas && this.coronaCtx) {
            this.driftRadiusX = Math.min(this.coronaCanvas.width, this.coronaCanvas.height) * (this.activePreset?.driftRadiusScale ?? 0.5);
            this.driftRadiusY = this.driftRadiusX * 0.65;
            this.initializeCoronaParticles(this.coronaCenterX, this.coronaCenterY);
        }
    }

    async createScene() {
        console.log('[SolarEclipse] Creating scene...');

        try {
            const quality = this.getGraphicsQuality();
            this.applyQualityPreset(quality, { skipRefresh: true });

            // Create background stars
            this.createStars(true);

            // Create corona particles using canvas
            this.createCoronaCanvas();

            // Create solar flares
            this.createSolarFlares(true);

            // Cache drift targets now that all static nodes exist
            this.cacheDriftTargets();
            this.seedInitialDriftPosition();

            // Setup event listeners for reactive effects
            this.setupEventListeners();

            this.setupQualityListener();

            console.log('[SolarEclipse] Scene created successfully!');
        } catch (error) {
            console.error('[SolarEclipse] Error in createScene():', error);
            throw error;
        }
    }

    /**
     * Create background stars
     */
    createStars(force = false) {
        if (!this.starsContainer) {
            this.starsContainer = document.getElementById('eclipse-stars');
            if (this.starsContainer) {
                this.registerContainer(this.starsContainer);
            }
        }
        const starsContainer = this.starsContainer;
        if (!starsContainer) return;
        if (!force && starsContainer.children.length > 0) return;

        starsContainer.textContent = '';

        const fragment = document.createDocumentFragment();
        const starCount = this.activePreset?.starCount ?? 100;
        this.stars = [];
        
        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'eclipse-star';
            const size = this.random(0.5, 1.5);
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${this.random(0, 100)}%`;
            star.style.top = `${this.random(0, 100)}%`;
            star.style.opacity = `${this.random(0.3, 0.9).toFixed(2)}`;
            star.style.animationDelay = `${this.random(0, 5)}s`;
            fragment.appendChild(star);
            this.stars.push(star);
        }

        starsContainer.appendChild(fragment);
    }

    /**
     * Create corona particles using canvas for better performance
     */
    createCoronaCanvas() {
        const canvas = document.getElementById('eclipse-corona-canvas');
        if (!canvas) {
            console.warn('[SolarEclipse] Corona canvas not found!');
            return;
        }

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const ctx = canvas.getContext('2d');
        this.coronaCanvas = canvas;
        this.coronaCtx = ctx;
        this.driftRadiusX = Math.min(canvas.width, canvas.height) * (this.activePreset?.driftRadiusScale ?? 0.5);
        this.driftRadiusY = this.driftRadiusX * 0.65;
        this.lastDriftTime = performance.now();

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        this.coronaCenterX = centerX;
        this.coronaCenterY = centerY;
        this.initializeCoronaParticles(centerX, centerY);

        // Start animation
        this.animateCorona(canvas, ctx, centerX, centerY);
    }

    initializeCoronaParticles(centerX = this.coronaCenterX, centerY = this.coronaCenterY) {
        this.coronaParticles = [];
        const particleCount = this.activePreset?.coronaParticles ?? 200;

        for (let i = 0; i < particleCount; i++) {
            const angle = this.random(0, Math.PI * 2);
            const distance = this.random(150, 280);
            const speed = this.random(0.002, 0.008);
            const size = this.random(1, 4);
            const opacity = this.random(0.3, 0.9);
            const hue = this.random(20, 60);

            this.coronaParticles.push({
                angle,
                distance,
                speed,
                size,
                opacity,
                baseOpacity: opacity,
                hue,
                pulse: this.random(0, Math.PI * 2),
                pulseSpeed: this.random(0.02, 0.05),
            });
        }
    }

    /**
     * Animate corona particles
     */
    animateCorona(canvas, ctx, centerX, centerY) {
        if (!this.isActive) return;

        const now = performance.now();
        if (!this.lastDriftTime) {
            this.lastDriftTime = now;
        }
        const deltaTime = now - this.lastDriftTime;
        this.lastDriftTime = now;
        this.updateDrift(deltaTime, now);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw particles
        this.coronaParticles.forEach(particle => {
            // Update particle position
            particle.angle += particle.speed;
            particle.pulse += particle.pulseSpeed;

            // Calculate position
            const x = centerX + Math.cos(particle.angle) * particle.distance;
            const y = centerY + Math.sin(particle.angle) * particle.distance;

            // Calculate pulsing opacity
            const pulseOpacity = particle.baseOpacity + Math.sin(particle.pulse) * 0.3;

            // Draw particle with glow
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, particle.size * 2);
            gradient.addColorStop(0, `hsla(${particle.hue}, 100%, 70%, ${pulseOpacity})`);
            gradient.addColorStop(0.5, `hsla(${particle.hue}, 100%, 60%, ${pulseOpacity * 0.5})`);
            gradient.addColorStop(1, `hsla(${particle.hue}, 100%, 50%, 0)`);

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, particle.size * 2, 0, Math.PI * 2);
            ctx.fill();
        });

        this.animationFrame = requestAnimationFrame(() =>
            this.animateCorona(canvas, ctx, centerX, centerY)
        );
    }

    /**
     * Cache DOM nodes that should follow the global drift
     */
    cacheDriftTargets() {
        const potentialTargets = [
            { node: document.getElementById('eclipse-stars'), multiplier: 1.25 },
            { node: document.querySelector('.eclipse-corona'), multiplier: 1 },
            { node: document.querySelector('.eclipse-sun'), multiplier: 1 },
            { node: document.querySelector('.eclipse-moon'), multiplier: 1 },
            { node: document.getElementById('eclipse-corona-canvas'), multiplier: 1 },
            { node: document.getElementById('eclipse-flares'), multiplier: 1 },
            { node: document.getElementById('eclipse-bursts'), multiplier: 1 },
            { node: document.getElementById('eclipse-cme'), multiplier: 1 }
        ];

        this.driftTargets = potentialTargets.filter(target => target.node);
    }

    /**
     * Randomize initial drift offsets so each activation starts unique
     */
    seedInitialDriftPosition() {
        const timestamp = performance.now();
        this.driftAngle = this.random(0, Math.PI * 2);
        this.driftAngleSecondary = this.random(0, Math.PI * 2);
        this.noiseCurrentX = this.random(-1, 1);
        this.noiseCurrentY = this.random(-1, 1);
        this.noiseTargetX = this.random(-1, 1);
        this.noiseTargetY = this.random(-1, 1);
        this.nextNoiseChange = timestamp + this.random(16000, 28000);
        this.updateDrift(0, timestamp);
    }

    /**
     * Update drift offsets for a slow unified motion
     */
    updateDrift(deltaTime = 16, timestamp = 0) {
        const primaryFactor = deltaTime * this.driftSpeed;
        const secondaryFactor = deltaTime * this.driftSpeedSecondary;
        this.driftAngle += primaryFactor;
        this.driftAngleSecondary += secondaryFactor;

        if (!timestamp) {
            timestamp = performance.now();
        }

        if (!this.nextNoiseChange || timestamp >= this.nextNoiseChange) {
            this.noiseTargetX = this.random(-1, 1);
            this.noiseTargetY = this.random(-1, 1);
            this.nextNoiseChange = timestamp + this.random(16000, 28000);
        }

        const smoothing = Math.min(deltaTime / 18000, 0.1);
        this.noiseCurrentX += (this.noiseTargetX - this.noiseCurrentX) * smoothing;
        this.noiseCurrentY += (this.noiseTargetY - this.noiseCurrentY) * smoothing;

        const baseX = Math.cos(this.driftAngle) * this.driftRadiusX;
        const secondaryX = Math.sin(this.driftAngleSecondary * 1.7) * this.driftRadiusX * 0.18;
        const noiseX = this.noiseCurrentX * this.driftRadiusX * 0.08;

        const baseY = Math.sin(this.driftAngle * 0.85) * this.driftRadiusY;
        const secondaryY = Math.cos(this.driftAngleSecondary * 1.2) * this.driftRadiusY * 0.22;
        const noiseY = this.noiseCurrentY * this.driftRadiusY * 0.1;

        this.driftX = baseX + secondaryX + noiseX;
        this.driftY = baseY + secondaryY + noiseY;
        this.updateDriftPositions();
    }

    /**
     * Apply drift offsets to all registered nodes
     */
    updateDriftPositions() {
        if (!this.driftTargets || this.driftTargets.length === 0) {
            this.cacheDriftTargets();
        }
        if (!this.driftTargets || this.driftTargets.length === 0) return;
        this.driftTargets.forEach(({ node, multiplier = 1 }) => {
            const translateValue = `${this.driftX * multiplier}px ${this.driftY * multiplier}px`;
            node.style.translate = translateValue;
        });
    }

    /**
     * Clear drift transforms when theme stops
     */
    resetDrift() {
        if (this.driftTargets) {
            this.driftTargets.forEach(({ node }) => {
                node.style.translate = '';
            });
        }
        this.driftTargets = [];
        this.driftAngle = 0;
        this.driftAngleSecondary = Math.random() * Math.PI * 2;
        this.driftX = 0;
        this.driftY = 0;
        this.noiseCurrentX = 0;
        this.noiseCurrentY = 0;
        this.noiseTargetX = 0;
        this.noiseTargetY = 0;
        this.nextNoiseChange = 0;
        this.lastDriftTime = 0;
    }

    /**
     * Create solar flares
     */
    createSolarFlares() {
        if (!this.flareContainer) {
            this.flareContainer = document.getElementById('eclipse-flares');
            if (this.flareContainer) {
                this.registerContainer(this.flareContainer);
            }
        }
        const flareContainer = this.flareContainer;
        if (!flareContainer) return;
        flareContainer.textContent = '';

        // Create scalable number of flares
        const fragment = document.createDocumentFragment();
        const flareCount = this.activePreset?.solarFlares ?? 6;
        for (let i = 0; i < flareCount; i++) {
            const flare = document.createElement('div');
            flare.className = 'eclipse-flare';

            const angle = (i * 60) + this.random(-15, 15);
            const length = this.random(260, 480);
            const width = this.random(80, 150);
            const duration = this.random(4, 8);

            flare.style.setProperty('--flare-angle', `${angle}deg`);
            flare.style.setProperty('--flare-length', `${length}px`);
            flare.style.setProperty('--flare-width', `${width}px`);
            flare.style.setProperty('--flare-duration', `${duration}s`);
            flare.style.animationDelay = `${this.random(0, 3)}s`;

            fragment.appendChild(flare);
        }

        flareContainer.appendChild(fragment);
    }

    /**
     * Setup event listeners for reactive effects
     */
    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data.piece);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    /**
     * React to line clears
     */
    onLineClear(lineCount) {
        console.log('[SolarEclipse] Line clear:', lineCount);

        // Brighten corona
        this.brightenCorona(lineCount);

        // Create solar bursts
        this.createSolarBurst(lineCount);

        // Brighten stars
        this.brightenStars(lineCount);
    }

    /**
     * React to combos
     */
    onCombo(comboCount) {
        console.log('[SolarEclipse] Combo:', comboCount);

        // Intensify eclipse
        this.intensifyEclipse(comboCount);

        // Create coronal mass ejection for big combos
        if (comboCount >= 3) {
            this.createCoronalMassEjection(comboCount);
        }
    }

    /**
     * React to piece locks
     */
    onPieceLock(piece) {
        // Subtle particle pulse
        if (Math.random() < 0.3) {
            this.pulseCoronaParticles();
        }
    }

    /**
     * Brighten corona on line clear
     */
    brightenCorona(intensity) {
        const corona = document.querySelector('.eclipse-corona');
        if (!corona) return;

        const originalFilter = corona.style.filter;
        corona.style.transition = 'filter 0.3s ease-out';
        corona.style.filter = `brightness(${1 + intensity * 0.3}) saturate(${100 + intensity * 20}%)`;

        setTimeout(() => {
            corona.style.filter = originalFilter;
        }, 300);
    }

    /**
     * Create solar burst effect
     */
    createSolarBurst(intensity) {
        if (!this.burstContainer) {
            this.burstContainer = document.getElementById('eclipse-bursts');
        }
        const burstContainer = this.burstContainer;
        if (!burstContainer) return;

        const burstLimit = this.activePreset?.burstLimit ?? 4;
        const burstCount = Math.min(intensity, burstLimit);

        for (let i = 0; i < burstCount; i++) {
            setTimeout(() => {
                const burst = document.createElement('div');
                burst.className = 'eclipse-burst';

                const angle = this.random(0, 360);
                const duration = 1 + this.random(0, 0.5);

                burst.style.setProperty('--burst-angle', `${angle}deg`);
                burst.style.animationDuration = `${duration}s`;

                burstContainer.appendChild(burst);

                setTimeout(() => {
                    if (burst.parentNode) {
                        burst.parentNode.removeChild(burst);
                    }
                }, duration * 1000);
            }, i * 150);
        }
    }

    /**
     * Brighten stars
     */
    brightenStars(intensity) {
        const starsToBrighten = Math.min(Math.floor(intensity * 8), this.stars.length);

        for (let i = 0; i < starsToBrighten; i++) {
            const star = this.stars[Math.floor(Math.random() * this.stars.length)];
            if (star) {
                const originalOpacity = star.style.opacity;
                star.style.transition = 'opacity 0.3s ease-out';
                star.style.opacity = '1';

                setTimeout(() => {
                    star.style.opacity = originalOpacity;
                }, 300 + Math.random() * 200);
            }
        }
    }

    /**
     * Intensify eclipse
     */
    intensifyEclipse(comboCount) {
        const theme = document.getElementById('solar-eclipse-theme');
        if (!theme) return;

        const brightness = 100 + Math.min(comboCount * 15, 60);
        const saturation = 100 + Math.min(comboCount * 20, 80);

        theme.style.filter = `brightness(${brightness}%) saturate(${saturation}%)`;

        setTimeout(() => {
            theme.style.filter = '';
        }, 1000 + comboCount * 100);
    }

    /**
     * Create coronal mass ejection effect
     */
    createCoronalMassEjection(comboCount) {
        if (!this.cmeContainer) {
            this.cmeContainer = document.getElementById('eclipse-cme');
        }
        const cmeContainer = this.cmeContainer;
        if (!cmeContainer) return;

        const cmeLimit = this.activePreset?.cmeLimit ?? 3;
        const cmeCount = Math.min(comboCount - 2, cmeLimit);

        for (let i = 0; i < cmeCount; i++) {
            setTimeout(() => {
                const cme = document.createElement('div');
                cme.className = 'eclipse-cme';

                const angle = this.random(0, 360);
                const duration = 2 + this.random(0, 1);

                cme.style.setProperty('--cme-angle', `${angle}deg`);
                cme.style.animationDuration = `${duration}s`;

                cmeContainer.appendChild(cme);

                setTimeout(() => {
                    if (cme.parentNode) {
                        cme.parentNode.removeChild(cme);
                    }
                }, duration * 1000);
            }, i * 400);
        }
    }

    /**
     * Pulse corona particles
     */
    pulseCoronaParticles() {
        this.coronaParticles.forEach(particle => {
            particle.baseOpacity = Math.min(particle.baseOpacity * 1.5, 1);

            setTimeout(() => {
                particle.baseOpacity = particle.opacity;
            }, 300);
        });
    }

    stop() {
        // Cancel animation frame
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        // Clear particles
        this.coronaParticles = [];
        this.stars = [];

        // Clear any active effects
        const theme = document.getElementById('solar-eclipse-theme');
        if (theme) {
            theme.style.filter = '';
        }

        this.resetDrift();

        super.stop();
    }

    /**
     * Provide Solar Eclipse themed tetromino styling (corona glow palette)
     * @returns {Object} Solar Eclipse tetromino configuration
     */
    getTetrominoConfig() {
        return SOLAR_ECLIPSE_TETROMINOS;
    }
}
