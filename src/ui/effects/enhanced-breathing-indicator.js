/**
 * Enhanced Breathing Indicator - The most beautiful breathing guide ever created
 *
 * Features:
 * - Multiple concentric circles with independent animations
 * - Dynamic color transitions (blue → purple → pink → gold)
 * - Particle effects that sync with breathing rhythm
 * - Glow effects and ethereal shadows
 * - Smooth easing with perfect timing
 * - Multiple breathing techniques with descriptions
 */

export class EnhancedBreathingIndicator {
    constructor(container) {
        this.container = container;
        this.isActive = false;
        this.animationFrame = null;
        this.currentPhase = 'inhale';
        this.phaseStartTime = 0;
        this.showText = true;
        this.particles = [];
        this.maxParticles = 50; // More particles for stunning effect
        this.selectorVisible = false;
        this.selectorTimeout = null;

        // Breathing techniques with detailed info
        this.techniques = {
            'deep-relaxation': {
                name: 'Deep Relaxation',
                pattern: [5, 2, 7, 2], // Long exhale for parasympathetic activation
                description: 'Activates relaxation response • Extended exhale',
                color: { r: 100, g: 180, b: 255 }, // Serene blue
            },
            'box-breathing': {
                name: 'Box Breathing',
                pattern: [4, 4, 4, 4], // Equal timing for focus
                description: 'Navy SEAL technique • Focus & calm under pressure',
                color: { r: 160, g: 100, b: 255 }, // Royal purple
            },
            'calm-sleep': {
                name: '4-7-8 Sleep',
                pattern: [4, 7, 8, 0], // Dr. Weil's technique
                description: 'Natural tranquilizer • Fall asleep in 60 seconds',
                color: { r: 255, g: 130, b: 200 }, // Dreamy pink
            },
            'energizing': {
                name: 'Energizing',
                pattern: [3, 1, 3, 1], // Faster for energy
                description: 'Quick refresh • Instant energy & alertness',
                color: { r: 255, g: 200, b: 80 }, // Vibrant gold
            },
            'coherence': {
                name: 'Heart Coherence',
                pattern: [5, 0, 5, 0], // 6 breaths per minute
                description: 'Heart-brain balance • Optimal HRV frequency',
                color: { r: 80, g: 255, b: 150 }, // Healing green
            },
            'triangle': {
                name: 'Triangle Breath',
                pattern: [4, 0, 4, 4], // Three-sided pattern
                description: 'Anxiety relief • Grounding & centering',
                color: { r: 100, g: 220, b: 255 }, // Aqua blue
            },
            'wim-hof': {
                name: 'Power Breath',
                pattern: [2, 0, 1, 0], // Short, powerful breathing
                description: 'Wim Hof inspired • Boost energy & immunity',
                color: { r: 255, g: 100, b: 100 }, // Fiery red
            },
        };

        this.currentTechnique = 'deep-relaxation';
        this.technique = this.techniques[this.currentTechnique];
        this.pattern = this.technique.pattern;

        // Create UI elements
        this._createElements();
        this._createParticles();
    }

    /**
     * Create DOM elements for breathing indicator
     * @private
     */
    _createElements() {
        // Backdrop for visibility
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'breathing-backdrop';
        this.backdrop.style.display = 'none';

        // Main container
        this.indicator = document.createElement('div');
        this.indicator.id = 'enhanced-breathing-indicator';
        this.indicator.className = 'enhanced-breathing-indicator';
        this.indicator.style.display = 'none';

        // Content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'breathing-content-wrapper';

        // Visual container for all breathing elements
        const visualContainer = document.createElement('div');
        visualContainer.className = 'breathing-visual-container';

        // Particle canvas (larger for new design)
        this.particleCanvas = document.createElement('canvas');
        this.particleCanvas.className = 'breathing-particles';
        this.particleCanvas.width = 700;
        this.particleCanvas.height = 700;
        this.particleCtx = this.particleCanvas.getContext('2d');

        // Outer glow ring (slowest)
        this.outerRing = document.createElement('div');
        this.outerRing.className = 'breathing-ring breathing-ring-outer';

        // Middle ring (medium speed)
        this.middleRing = document.createElement('div');
        this.middleRing.className = 'breathing-ring breathing-ring-middle';

        // Inner ring (fastest)
        this.innerRing = document.createElement('div');
        this.innerRing.className = 'breathing-ring breathing-ring-inner';

        // Core circle (main focus point)
        this.coreCircle = document.createElement('div');
        this.coreCircle.className = 'breathing-core';

        // Text prompt (now absolutely positioned in center)
        this.textPrompt = document.createElement('div');
        this.textPrompt.className = 'breathing-text-enhanced';
        this.textPrompt.textContent = 'Breathe';

        // Assemble visual elements
        visualContainer.appendChild(this.particleCanvas);
        visualContainer.appendChild(this.outerRing);
        visualContainer.appendChild(this.middleRing);
        visualContainer.appendChild(this.innerRing);
        visualContainer.appendChild(this.coreCircle);
        visualContainer.appendChild(this.textPrompt);

        // Technique name display (top)
        this.techniqueName = document.createElement('div');
        this.techniqueName.className = 'breathing-technique-name';
        this.techniqueName.textContent = this.technique.name;
        
        // Add hover event to show description
        this.techniqueName.addEventListener('mouseenter', () => {
            this._showTechniqueInfo(5000);
        });

        // Technique description (bottom)
        this.techniqueDesc = document.createElement('div');
        this.techniqueDesc.className = 'breathing-technique-desc';
        this.techniqueDesc.textContent = this.technique.description;

        // Technique selector
        this.techniqueSelector = this._createTechniqueSelector();

        // Assemble content wrapper
        contentWrapper.appendChild(this.techniqueName);
        contentWrapper.appendChild(visualContainer);
        contentWrapper.appendChild(this.techniqueDesc);
        contentWrapper.appendChild(this.techniqueSelector);

        // Create hover area for bottom of screen
        this.hoverArea = document.createElement('div');
        this.hoverArea.className = 'breathing-hover-area';
        this.hoverArea.style.display = 'none';

        // Assemble main indicator
        this.indicator.appendChild(this.hoverArea);
        this.indicator.appendChild(contentWrapper);
        
        // Add to DOM
        this.container.appendChild(this.backdrop);
        this.container.appendChild(this.indicator);

        console.log('[EnhancedBreathingIndicator] Elements created with stunning design');
    }

    /**
     * Create technique selector UI
     * @private
     */
    _createTechniqueSelector() {
        const selector = document.createElement('div');
        selector.className = 'breathing-technique-selector';

        const techniqueKeys = Object.keys(this.techniques);
        techniqueKeys.forEach((key) => {
            const button = document.createElement('button');
            button.className = 'technique-button';
            button.dataset.technique = key;
            button.textContent = this.techniques[key].name;
            
            if (key === this.currentTechnique) {
                button.classList.add('active');
            }

            button.addEventListener('click', () => {
                this.setTechnique(key);
                this._updateSelectorButtons();
            });

            selector.appendChild(button);
        });

        return selector;
    }

    /**
     * Update technique selector button states
     * @private
     */
    _updateSelectorButtons() {
        const buttons = this.techniqueSelector.querySelectorAll('.technique-button');
        buttons.forEach((button) => {
            if (button.dataset.technique === this.currentTechnique) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    /**
     * Create particle system
     * @private
     */
    _createParticles() {
        this.particles = [];
        for (let i = 0; i < this.maxParticles; i++) {
            this.particles.push({
                angle: (Math.PI * 2 * i) / this.maxParticles,
                distance: 0,
                speed: 0.02 + Math.random() * 0.03,
                size: 2 + Math.random() * 3,
                alpha: 0,
                rotationSpeed: (Math.random() - 0.5) * 0.02,
            });
        }
    }

    /**
     * Start the breathing indicator animation
     */
    start() {
        if (this.isActive) {
            console.log('[EnhancedBreathingIndicator] Already active');
            return;
        }

        console.log('[EnhancedBreathingIndicator] Starting with technique:', this.currentTechnique);
        this.isActive = true;
        
        // Show backdrop, indicator, and hover area
        this.backdrop.style.display = 'block';
        this.indicator.style.display = 'block';
        this.hoverArea.style.display = 'block';
        
        // Setup keyboard listener for selector toggle
        this._setupKeyboardListener();
        
        // Show selector briefly at start, then hide (with technique info)
        this._showSelectorTemporarily(4000);
        
        this.phaseStartTime = performance.now();
        this.currentPhase = 'inhale';

        this._animate();
    }

    /**
     * Stop the breathing indicator animation
     */
    stop() {
        if (!this.isActive) return;

        this.isActive = false;
        
        // Hide backdrop, indicator, and hover area
        this.backdrop.style.display = 'none';
        this.indicator.style.display = 'none';
        this.hoverArea.style.display = 'none';

        // Clean up keyboard listener
        this._removeKeyboardListener();
        
        // Clear selector timeout
        if (this.selectorTimeout) {
            clearTimeout(this.selectorTimeout);
            this.selectorTimeout = null;
        }

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    /**
     * Toggle visibility
     */
    toggle() {
        if (this.isActive) {
            this.stop();
        } else {
            this.start();
        }
    }

    /**
     * Set breathing technique
     * @param {string} techniqueName - Key from techniques object
     * @param {boolean} showSelector - Whether to show the selector (default: false)
     */
    setTechnique(techniqueName, showSelector = false) {
        if (this.techniques[techniqueName]) {
            this.currentTechnique = techniqueName;
            this.technique = this.techniques[techniqueName];
            this.pattern = this.technique.pattern;

            // Update UI
            this.techniqueName.textContent = this.technique.name;
            this.techniqueDesc.textContent = this.technique.description;
            this._updateSelectorButtons();

            // Show selector only if explicitly requested (e.g., on first start)
            if (showSelector) {
                this._showSelectorTemporarily(2000);
            } else {
                // Just show name + description briefly when pressing T
                this._showTechniqueInfo(3000);
            }

            // Restart animation with new pattern
            if (this.isActive) {
                this.phaseStartTime = performance.now();
                this.currentPhase = 'inhale';
            }

            console.log('[EnhancedBreathingIndicator] Technique changed to:', this.technique.name);
        }
    }

    /**
     * Set whether to show text prompts
     * @param {boolean} show
     */
    setShowText(show) {
        this.showText = show;
        this.textPrompt.style.display = show ? 'block' : 'none';
    }

    /**
     * Main animation loop
     * @private
     */
    _animate() {
        if (!this.isActive) return;

        const now = performance.now();
        const elapsed = (now - this.phaseStartTime) / 1000;

        // Get current phase duration
        const [inhale, hold1, exhale, hold2] = this.pattern;
        let phaseDuration;
        let nextPhase;
        let phaseText;

        // Determine current phase
        if (this.currentPhase === 'inhale') {
            phaseDuration = inhale;
            nextPhase = hold1 > 0 ? 'hold1' : 'exhale';
            phaseText = 'Breathe In';
        } else if (this.currentPhase === 'hold1') {
            phaseDuration = hold1;
            nextPhase = 'exhale';
            phaseText = 'Hold';
        } else if (this.currentPhase === 'exhale') {
            phaseDuration = exhale;
            nextPhase = hold2 > 0 ? 'hold2' : 'inhale';
            phaseText = 'Breathe Out';
        } else { // hold2
            phaseDuration = hold2;
            nextPhase = 'inhale';
            phaseText = 'Hold';
        }

        // Check if phase is complete
        if (elapsed >= phaseDuration) {
            this.currentPhase = nextPhase;
            this.phaseStartTime = now;
            this.animationFrame = requestAnimationFrame(() => this._animate());
            return;
        }

        // Calculate progress through current phase (0 to 1)
        const progress = elapsed / phaseDuration;

        // Apply technique-specific animations
        this._animateTechniqueSpecific(progress);
        this._updateColors(progress);

        // Update text if enabled
        if (this.showText) {
            this.textPrompt.textContent = phaseText;
        }

        // Continue animation
        this.animationFrame = requestAnimationFrame(() => this._animate());
    }

    /**
     * Route to technique-specific animation
     * @private
     */
    _animateTechniqueSpecific(progress) {
        switch (this.currentTechnique) {
            case 'deep-relaxation':
                this._animateDeepRelaxation(progress);
                break;
            case 'box-breathing':
                this._animateBoxBreathing(progress);
                break;
            case 'calm-sleep':
                this._animateSleepWaves(progress);
                break;
            case 'energizing':
                this._animateEnergizing(progress);
                break;
            case 'coherence':
                this._animateHeartCoherence(progress);
                break;
            case 'triangle':
                this._animateTriangleBreath(progress);
                break;
            case 'wim-hof':
                this._animatePowerBreath(progress);
                break;
            default:
                this._animateDeepRelaxation(progress);
        }
    }

    /**
     * 1. DEEP RELAXATION - Flowing circles (original animation)
     * @private
     */
    _animateDeepRelaxation(progress) {
        this._animateRingsClassic(progress);
        this._animateParticlesCircular(progress);
    }

    /**
     * Animate the concentric rings (classic)
     * @private
     */
    _animateRingsClassic(progress) {
        let scale;
        let opacity;

        // Calculate scale based on phase
        if (this.currentPhase === 'inhale') {
            scale = 0.3 + this._easeInOutQuart(progress) * 0.7; // 0.3 → 1.0
            opacity = 0.3 + progress * 0.7;
        } else if (this.currentPhase === 'exhale') {
            scale = 1.0 - this._easeInOutQuart(progress) * 0.7; // 1.0 → 0.3
            opacity = 1.0 - progress * 0.7;
        } else {
            // Hold phases: gentle pulsing
            scale = this.currentPhase === 'hold1' ? 1.0 : 0.3;
            const pulse = Math.sin(progress * Math.PI * 4) * 0.02;
            scale += pulse;
            opacity = this.currentPhase === 'hold1' ? 1.0 : 0.3;
        }

        // Outer ring (slowest, largest)
        const outerScale = scale * 1.3;
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${outerScale})`;
        this.outerRing.style.opacity = opacity * 0.4;

        // Middle ring (medium speed)
        const middleScale = scale * 1.0;
        this.middleRing.style.transform = `translate(-50%, -50%) scale(${middleScale})`;
        this.middleRing.style.opacity = opacity * 0.6;

        // Inner ring (fastest, smallest)
        const innerScale = scale * 0.7;
        this.innerRing.style.transform = `translate(-50%, -50%) scale(${innerScale})`;
        this.innerRing.style.opacity = opacity * 0.8;

        // Core circle (brightest)
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.5})`;
        this.coreCircle.style.opacity = opacity;
    }

    /**
     * Animate particles in circular pattern
     * @private
     */
    _animateParticlesCircular(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const color = this.technique.color;

        // Clear canvas
        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        // Calculate target distance based on phase
        let targetDistance;
        if (this.currentPhase === 'inhale') {
            targetDistance = 50 + this._easeInOutQuart(progress) * 150; // 50 → 200
        } else if (this.currentPhase === 'exhale') {
            targetDistance = 200 - this._easeInOutQuart(progress) * 150; // 200 → 50
        } else {
            targetDistance = this.currentPhase === 'hold1' ? 200 : 50;
        }

        // Update and draw particles
        this.particles.forEach((particle, i) => {
            // Smoothly move to target distance
            particle.distance += (targetDistance - particle.distance) * 0.1;

            // Rotate
            particle.angle += particle.rotationSpeed;

            // Calculate position
            const x = centerX + Math.cos(particle.angle) * particle.distance;
            const y = centerY + Math.sin(particle.angle) * particle.distance;

            // Calculate alpha based on phase
            let targetAlpha;
            if (this.currentPhase === 'inhale') {
                targetAlpha = progress;
            } else if (this.currentPhase === 'exhale') {
                targetAlpha = 1 - progress;
            } else {
                targetAlpha = this.currentPhase === 'hold1' ? 1 : 0.3;
            }

            particle.alpha += (targetAlpha - particle.alpha) * 0.1;

            // Draw outer glow (largest)
            const outerGradient = ctx.createRadialGradient(x, y, 0, x, y, particle.size * 5);
            outerGradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${particle.alpha * 0.2})`);
            outerGradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${particle.alpha * 0.1})`);
            outerGradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
            ctx.fillStyle = outerGradient;
            ctx.beginPath();
            ctx.arc(x, y, particle.size * 5, 0, Math.PI * 2);
            ctx.fill();

            // Draw inner glow
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, particle.size * 2.5);
            gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${particle.alpha * 0.4})`);
            gradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${particle.alpha * 0.2})`);
            gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, particle.size * 2.5, 0, Math.PI * 2);
            ctx.fill();

            // Draw core particle (brightest)
            ctx.beginPath();
            ctx.arc(x, y, particle.size, 0, Math.PI * 2);
            const coreGradient = ctx.createRadialGradient(x, y, 0, x, y, particle.size);
            coreGradient.addColorStop(0, `rgba(255, 255, 255, ${particle.alpha * 0.8})`);
            coreGradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${particle.alpha * 0.7})`);
            coreGradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, ${particle.alpha * 0.4})`);
            ctx.fillStyle = coreGradient;
            ctx.fill();
        });
    }

    /**
     * 2. BOX BREATHING - Rotating square pattern
     * @private
     */
    _animateBoxBreathing(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const color = this.technique.color;
        
        // Clear canvas
        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);
        
        // Calculate scale
        let scale;
        if (this.currentPhase === 'inhale') {
            scale = 0.3 + this._easeInOutQuart(progress) * 0.7;
        } else if (this.currentPhase === 'exhale') {
            scale = 1.0 - this._easeInOutQuart(progress) * 0.7;
        } else {
            scale = this.currentPhase === 'hold1' ? 1.0 : 0.3;
        }
        
        // Draw rotating square
        const size = 200 * scale;
        const rotation = (Date.now() / 5000) * Math.PI * 2; // Slow rotation
        
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(rotation);
        
        // Draw square outline
        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${0.8 * scale})`;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 20;
        ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.8)`;
        ctx.strokeRect(-size, -size, size * 2, size * 2);
        
        // Draw corner glows
        const corners = [
            [-size, -size], [size, -size], [size, size], [-size, size]
        ];
        corners.forEach(([x, y]) => {
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, 30);
            gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.8 * scale})`);
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, 30, 0, Math.PI * 2);
            ctx.fill();
        });
        
        ctx.restore();
        
        // Hide rings, show center core
        this.outerRing.style.opacity = 0;
        this.middleRing.style.opacity = 0;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.6})`;
        this.coreCircle.style.opacity = scale;
    }

    /**
     * 3. 4-7-8 SLEEP - Dreamy wave animation
     * @private
     */
    _animateSleepWaves(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const color = this.technique.color;
        
        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);
        
        // Calculate amplitude
        let amplitude;
        if (this.currentPhase === 'inhale') {
            amplitude = 20 + this._easeInOutQuart(progress) * 60;
        } else if (this.currentPhase === 'exhale') {
            amplitude = 80 - this._easeInOutQuart(progress) * 60;
        } else {
            amplitude = this.currentPhase === 'hold1' ? 80 : 20;
        }
        
        const time = Date.now() / 1000;
        
        // Draw multiple wave layers
        for (let layer = 0; layer < 3; layer++) {
            ctx.beginPath();
            const layerOffset = layer * 80;
            const layerAlpha = (0.6 - layer * 0.15) * (amplitude / 80);
            
            for (let x = 0; x < this.particleCanvas.width; x += 5) {
                const y = centerY + layerOffset + 
                    Math.sin((x / 50) + time + layer) * amplitude * 0.8 +
                    Math.sin((x / 30) + time * 1.5 + layer) * amplitude * 0.4;
                
                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            
            ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${layerAlpha})`;
            ctx.lineWidth = 3;
            ctx.shadowBlur = 15;
            ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, ${layerAlpha})`;
            ctx.stroke();
        }
        
        // Subtle rings
        const scale = amplitude / 80;
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${scale * 1.2})`;
        this.outerRing.style.opacity = scale * 0.3;
        this.middleRing.style.opacity = 0;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.5})`;
        this.coreCircle.style.opacity = scale * 0.6;
    }

    /**
     * 4. ENERGIZING - Radial burst pattern
     * @private
     */
    _animateEnergizing(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const color = this.technique.color;
        
        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);
        
        // Calculate burst intensity
        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = this.currentPhase === 'hold1' ? 1 : 0.2;
        }
        
        // Draw radial rays
        const rayCount = 16;
        for (let i = 0; i < rayCount; i++) {
            const angle = (i / rayCount) * Math.PI * 2;
            const length = 150 * intensity;
            
            const gradient = ctx.createLinearGradient(
                centerX, centerY,
                centerX + Math.cos(angle) * length,
                centerY + Math.sin(angle) * length
            );
            gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.8 * intensity})`);
            gradient.addColorStop(1, 'transparent');
            
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(
                centerX + Math.cos(angle) * length,
                centerY + Math.sin(angle) * length
            );
            ctx.stroke();
        }
        
        // Bright center
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 50 * intensity);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${0.9 * intensity})`);
        gradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.6 * intensity})`);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 50 * intensity, 0, Math.PI * 2);
        ctx.fill();
        
        // Rings
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${intensity * 1.3})`;
        this.outerRing.style.opacity = intensity * 0.5;
        this.middleRing.style.opacity = 0;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${intensity * 0.7})`;
        this.coreCircle.style.opacity = intensity;
    }

    /**
     * 5. HEART COHERENCE - Heartbeat pulse
     * @private
     */
    _animateHeartCoherence(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const color = this.technique.color;
        
        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);
        
        // Calculate pulse
        let pulse;
        if (this.currentPhase === 'inhale') {
            pulse = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            pulse = 1 - this._easeInOutQuart(progress);
        } else {
            pulse = 0.5;
        }
        
        const scale = 0.5 + pulse * 0.5;
        
        // Draw sine wave (coherence wave)
        ctx.beginPath();
        const time = Date.now() / 1000;
        for (let x = 0; x < this.particleCanvas.width; x += 3) {
            const y = centerY + Math.sin((x / 40) + time * 2) * 40 * scale;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${0.6 * scale})`;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 15;
        ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.8)`;
        ctx.stroke();
        
        // Heart shape (simplified as pulsing circle)
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 100 * scale);
        gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.4 * scale})`);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 100 * scale, 0, Math.PI * 2);
        ctx.fill();
        
        // Rings
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${scale * 1.2})`;
        this.outerRing.style.opacity = scale * 0.4;
        this.middleRing.style.transform = `translate(-50%, -50%) scale(${scale})`;
        this.middleRing.style.opacity = scale * 0.5;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.6})`;
        this.coreCircle.style.opacity = scale;
    }

    /**
     * 6. TRIANGLE BREATH - Rotating triangle
     * @private
     */
    _animateTriangleBreath(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const color = this.technique.color;
        
        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);
        
        // Calculate scale
        let scale;
        if (this.currentPhase === 'inhale') {
            scale = 0.4 + this._easeInOutQuart(progress) * 0.6;
        } else if (this.currentPhase === 'exhale') {
            scale = 1.0 - this._easeInOutQuart(progress) * 0.6;
        } else {
            scale = this.currentPhase === 'hold1' ? 0.4 : 1.0;
        }
        
        const size = 180 * scale;
        const rotation = (Date.now() / 6000) * Math.PI * 2;
        
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(rotation);
        
        // Draw triangle
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * size;
            const y = Math.sin(angle) * size;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        
        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${0.8 * scale})`;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 20;
        ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.8)`;
        ctx.stroke();
        
        // Corner glows
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * size;
            const y = Math.sin(angle) * size;
            
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, 25);
            gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.8 * scale})`);
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, 25, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
        
        // Rings
        this.outerRing.style.opacity = 0;
        this.middleRing.style.opacity = 0;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.5})`;
        this.coreCircle.style.opacity = scale;
    }

    /**
     * 7. POWER BREATH - Explosive fire burst
     * @private
     */
    _animatePowerBreath(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const color = this.technique.color;
        
        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);
        
        // Fast, intense breathing
        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else {
            intensity = 1 - this._easeInOutQuart(progress);
        }
        
        // Draw explosive particles
        const particleCount = 30;
        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const distance = 50 + intensity * 150;
            const x = centerX + Math.cos(angle) * distance;
            const y = centerY + Math.sin(angle) * distance;
            
            // Flame-like particles
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, 15);
            gradient.addColorStop(0, `rgba(255, 255, 100, ${intensity * 0.9})`);
            gradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${intensity * 0.7})`);
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, 15, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Intense center
        const centerGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 60 * intensity);
        centerGradient.addColorStop(0, `rgba(255, 255, 255, ${0.9 * intensity})`);
        centerGradient.addColorStop(0.3, `rgba(255, 200, 100, ${0.7 * intensity})`);
        centerGradient.addColorStop(0.6, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.5 * intensity})`);
        centerGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = centerGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 60 * intensity, 0, Math.PI * 2);
        ctx.fill();
        
        // Rings
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${intensity * 1.4})`;
        this.outerRing.style.opacity = intensity * 0.6;
        this.middleRing.style.opacity = 0;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${intensity * 0.8})`;
        this.coreCircle.style.opacity = intensity;
    }

    /**
     * Update colors based on phase
     * @private
     */
    _updateColors(progress) {
        const color = this.technique.color;
        const baseColor = `${color.r}, ${color.g}, ${color.b}`;

        // Update CSS custom properties for dynamic colors
        this.indicator.style.setProperty('--breath-color-r', color.r);
        this.indicator.style.setProperty('--breath-color-g', color.g);
        this.indicator.style.setProperty('--breath-color-b', color.b);

        // Adjust brightness based on phase
        let brightness = 1.0;
        if (this.currentPhase === 'inhale') {
            brightness = 0.7 + progress * 0.3;
        } else if (this.currentPhase === 'exhale') {
            brightness = 1.0 - progress * 0.3;
        }

        this.indicator.style.setProperty('--breath-brightness', brightness);
    }

    /**
     * Ease in-out quartic function for ultra-smooth animation
     * @param {number} t - Progress (0 to 1)
     * @returns {number} - Eased value (0 to 1)
     * @private
     */
    _easeInOutQuart(t) {
        return t < 0.5
            ? 8 * t * t * t * t
            : 1 - Math.pow(-2 * t + 2, 4) / 2;
    }

    /**
     * Setup keyboard listener for selector toggle
     * @private
     */
    _setupKeyboardListener() {
        this._handleKeyPress = (event) => {
            if (event.key.toLowerCase() === 's') {
                this.toggleSelector();
                event.preventDefault();
            } else if (event.key.toLowerCase() === 'i') {
                // Show technique info (description)
                this._showTechniqueInfo(5000);
                event.preventDefault();
            }
        };
        document.addEventListener('keydown', this._handleKeyPress);
    }

    /**
     * Remove keyboard listener
     * @private
     */
    _removeKeyboardListener() {
        if (this._handleKeyPress) {
            document.removeEventListener('keydown', this._handleKeyPress);
            this._handleKeyPress = null;
        }
    }

    /**
     * Toggle selector visibility
     */
    toggleSelector() {
        this.selectorVisible = !this.selectorVisible;
        
        if (this.selectorVisible) {
            this.techniqueSelector.classList.add('visible');
            
            // Clear any pending auto-hide
            if (this.selectorTimeout) {
                clearTimeout(this.selectorTimeout);
                this.selectorTimeout = null;
            }
        } else {
            this.techniqueSelector.classList.remove('visible');
        }
    }

    /**
     * Show selector temporarily, then hide
     * @param {number} duration - How long to show in milliseconds
     * @private
     */
    _showSelectorTemporarily(duration = 3000) {
        // Clear any existing timeout
        if (this.selectorTimeout) {
            clearTimeout(this.selectorTimeout);
        }

        // Show selector AND description
        this.techniqueSelector.classList.add('visible');
        this.techniqueDesc.classList.add('visible');
        this.selectorVisible = true;

        // Auto-hide after duration
        this.selectorTimeout = setTimeout(() => {
            this.techniqueSelector.classList.remove('visible');
            this.techniqueDesc.classList.remove('visible');
            this.selectorVisible = false;
            this.selectorTimeout = null;
        }, duration);
    }

    /**
     * Show technique name and description (without selector)
     * @param {number} duration - How long to show in milliseconds
     * @private
     */
    _showTechniqueInfo(duration = 3000) {
        // Clear any existing timeout
        if (this.selectorTimeout) {
            clearTimeout(this.selectorTimeout);
        }

        // Show only description, name is already visible
        this.techniqueDesc.classList.add('visible');
        this.techniqueName.classList.add('visible-temp');

        // Auto-hide after duration
        this.selectorTimeout = setTimeout(() => {
            this.techniqueDesc.classList.remove('visible');
            this.techniqueName.classList.remove('visible-temp');
            this.selectorTimeout = null;
        }, duration);
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stop();
        
        // Remove backdrop
        if (this.backdrop && this.backdrop.parentElement) {
            this.backdrop.parentElement.removeChild(this.backdrop);
        }
        
        // Remove indicator
        if (this.indicator && this.indicator.parentElement) {
            this.indicator.parentElement.removeChild(this.indicator);
        }
    }
}

// Export singleton instance
let enhancedBreathingIndicatorInstance = null;

/**
 * Get or create enhanced breathing indicator instance
 * @returns {EnhancedBreathingIndicator}
 */
export function getEnhancedBreathingIndicator() {
    if (!enhancedBreathingIndicatorInstance) {
        enhancedBreathingIndicatorInstance = new EnhancedBreathingIndicator(document.body);
    }
    return enhancedBreathingIndicatorInstance;
}

/**
 * Initialize enhanced breathing indicator (called from main.js)
 */
export function initEnhancedBreathingIndicator() {
    return getEnhancedBreathingIndicator();
}
