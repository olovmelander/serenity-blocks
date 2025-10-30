import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class SolarEclipseTheme extends BaseTheme {
    constructor() {
        super('solar-eclipse');
        this.eventUnsubscribers = [];
        this.coronaParticles = [];
        this.stars = [];
        this.animationFrame = null;
    }

    async createScene() {
        console.log('[SolarEclipse] Creating scene...');

        try {
            // Create background stars
            this.createStars();

            // Create corona particles using canvas
            this.createCoronaCanvas();

            // Create solar flares
            this.createSolarFlares();

            // Setup event listeners for reactive effects
            this.setupEventListeners();

            console.log('[SolarEclipse] Scene created successfully!');
        } catch (error) {
            console.error('[SolarEclipse] Error in createScene():', error);
            throw error;
        }
    }

    /**
     * Create background stars
     */
    createStars() {
        const starsContainer = document.getElementById('eclipse-stars');
        if (!starsContainer || starsContainer.children.length > 0) return;

        const fragment = document.createDocumentFragment();
        const starCount = 100;

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
        this.registerContainer(starsContainer);
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

        // Initialize corona particles
        const particleCount = 200;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        for (let i = 0; i < particleCount; i++) {
            const angle = this.random(0, Math.PI * 2);
            const distance = this.random(150, 280);
            const speed = this.random(0.002, 0.008);
            const size = this.random(1, 4);
            const opacity = this.random(0.3, 0.9);
            const hue = this.random(20, 60); // Orange to yellow range

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

        // Start animation
        this.animateCorona(canvas, ctx, centerX, centerY);
    }

    /**
     * Animate corona particles
     */
    animateCorona(canvas, ctx, centerX, centerY) {
        if (!this.isActive) return;

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
     * Create solar flares
     */
    createSolarFlares() {
        const flareContainer = document.getElementById('eclipse-flares');
        if (!flareContainer) return;

        // Create 6 major flares
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 6; i++) {
            const flare = document.createElement('div');
            flare.className = 'eclipse-flare';

            const angle = (i * 60) + this.random(-15, 15);
            const length = this.random(200, 400);
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
        this.registerContainer(flareContainer);
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
        const burstContainer = document.getElementById('eclipse-bursts');
        if (!burstContainer) return;

        const burstCount = Math.min(intensity, 4);

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
        const cmeContainer = document.getElementById('eclipse-cme');
        if (!cmeContainer) return;

        const cmeCount = Math.min(comboCount - 2, 3);

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

        // Clear particles
        this.coronaParticles = [];
        this.stars = [];

        // Clear any active effects
        const theme = document.getElementById('solar-eclipse-theme');
        if (theme) {
            theme.style.filter = '';
        }

        super.stop();
    }
}
