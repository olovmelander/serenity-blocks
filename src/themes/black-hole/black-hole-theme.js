import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class BlackHoleTheme extends BaseTheme {
    constructor() {
        super('black-hole');
        this.eventUnsubscribers = [];
        this.stars = [];
        this.animationFrame = null;
        this.canvas = null;
        this.ctx = null;
        this.particles = [];
    }

    async createScene() {
        console.log('[BlackHole] Creating scene...');

        try {
            // Create star field
            this.createStarField();

            // Create animated stardust particles
            this.createStardustCanvas();

            // Setup event listeners
            this.setupEventListeners();

            console.log('[BlackHole] Scene created successfully!');
        } catch (error) {
            console.error('[BlackHole] Error in createScene():', error);
            throw error;
        }
    }

    /**
     * Create multi-colored star field
     */
    createStarField() {
        const starsContainer = document.getElementById('stellar-stars');
        if (!starsContainer || starsContainer.children.length > 0) return;

        const fragment = document.createDocumentFragment();
        const starCount = 300;

        // Define star color palette based on the nebula image
        const starColors = [
            { color: 'rgba(255, 255, 255, 1)', weight: 35 },      // White
            { color: 'rgba(180, 220, 255, 1)', weight: 15 },      // Cyan-white
            { color: 'rgba(255, 240, 180, 1)', weight: 12 },      // Yellow-white
            { color: 'rgba(255, 200, 140, 1)', weight: 10 },      // Orange
            { color: 'rgba(150, 200, 255, 1)', weight: 10 },      // Blue
            { color: 'rgba(255, 180, 220, 1)', weight: 8 },       // Pink
            { color: 'rgba(200, 180, 255, 1)', weight: 5 },       // Purple
            { color: 'rgba(255, 150, 100, 1)', weight: 3 },       // Red-orange
            { color: 'rgba(100, 220, 255, 1)', weight: 2 },       // Bright cyan
        ];

        const getRandomStarColor = () => {
            const rand = Math.random() * 100;
            let cumulative = 0;
            for (const colorOption of starColors) {
                cumulative += colorOption.weight;
                if (rand <= cumulative) {
                    return colorOption.color;
                }
            }
            return starColors[0].color;
        };

        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'stellar-star';

            const size = this.random(0.5, 3);
            const isBright = Math.random() < 0.1; // 10% chance of bright star

            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${this.random(0, 100)}%`;
            star.style.top = `${this.random(0, 100)}%`;
            star.style.backgroundColor = getRandomStarColor();
            star.style.opacity = `${this.random(0.5, 1).toFixed(2)}`;
            star.style.animationDelay = `${this.random(0, 8)}s`;

            if (isBright) {
                star.classList.add('stellar-star-bright');
                star.style.boxShadow = `0 0 ${size * 2}px ${star.style.backgroundColor}`;
            }

            fragment.appendChild(star);
            this.stars.push(star);
        }

        starsContainer.appendChild(fragment);
        this.registerContainer(starsContainer);
    }

    /**
     * Create animated stardust particles with black hole gravity
     */
    createStardustCanvas() {
        this.canvas = document.getElementById('stellar-stardust-canvas');
        if (!this.canvas) {
            console.warn('[BlackHole] Stardust canvas not found!');
            return;
        }

        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.ctx = this.canvas.getContext('2d');

        // Black hole position (35% from left, centered vertically)
        this.blackHoleX = this.canvas.width * 0.35;
        this.blackHoleY = this.canvas.height * 0.5;
        this.blackHolePullRadius = 400; // Gravitational influence radius
        this.blackHolePullStrength = 0.5; // Strength of the pull

        // Create stardust particles being pulled into black hole
        const particleCount = 250; // Increased for more dramatic effect
        for (let i = 0; i < particleCount; i++) {
            this.particles.push({
                x: this.random(0, this.canvas.width),
                y: this.random(0, this.canvas.height),
                size: this.random(0.5, 2.5),
                speedX: this.random(-0.5, 0.5),
                speedY: this.random(-0.5, 0.5),
                opacity: this.random(0.4, 0.9),
                color: this.getNebulaColor(),
                pulse: this.random(0, Math.PI * 2),
                pulseSpeed: this.random(0.01, 0.03),
                orbitAngle: this.random(0, Math.PI * 2), // For orbital motion
                orbitSpeed: this.random(0.005, 0.02), // Orbital velocity
            });
        }

        // Start animation
        this.animateStardust();
    }

    /**
     * Get random nebula color
     */
    getNebulaColor() {
        const colors = [
            { r: 255, g: 100, b: 180 },  // Magenta
            { r: 80, g: 180, b: 255 },   // Cyan
            { r: 255, g: 150, b: 80 },   // Orange
            { r: 180, g: 100, b: 255 },  // Purple
            { r: 100, g: 220, b: 255 },  // Bright cyan
            { r: 255, g: 120, b: 200 },  // Hot pink
            { r: 200, g: 130, b: 255 },  // Violet
            { r: 255, g: 170, b: 100 },  // Coral
            { r: 140, g: 230, b: 255 },  // Aqua
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    /**
     * Animate stardust particles with black hole gravity
     */
    animateStardust() {
        if (!this.isActive || !this.ctx) return;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Filter out dead particles and update living ones
        this.particles = this.particles.filter((particle, index) => {
            // Handle lifetime for temporary particles
            if (particle.lifetime !== undefined) {
                particle.lifetime--;
                if (particle.lifetime <= 0) {
                    return false; // Remove particle
                }
                // Fade out particles as they approach end of life
                if (particle.lifetime < 30) {
                    particle.opacity *= 0.95;
                }
            }

            // Calculate distance to black hole
            const dx = this.blackHoleX - particle.x;
            const dy = this.blackHoleY - particle.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Apply gravitational pull if within radius
            if (distance < this.blackHolePullRadius && distance > 5) {
                // Calculate gravitational force (stronger when closer)
                const force = (this.blackHolePullStrength * (this.blackHolePullRadius - distance)) / this.blackHolePullRadius;

                // Normalize direction vector
                const dirX = dx / distance;
                const dirY = dy / distance;

                // Apply gravitational acceleration
                particle.speedX += dirX * force * 0.1;
                particle.speedY += dirY * force * 0.1;

                // Initialize orbital properties if missing
                if (particle.orbitAngle === undefined) {
                    particle.orbitAngle = Math.atan2(dy, dx);
                    particle.orbitSpeed = this.random(0.01, 0.03);
                }

                // Add orbital motion (tangential velocity)
                particle.orbitAngle += particle.orbitSpeed * (1 + force);
                const tangentX = -dirY; // Perpendicular to radial direction
                const tangentY = dirX;
                particle.speedX += tangentX * particle.orbitSpeed * 2;
                particle.speedY += tangentY * particle.orbitSpeed * 2;

                // Damping to prevent infinite acceleration
                particle.speedX *= 0.98;
                particle.speedY *= 0.98;

                // Increase opacity and size as particle gets closer (only for permanent particles)
                if (particle.lifetime === undefined) {
                    const proximityFactor = 1 - (distance / this.blackHolePullRadius);
                    particle.opacity = Math.min(0.9, particle.opacity * (1 + proximityFactor * 0.1));
                }
            }

            // Update position
            particle.x += particle.speedX;
            particle.y += particle.speedY;

            // Check if particle reached event horizon
            if (distance < 60) {
                // If it's a temporary particle, remove it
                if (particle.lifetime !== undefined) {
                    return false;
                }

                // Otherwise respawn permanent particle at random edge
                const edge = Math.floor(Math.random() * 4);
                if (edge === 0) { // Top
                    particle.x = this.random(0, this.canvas.width);
                    particle.y = 0;
                } else if (edge === 1) { // Right
                    particle.x = this.canvas.width;
                    particle.y = this.random(0, this.canvas.height);
                } else if (edge === 2) { // Bottom
                    particle.x = this.random(0, this.canvas.width);
                    particle.y = this.canvas.height;
                } else { // Left
                    particle.x = 0;
                    particle.y = this.random(0, this.canvas.height);
                }
                particle.speedX = this.random(-0.5, 0.5);
                particle.speedY = this.random(-0.5, 0.5);
                particle.opacity = this.random(0.4, 0.9);
                particle.color = this.getNebulaColor();
            }

            // Wrap around edges (for particles not in gravitational field)
            if (particle.x < -50) particle.x = this.canvas.width + 50;
            if (particle.x > this.canvas.width + 50) particle.x = -50;
            if (particle.y < -50) particle.y = this.canvas.height + 50;
            if (particle.y > this.canvas.height + 50) particle.y = -50;

            // Update pulse (initialize if missing)
            if (particle.pulse === undefined) {
                particle.pulse = 0;
                particle.pulseSpeed = this.random(0.02, 0.05);
            }
            particle.pulse += particle.pulseSpeed;

            return true; // Keep particle
        });

        // Now draw all particles
        this.particles.forEach((particle, index) => {
            // Validate particle properties before drawing
            if (!particle || !particle.color ||
                !isFinite(particle.x) || !isFinite(particle.y) ||
                !isFinite(particle.size) || particle.size <= 0 ||
                !isFinite(particle.opacity)) {
                return; // Skip invalid particles
            }

            const pulseOpacity = particle.opacity + Math.sin(particle.pulse || 0) * 0.2;

            // Draw particle with trail effect when moving fast
            const speed = Math.sqrt(particle.speedX ** 2 + particle.speedY ** 2);
            const trailLength = Math.min(speed * 3, 10);

            if (trailLength > 1) {
                // Draw motion trail
                this.ctx.strokeStyle = `rgba(${particle.color.r}, ${particle.color.g}, ${particle.color.b}, ${pulseOpacity * 0.3})`;
                this.ctx.lineWidth = particle.size * 0.5;
                this.ctx.beginPath();
                this.ctx.moveTo(particle.x - particle.speedX * trailLength, particle.y - particle.speedY * trailLength);
                this.ctx.lineTo(particle.x, particle.y);
                this.ctx.stroke();
            }

            // Draw particle with glow
            const gradient = this.ctx.createRadialGradient(
                particle.x, particle.y, 0,
                particle.x, particle.y, particle.size * 2
            );
            gradient.addColorStop(0, `rgba(${particle.color.r}, ${particle.color.g}, ${particle.color.b}, ${pulseOpacity})`);
            gradient.addColorStop(0.5, `rgba(${particle.color.r}, ${particle.color.g}, ${particle.color.b}, ${pulseOpacity * 0.6})`);
            gradient.addColorStop(1, `rgba(${particle.color.r}, ${particle.color.g}, ${particle.color.b}, 0)`);

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size * 2, 0, Math.PI * 2);
            this.ctx.fill();
        });

        this.animationFrame = requestAnimationFrame(() => this.animateStardust());
    }

    /**
     * Setup event listeners
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
        console.log('[BlackHole] Line clear:', lineCount);

        // Brighten nebula
        this.brightenNebula(lineCount);

        // Create star burst
        this.createStarBurst(lineCount);

        // Brighten stars
        this.brightenStars(lineCount);

        // Pulse black hole
        this.pulseBlackHole(lineCount);

        // Increase gravitational pull temporarily
        this.surgeGravity(lineCount);

        // Create particle burst from black hole
        this.createBlackHoleParticleBurst(lineCount);
    }

    /**
     * React to combos
     */
    onCombo(comboCount) {
        console.log('[BlackHole] Combo:', comboCount);

        // Intensify nebula
        this.intensifyNebula(comboCount);

        // Intensify black hole
        this.intensifyBlackHole(comboCount);

        // Increase gravitational pull based on combo
        this.surgeGravity(comboCount * 2);

        // Spin accretion disk faster
        this.accelerateAccretionDisk(comboCount);

        // Create gravitational wave effect for big combos
        if (comboCount >= 3) {
            this.createGravitationalWave(comboCount);
        }

        // Create massive particle eruption for big combos
        if (comboCount >= 5) {
            this.createParticleEruption(comboCount);
        }

        // Shift nebula colors
        this.shiftNebulaColors(comboCount);
    }

    /**
     * React to piece locks
     */
    onPieceLock(piece) {
        // Subtle particle burst
        if (Math.random() < 0.3) {
            this.createSmallParticleBurst();
        }
    }

    /**
     * Brighten nebula clouds
     */
    brightenNebula(intensity) {
        const nebulas = document.querySelectorAll('.stellar-nebula-cloud');
        nebulas.forEach((nebula, index) => {
            setTimeout(() => {
                nebula.style.transition = 'filter 0.5s ease-out';
                nebula.style.filter = `brightness(${1 + intensity * 0.25}) saturate(${100 + intensity * 20}%)`;

                setTimeout(() => {
                    nebula.style.filter = '';
                }, 500);
            }, index * 80);
        });
    }

    /**
     * Create star burst effect
     */
    createStarBurst(intensity) {
        const burstContainer = document.getElementById('stellar-bursts');
        if (!burstContainer) return;

        const burstCount = Math.min(intensity, 4);

        for (let i = 0; i < burstCount; i++) {
            setTimeout(() => {
                const burst = document.createElement('div');
                burst.className = 'stellar-star-burst';

                burst.style.left = `${this.random(20, 80)}%`;
                burst.style.top = `${this.random(20, 80)}%`;

                burstContainer.appendChild(burst);

                setTimeout(() => {
                    if (burst.parentNode) {
                        burst.parentNode.removeChild(burst);
                    }
                }, 1500);
            }, i * 200);
        }
    }

    /**
     * Brighten stars
     */
    brightenStars(intensity) {
        const starsToBrighten = Math.min(Math.floor(intensity * 15), this.stars.length);

        for (let i = 0; i < starsToBrighten; i++) {
            const star = this.stars[Math.floor(Math.random() * this.stars.length)];
            if (star) {
                const originalOpacity = star.style.opacity;
                star.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
                star.style.opacity = '1';
                star.style.transform = 'scale(1.5)';

                setTimeout(() => {
                    star.style.opacity = originalOpacity;
                    star.style.transform = '';
                }, 300 + Math.random() * 200);
            }
        }
    }

    /**
     * Pulse stardust particles
     */
    pulseStardust(intensity) {
        this.particles.forEach(particle => {
            particle.speedX *= 1.5;
            particle.speedY *= 1.5;
            particle.opacity = Math.min(particle.opacity * 1.5, 1);

            setTimeout(() => {
                particle.speedX /= 1.5;
                particle.speedY /= 1.5;
                particle.opacity /= 1.5;
            }, 500);
        });
    }

    /**
     * Intensify nebula
     */
    intensifyNebula(comboCount) {
        const theme = document.getElementById('stellar-nursery-theme');
        if (!theme) return;

        const brightness = 100 + Math.min(comboCount * 15, 60);
        const saturation = 100 + Math.min(comboCount * 20, 80);

        theme.style.filter = `brightness(${brightness}%) saturate(${saturation}%)`;

        setTimeout(() => {
            theme.style.filter = '';
        }, 1000 + comboCount * 100);
    }

    /**
     * Create supernova effect
     */
    createSupernova(comboCount) {
        const supernovaContainer = document.getElementById('stellar-supernova');
        if (!supernovaContainer) return;

        const supernova = document.createElement('div');
        supernova.className = 'stellar-supernova';

        supernova.style.left = `${this.random(30, 70)}%`;
        supernova.style.top = `${this.random(30, 70)}%`;
        supernova.style.setProperty('--supernova-intensity', Math.min(comboCount, 5));

        supernovaContainer.appendChild(supernova);

        setTimeout(() => {
            if (supernova.parentNode) {
                supernova.parentNode.removeChild(supernova);
            }
        }, 2500);
    }

    /**
     * Shift nebula colors
     */
    shiftNebulaColors(comboCount) {
        const nebulas = document.querySelectorAll('.stellar-nebula-cloud');
        nebulas.forEach((nebula, index) => {
            const hueShift = (comboCount * 10) % 360;

            setTimeout(() => {
                nebula.style.transition = 'filter 1s ease-out';
                nebula.style.filter = `hue-rotate(${hueShift}deg)`;

                setTimeout(() => {
                    nebula.style.filter = '';
                }, 1000);
            }, index * 100);
        });
    }

    /**
     * Create small particle burst
     */
    createSmallParticleBurst() {
        // Add a few temporary fast-moving particles
        for (let i = 0; i < 5; i++) {
            const particle = {
                x: this.canvas.width / 2,
                y: this.canvas.height / 2,
                size: this.random(1, 2),
                speedX: this.random(-2, 2),
                speedY: this.random(-2, 2),
                opacity: 0.8,
                color: this.getNebulaColor(),
                pulse: 0,
                pulseSpeed: 0.05,
                lifetime: 30,
            };
            this.particles.push(particle);
        }

        // Remove these particles after their lifetime
        setTimeout(() => {
            this.particles = this.particles.filter(p => !p.lifetime || p.lifetime-- > 0);
        }, 500);
    }

    /**
     * Pulse black hole on line clear
     */
    pulseBlackHole(intensity) {
        const blackHole = document.getElementById('stellar-black-hole');
        if (!blackHole) return;

        blackHole.style.transition = 'transform 0.4s ease-out, filter 0.4s ease-out';
        blackHole.style.transform = `scale(${1 + intensity * 0.05})`;
        blackHole.style.filter = `brightness(${1 + intensity * 0.1})`;

        setTimeout(() => {
            blackHole.style.transform = '';
            blackHole.style.filter = '';
        }, 400);
    }

    /**
     * Intensify black hole on combo
     */
    intensifyBlackHole(comboCount) {
        const accretionDisk = document.querySelector('.black-hole-accretion-disk');
        const accretionGlow = document.querySelector('.black-hole-accretion-glow');

        if (accretionDisk) {
            accretionDisk.style.transition = 'opacity 0.6s ease-out, filter 0.6s ease-out';
            accretionDisk.style.opacity = Math.min(1, 0.6 + comboCount * 0.1);
            accretionDisk.style.filter = `blur(3px) brightness(${1 + comboCount * 0.15})`;

            setTimeout(() => {
                accretionDisk.style.opacity = '';
                accretionDisk.style.filter = '';
            }, 600 + comboCount * 100);
        }

        if (accretionGlow) {
            accretionGlow.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
            accretionGlow.style.opacity = Math.min(1, 0.6 + comboCount * 0.1);
            accretionGlow.style.transform = `scale(${1 + comboCount * 0.05})`;

            setTimeout(() => {
                accretionGlow.style.opacity = '';
                accretionGlow.style.transform = '';
            }, 600 + comboCount * 100);
        }
    }

    /**
     * Surge gravity temporarily
     */
    surgeGravity(intensity) {
        // Cancel any existing gravity animation
        if (this.gravityAnimationFrame) {
            cancelAnimationFrame(this.gravityAnimationFrame);
        }

        const baseStrength = 0.5; // Default strength
        const baseRadius = 400; // Default radius

        // Calculate target values
        const targetStrength = baseStrength * (1 + intensity * 0.3);
        const targetRadius = baseRadius * (1 + intensity * 0.1);

        // Store start values and time
        const startStrength = this.blackHolePullStrength;
        const startRadius = this.blackHolePullRadius;
        const startTime = performance.now();
        const surgeUpDuration = 300; // 300ms to surge up
        const holdDuration = 800 + intensity * 100; // Hold at peak
        const slowDownDuration = 1500; // 1.5s to slowly return to normal

        const animateGravity = (currentTime) => {
            const elapsed = currentTime - startTime;

            if (elapsed < surgeUpDuration) {
                // Surge up phase (fast)
                const progress = elapsed / surgeUpDuration;
                const eased = this.easeOutQuad(progress);
                this.blackHolePullStrength = startStrength + (targetStrength - startStrength) * eased;
                this.blackHolePullRadius = startRadius + (targetRadius - startRadius) * eased;
                this.gravityAnimationFrame = requestAnimationFrame(animateGravity);
            } else if (elapsed < surgeUpDuration + holdDuration) {
                // Hold at peak
                this.blackHolePullStrength = targetStrength;
                this.blackHolePullRadius = targetRadius;
                this.gravityAnimationFrame = requestAnimationFrame(animateGravity);
            } else if (elapsed < surgeUpDuration + holdDuration + slowDownDuration) {
                // Slow down phase (gradual)
                const progress = (elapsed - surgeUpDuration - holdDuration) / slowDownDuration;
                const eased = this.easeInOutCubic(progress);
                this.blackHolePullStrength = targetStrength + (baseStrength - targetStrength) * eased;
                this.blackHolePullRadius = targetRadius + (baseRadius - targetRadius) * eased;
                this.gravityAnimationFrame = requestAnimationFrame(animateGravity);
            } else {
                // Animation complete - return to base values
                this.blackHolePullStrength = baseStrength;
                this.blackHolePullRadius = baseRadius;
                this.gravityAnimationFrame = null;
            }
        };

        this.gravityAnimationFrame = requestAnimationFrame(animateGravity);
    }

    // Easing functions
    easeOutQuad(t) {
        return t * (2 - t);
    }

    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    /**
     * Create particle burst from black hole
     */
    createBlackHoleParticleBurst(intensity) {
        const burstCount = Math.min(intensity * 15, 60);

        for (let i = 0; i < burstCount; i++) {
            const angle = (Math.PI * 2 * i) / burstCount;
            const speed = this.random(2, 5);

            this.particles.push({
                x: this.blackHoleX,
                y: this.blackHoleY,
                size: this.random(1, 3),
                speedX: Math.cos(angle) * speed,
                speedY: Math.sin(angle) * speed,
                opacity: this.random(0.6, 1),
                color: this.getNebulaColor(),
                pulse: this.random(0, Math.PI * 2),
                pulseSpeed: this.random(0.02, 0.05),
                orbitAngle: angle,
                orbitSpeed: this.random(0.01, 0.03),
                lifetime: 60, // Will fade out
            });
        }
    }

    /**
     * Accelerate accretion disk rotation
     */
    accelerateAccretionDisk(comboCount) {
        const disk = document.querySelector('.black-hole-accretion-disk');
        if (!disk) return;

        // Cancel any existing disk animation
        if (this.diskAnimationTimeout) {
            clearTimeout(this.diskAnimationTimeout);
        }
        if (this.diskSlowdownTimeout) {
            clearTimeout(this.diskSlowdownTimeout);
        }

        const normalDuration = 20; // 20s normal rotation
        const fastDuration = Math.max(5, normalDuration - comboCount * 2);

        // Quick acceleration to fast speed
        disk.style.transition = 'animation-duration 0.3s ease-out';
        disk.style.animationDuration = `${fastDuration}s`;

        // Hold at fast speed
        this.diskAnimationTimeout = setTimeout(() => {
            // Gradual slowdown back to normal
            disk.style.transition = 'animation-duration 2s ease-in-out';
            disk.style.animationDuration = `${normalDuration}s`;

            // Clear transition after slowdown completes
            this.diskSlowdownTimeout = setTimeout(() => {
                disk.style.transition = '';
                this.diskAnimationTimeout = null;
                this.diskSlowdownTimeout = null;
            }, 2000);
        }, 1000 + comboCount * 150); // Hold for longer on bigger combos
    }

    /**
     * Create gravitational wave effect
     */
    createGravitationalWave(comboCount) {
        const waveContainer = document.getElementById('stellar-bursts');
        if (!waveContainer) return;

        const waveCount = Math.min(comboCount - 2, 3);

        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => {
                const wave = document.createElement('div');
                wave.className = 'gravitational-wave';
                wave.style.left = '35%';
                wave.style.top = '50%';
                wave.style.setProperty('--wave-delay', `${i * 0.2}s`);

                waveContainer.appendChild(wave);

                setTimeout(() => {
                    if (wave.parentNode) {
                        wave.parentNode.removeChild(wave);
                    }
                }, 2000);
            }, i * 300);
        }
    }

    /**
     * Create massive particle eruption
     */
    createParticleEruption(comboCount) {
        const eruptionCount = Math.min(comboCount * 20, 100);

        for (let i = 0; i < eruptionCount; i++) {
            setTimeout(() => {
                const angle = this.random(0, Math.PI * 2);
                const speed = this.random(3, 8);
                const distance = this.random(50, 150);

                this.particles.push({
                    x: this.blackHoleX + Math.cos(angle) * distance,
                    y: this.blackHoleY + Math.sin(angle) * distance,
                    size: this.random(1.5, 4),
                    speedX: Math.cos(angle) * speed,
                    speedY: Math.sin(angle) * speed,
                    opacity: this.random(0.7, 1),
                    color: this.getNebulaColor(),
                    pulse: this.random(0, Math.PI * 2),
                    pulseSpeed: this.random(0.03, 0.06),
                    orbitAngle: angle,
                    orbitSpeed: this.random(0.015, 0.025),
                    lifetime: 120,
                });
            }, i * 10);
        }
    }

    stop() {
        // Cancel animation frame
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Cancel gravity animation
        if (this.gravityAnimationFrame) {
            cancelAnimationFrame(this.gravityAnimationFrame);
            this.gravityAnimationFrame = null;
        }

        // Clear disk animation timeouts
        if (this.diskAnimationTimeout) {
            clearTimeout(this.diskAnimationTimeout);
            this.diskAnimationTimeout = null;
        }
        if (this.diskSlowdownTimeout) {
            clearTimeout(this.diskSlowdownTimeout);
            this.diskSlowdownTimeout = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Clear data
        this.stars = [];
        this.particles = [];
        this.canvas = null;
        this.ctx = null;

        // Clear any active effects
        const theme = document.getElementById('stellar-nursery-theme');
        if (theme) {
            theme.style.filter = '';
        }

        super.stop();
    }
}
