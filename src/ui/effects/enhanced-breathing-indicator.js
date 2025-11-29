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
                name: 'Aurora Dreams',
                pattern: [5, 2, 7, 2], // Long exhale for parasympathetic activation
                description: 'Northern lights flow through you • Deep peace',
                color: { r: 80, g: 200, b: 255 }, // Aurora cyan
                secondaryColor: { r: 180, g: 100, b: 255 }, // Aurora purple
                tertiaryColor: { r: 100, g: 255, b: 180 }, // Aurora green
            },
            'box-breathing': {
                name: 'Sacred Geometry',
                pattern: [4, 4, 4, 4], // Equal timing for focus
                description: 'Ancient patterns align your mind • Perfect balance',
                color: { r: 200, g: 150, b: 255 }, // Mystical purple
                secondaryColor: { r: 255, g: 200, b: 100 }, // Golden
                tertiaryColor: { r: 100, g: 200, b: 255 }, // Sky blue
            },
            'calm-sleep': {
                name: 'Moonlit Waters',
                pattern: [4, 7, 8, 0], // Dr. Weil's technique
                description: 'Drift on silver waves under starlight • Deep sleep',
                color: { r: 150, g: 180, b: 255 }, // Moonlight blue
                secondaryColor: { r: 255, g: 255, b: 220 }, // Soft white
                tertiaryColor: { r: 100, g: 120, b: 200 }, // Deep night
            },
            energizing: {
                name: 'Solar Flare',
                pattern: [3, 1, 3, 1], // Faster for energy
                description: 'Channel the sun\'s explosive power • Pure energy',
                color: { r: 255, g: 180, b: 50 }, // Solar orange
                secondaryColor: { r: 255, g: 255, b: 150 }, // Bright yellow
                tertiaryColor: { r: 255, g: 100, b: 50 }, // Deep orange
            },
            coherence: {
                name: 'Heart Glow',
                pattern: [5, 0, 5, 0], // 6 breaths per minute
                description: 'Your heart radiates healing light • Love flows',
                color: { r: 255, g: 100, b: 150 }, // Heart pink
                secondaryColor: { r: 255, g: 180, b: 200 }, // Soft rose
                tertiaryColor: { r: 200, g: 50, b: 100 }, // Deep rose
            },
            triangle: {
                name: 'Crystal Prism',
                pattern: [4, 0, 4, 4], // Three-sided pattern
                description: 'Light refracts through your being • Clarity',
                color: { r: 150, g: 255, b: 255 }, // Crystal cyan
                secondaryColor: { r: 255, g: 150, b: 255 }, // Crystal pink
                tertiaryColor: { r: 255, g: 255, b: 150 }, // Crystal yellow
            },
            'wim-hof': {
                name: 'Volcanic Fire',
                pattern: [2, 0, 1, 0], // Short, powerful breathing
                description: 'Molten power surges through you • Unstoppable',
                color: { r: 255, g: 80, b: 30 }, // Lava orange
                secondaryColor: { r: 255, g: 200, b: 50 }, // Bright flame
                tertiaryColor: { r: 200, g: 30, b: 30 }, // Deep ember
            },
            'ocean-breath': {
                name: 'Ocean Tide',
                pattern: [4, 0, 4, 0], // Ujjayi-inspired
                description: 'Waves crash and recede within you • Infinite calm',
                color: { r: 30, g: 150, b: 200 }, // Ocean blue
                secondaryColor: { r: 100, g: 220, b: 255 }, // Seafoam
                tertiaryColor: { r: 20, g: 80, b: 120 }, // Deep ocean
            },
            'zen-garden': {
                name: 'Zen Garden',
                pattern: [6, 3, 6, 3], // Slow, meditative
                description: 'Ripples spread across still water • Pure presence',
                color: { r: 180, g: 200, b: 180 }, // Sage green
                secondaryColor: { r: 220, g: 220, b: 200 }, // Sand
                tertiaryColor: { r: 100, g: 120, b: 100 }, // Stone
            },
            'cosmic-breath': {
                name: 'Cosmic Nebula',
                pattern: [5, 3, 5, 3], // Expansive
                description: 'Stars are born within your breath • Infinite',
                color: { r: 150, g: 50, b: 200 }, // Nebula purple
                secondaryColor: { r: 255, g: 100, b: 150 }, // Nebula pink
                tertiaryColor: { r: 50, g: 150, b: 255 }, // Nebula blue
            },
            'forest-breath': {
                name: 'Ancient Forest',
                pattern: [4, 2, 6, 2], // Grounding
                description: 'Breathe with thousand-year trees • Rooted strength',
                color: { r: 50, g: 180, b: 100 }, // Forest green
                secondaryColor: { r: 150, g: 100, b: 50 }, // Bark brown
                tertiaryColor: { r: 200, g: 255, b: 150 }, // Sunlit leaves
            },
            'electric-storm': {
                name: 'Electric Storm',
                pattern: [3, 2, 4, 1], // Dynamic, energetic
                description: 'Channel lightning through your veins • Raw power',
                color: { r: 100, g: 150, b: 255 }, // Electric blue
                secondaryColor: { r: 200, g: 100, b: 255 }, // Purple lightning
                tertiaryColor: { r: 255, g: 255, b: 200 }, // Lightning white
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

        // Setup keyboard listener for info display
        this._setupKeyboardListener();

        // Show technique info briefly at start (selector is now in Serenity Hub)
        this._showTechniqueInfo(3000);

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
     * @param {boolean} showInfo - Whether to show the technique info (default: true)
     */
    setTechnique(techniqueName, showInfo = true) {
        if (this.techniques[techniqueName]) {
            this.currentTechnique = techniqueName;
            this.technique = this.techniques[techniqueName];
            this.pattern = this.technique.pattern;

            // Update UI
            this.techniqueName.textContent = this.technique.name;
            this.techniqueDesc.textContent = this.technique.description;
            this._updateSelectorButtons();

            // Show technique info briefly (selector is now in Serenity Hub)
            if (showInfo) {
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
     * Cycle to next or previous breathing technique
     * @param {number} direction - 1 for next, -1 for previous
     */
    cycleTechnique(direction = 1) {
        const techniqueKeys = Object.keys(this.techniques);
        const currentIndex = techniqueKeys.indexOf(this.currentTechnique);
        let newIndex = currentIndex + direction;

        // Wrap around
        if (newIndex < 0) newIndex = techniqueKeys.length - 1;
        if (newIndex >= techniqueKeys.length) newIndex = 0;

        this.setTechnique(techniqueKeys[newIndex], true);
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
            this._animateAuroraDreams(progress);
            break;
        case 'box-breathing':
            this._animateSacredGeometry(progress);
            break;
        case 'calm-sleep':
            this._animateMoonlitWaters(progress);
            break;
        case 'energizing':
            this._animateSolarFlare(progress);
            break;
        case 'coherence':
            this._animateHeartGlow(progress);
            break;
        case 'triangle':
            this._animateCrystalPrism(progress);
            break;
        case 'wim-hof':
            this._animateVolcanicFire(progress);
            break;
        case 'ocean-breath':
            this._animateOceanTide(progress);
            break;
        case 'zen-garden':
            this._animateZenGarden(progress);
            break;
        case 'cosmic-breath':
            this._animateCosmicNebula(progress);
            break;
            case 'forest-breath':
                this._animateAncientForest(progress);
                break;
            case 'electric-storm':
                this._animateElectricStorm(progress);
                break;
        default:
            this._animateAuroraDreams(progress);
        }
    }

    /**
     * 1. AURORA DREAMS - Flowing northern lights effect
     * @private
     */
    _animateAuroraDreams(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        // Calculate breath intensity
        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = this.currentPhase === 'hold1' ? 1 : 0.3;
        }

        // Draw flowing aurora curtains
        for (let layer = 0; layer < 5; layer++) {
            const layerOffset = layer * 0.3;
            const colors = [color, secondaryColor, tertiaryColor];
            const c = colors[layer % 3];
            
            ctx.beginPath();
            for (let x = 0; x < this.particleCanvas.width; x += 3) {
                const wave1 = Math.sin((x / 80) + time * 0.5 + layerOffset) * 60;
                const wave2 = Math.sin((x / 40) + time * 0.8 + layerOffset * 2) * 30;
                const wave3 = Math.sin((x / 120) + time * 0.3) * 40;
                const breathWave = Math.sin((x / 100) + time * 0.2) * 50 * intensity;
                
                const y = centerY - 100 + layer * 50 + wave1 + wave2 + wave3 + breathWave;
                
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            
            // Create gradient stroke
            const gradient = ctx.createLinearGradient(0, centerY - 200, 0, centerY + 200);
            gradient.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
            gradient.addColorStop(0.3, `rgba(${c.r}, ${c.g}, ${c.b}, ${0.4 * intensity})`);
            gradient.addColorStop(0.5, `rgba(${c.r}, ${c.g}, ${c.b}, ${0.6 * intensity})`);
            gradient.addColorStop(0.7, `rgba(${c.r}, ${c.g}, ${c.b}, ${0.4 * intensity})`);
            gradient.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
            
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 8 + layer * 2;
            ctx.lineCap = 'round';
            ctx.shadowBlur = 30;
            ctx.shadowColor = `rgba(${c.r}, ${c.g}, ${c.b}, ${0.8 * intensity})`;
            ctx.stroke();
        }

        // Add shimmering stars
        for (let i = 0; i < 30; i++) {
            const starX = (Math.sin(i * 7.3 + time * 0.1) * 0.5 + 0.5) * this.particleCanvas.width;
            const starY = (Math.cos(i * 5.7 + time * 0.15) * 0.5 + 0.5) * this.particleCanvas.height;
            const twinkle = Math.sin(time * 3 + i) * 0.5 + 0.5;
            
            const starGradient = ctx.createRadialGradient(starX, starY, 0, starX, starY, 4);
            starGradient.addColorStop(0, `rgba(255, 255, 255, ${twinkle * intensity * 0.8})`);
            starGradient.addColorStop(1, 'transparent');
            ctx.fillStyle = starGradient;
            ctx.beginPath();
            ctx.arc(starX, starY, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // Animate rings with aurora colors
        const scale = 0.3 + intensity * 0.7;
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${scale * 1.3})`;
        this.outerRing.style.opacity = intensity * 0.3;
        this.middleRing.style.transform = `translate(-50%, -50%) scale(${scale})`;
        this.middleRing.style.opacity = intensity * 0.5;
        this.innerRing.style.transform = `translate(-50%, -50%) scale(${scale * 0.7})`;
        this.innerRing.style.opacity = intensity * 0.7;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.5})`;
        this.coreCircle.style.opacity = intensity;
    }

    /**
     * 2. SACRED GEOMETRY - Morphing platonic solids and flower of life
     * @private
     */
    _animateSacredGeometry(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        // Calculate breath phase
        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = this.currentPhase === 'hold1' ? 1 : 0.3;
        }

        const baseSize = 80 + intensity * 120;
        const rotation = time * 0.2;

        ctx.save();
        ctx.translate(centerX, centerY);

        // Draw Flower of Life pattern
        const petalCount = 6;
        for (let ring = 0; ring < 3; ring++) {
            const ringRadius = baseSize * (ring + 1) * 0.4;
            const ringAlpha = (0.6 - ring * 0.15) * intensity;
            
            for (let i = 0; i < petalCount; i++) {
                const angle = (i / petalCount) * Math.PI * 2 + rotation + ring * 0.2;
                const cx = Math.cos(angle) * ringRadius;
                const cy = Math.sin(angle) * ringRadius;
                
                // Draw petal circle
                ctx.beginPath();
                ctx.arc(cx, cy, baseSize * 0.5, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${ringAlpha})`;
                ctx.lineWidth = 2;
                ctx.shadowBlur = 15;
                ctx.shadowColor = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${ringAlpha})`;
                ctx.stroke();
            }
        }

        // Draw central hexagon morphing to circle
        const morphProgress = Math.sin(time * 0.5) * 0.5 + 0.5;
        const sides = 6;
        ctx.beginPath();
        for (let i = 0; i <= sides; i++) {
            const angle = (i / sides) * Math.PI * 2 - Math.PI / 2 + rotation;
            const r = baseSize * 0.8;
            // Morph between hexagon and circle
            const hexX = Math.cos(angle) * r;
            const hexY = Math.sin(angle) * r;
            const circleAngle = (i / sides) * Math.PI * 2;
            const circleX = Math.cos(circleAngle - Math.PI / 2 + rotation) * r;
            const circleY = Math.sin(circleAngle - Math.PI / 2 + rotation) * r;
            const x = hexX * (1 - morphProgress) + circleX * morphProgress;
            const y = hexY * (1 - morphProgress) + circleY * morphProgress;
            
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${0.9 * intensity})`;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 25;
        ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`;
        ctx.stroke();

        // Draw inner rotating triangles
        for (let t = 0; t < 2; t++) {
            const triRotation = rotation * (t === 0 ? 1 : -1) + t * Math.PI / 6;
            const triSize = baseSize * 0.6;
            ctx.beginPath();
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2 - Math.PI / 2 + triRotation;
                const x = Math.cos(angle) * triSize;
                const y = Math.sin(angle) * triSize;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.strokeStyle = `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${0.7 * intensity})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Add golden ratio spiral particles
        for (let i = 0; i < 20; i++) {
            const goldenAngle = i * 2.399963; // Golden angle in radians
            const spiralR = Math.sqrt(i) * 15 * intensity;
            const px = Math.cos(goldenAngle + time) * spiralR;
            const py = Math.sin(goldenAngle + time) * spiralR;
            
            const gradient = ctx.createRadialGradient(px, py, 0, px, py, 8);
            gradient.addColorStop(0, `rgba(255, 255, 255, ${0.8 * intensity})`);
            gradient.addColorStop(0.5, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.5 * intensity})`);
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(px, py, 8, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();

        // Subtle ring animation
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${intensity * 1.2}) rotate(${rotation * 30}deg)`;
        this.outerRing.style.opacity = intensity * 0.2;
        this.middleRing.style.opacity = 0;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${intensity * 0.5})`;
        this.coreCircle.style.opacity = intensity;
    }

    /**
     * 3. MOONLIT WATERS - Dreamy moon reflection on water
     * @private
     */
    _animateMoonlitWaters(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        // Calculate breath intensity
        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = this.currentPhase === 'hold1' ? 1 : 0.3;
        }

        // Draw moon
        const moonY = centerY - 120 + Math.sin(time * 0.2) * 10;
        const moonRadius = 60 + intensity * 20;
        
        // Moon glow
        const moonGlow = ctx.createRadialGradient(centerX, moonY, moonRadius * 0.5, centerX, moonY, moonRadius * 3);
        moonGlow.addColorStop(0, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.4 * intensity})`);
        moonGlow.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.15 * intensity})`);
        moonGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = moonGlow;
        ctx.beginPath();
        ctx.arc(centerX, moonY, moonRadius * 3, 0, Math.PI * 2);
        ctx.fill();

        // Moon body
        const moonGradient = ctx.createRadialGradient(centerX - 15, moonY - 15, 0, centerX, moonY, moonRadius);
        moonGradient.addColorStop(0, `rgba(255, 255, 255, ${0.95 * intensity})`);
        moonGradient.addColorStop(0.5, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.9 * intensity})`);
        moonGradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.8 * intensity})`);
        ctx.fillStyle = moonGradient;
        ctx.beginPath();
        ctx.arc(centerX, moonY, moonRadius, 0, Math.PI * 2);
        ctx.fill();

        // Draw water surface with reflections
        const waterY = centerY + 80;
        for (let layer = 0; layer < 5; layer++) {
            ctx.beginPath();
            const layerY = waterY + layer * 30;
            const amplitude = (30 - layer * 5) * intensity;
            const alpha = (0.5 - layer * 0.08) * intensity;

            for (let x = 0; x < this.particleCanvas.width; x += 4) {
                const wave1 = Math.sin((x / 60) + time * 0.8 + layer * 0.5) * amplitude;
                const wave2 = Math.sin((x / 30) + time * 1.2 + layer) * amplitude * 0.5;
                const y = layerY + wave1 + wave2;

                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }

            const waveGradient = ctx.createLinearGradient(0, layerY - 30, 0, layerY + 30);
            waveGradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`);
            waveGradient.addColorStop(0.5, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${alpha * 0.8})`);
            waveGradient.addColorStop(1, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${alpha * 0.5})`);
            
            ctx.strokeStyle = waveGradient;
            ctx.lineWidth = 4;
            ctx.shadowBlur = 20;
            ctx.shadowColor = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${alpha})`;
            ctx.stroke();
        }

        // Moon reflection on water
        const reflectionY = waterY + 60;
        const reflectionGradient = ctx.createRadialGradient(centerX, reflectionY, 0, centerX, reflectionY, moonRadius * 2);
        reflectionGradient.addColorStop(0, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.4 * intensity})`);
        reflectionGradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.2 * intensity})`);
        reflectionGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = reflectionGradient;
        ctx.beginPath();
        ctx.ellipse(centerX, reflectionY, moonRadius * 1.5, moonRadius * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Floating stars
        for (let i = 0; i < 25; i++) {
            const starX = (Math.sin(i * 4.7 + time * 0.05) * 0.5 + 0.5) * this.particleCanvas.width;
            const starY = (Math.cos(i * 3.2) * 0.3 + 0.2) * this.particleCanvas.height;
            const twinkle = Math.sin(time * 2 + i * 1.5) * 0.5 + 0.5;
            
            ctx.fillStyle = `rgba(255, 255, 255, ${twinkle * intensity * 0.6})`;
            ctx.beginPath();
            ctx.arc(starX, starY, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Soft ring animation
        const scale = 0.3 + intensity * 0.7;
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${scale * 1.1})`;
        this.outerRing.style.opacity = intensity * 0.2;
        this.middleRing.style.opacity = 0;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.4})`;
        this.coreCircle.style.opacity = intensity * 0.6;
    }

    /**
     * 4. SOLAR FLARE - Explosive sun energy with plasma effects
     * @private
     */
    _animateSolarFlare(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        // Calculate burst intensity
        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = this.currentPhase === 'hold1' ? 1 : 0.3;
        }

        // Draw solar corona (outer glow)
        const coronaRadius = 180 * intensity;
        for (let ring = 0; ring < 4; ring++) {
            const ringRadius = coronaRadius * (1 + ring * 0.3);
            const ringAlpha = (0.3 - ring * 0.06) * intensity;
            
            const coronaGradient = ctx.createRadialGradient(centerX, centerY, ringRadius * 0.5, centerX, centerY, ringRadius);
            coronaGradient.addColorStop(0, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${ringAlpha})`);
            coronaGradient.addColorStop(0.7, `rgba(${color.r}, ${color.g}, ${color.b}, ${ringAlpha * 0.5})`);
            coronaGradient.addColorStop(1, 'transparent');
            ctx.fillStyle = coronaGradient;
            ctx.beginPath();
            ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw solar flares (plasma ejections)
        const flareCount = 12;
        for (let i = 0; i < flareCount; i++) {
            const baseAngle = (i / flareCount) * Math.PI * 2;
            const wobble = Math.sin(time * 3 + i * 2) * 0.2;
            const angle = baseAngle + wobble;
            const flareLength = (100 + Math.sin(time * 4 + i * 1.5) * 40) * intensity;
            const flareWidth = 15 + Math.sin(time * 5 + i) * 5;

            // Create curved flare path
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            
            const cp1x = centerX + Math.cos(angle + 0.2) * flareLength * 0.5;
            const cp1y = centerY + Math.sin(angle + 0.2) * flareLength * 0.5;
            const endX = centerX + Math.cos(angle) * flareLength;
            const endY = centerY + Math.sin(angle) * flareLength;
            
            ctx.quadraticCurveTo(cp1x, cp1y, endX, endY);
            
            const flareGradient = ctx.createLinearGradient(centerX, centerY, endX, endY);
            flareGradient.addColorStop(0, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.9 * intensity})`);
            flareGradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.6 * intensity})`);
            flareGradient.addColorStop(1, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, 0)`);
            
            ctx.strokeStyle = flareGradient;
            ctx.lineWidth = flareWidth;
            ctx.lineCap = 'round';
            ctx.shadowBlur = 20;
            ctx.shadowColor = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, 0.8)`;
            ctx.stroke();
        }

        // Draw sun core
        const coreRadius = 70 * intensity;
        const coreGradient = ctx.createRadialGradient(centerX - 10, centerY - 10, 0, centerX, centerY, coreRadius);
        coreGradient.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
        coreGradient.addColorStop(0.3, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.95 * intensity})`);
        coreGradient.addColorStop(0.7, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.9 * intensity})`);
        coreGradient.addColorStop(1, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${0.8 * intensity})`);
        ctx.fillStyle = coreGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
        ctx.shadowBlur = 40;
        ctx.shadowColor = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, 1)`;
        ctx.fill();

        // Add energy particles
        for (let i = 0; i < 30; i++) {
            const particleAngle = (i / 30) * Math.PI * 2 + time * 2;
            const particleDistance = 80 + Math.sin(time * 3 + i) * 30 + intensity * 80;
            const px = centerX + Math.cos(particleAngle) * particleDistance;
            const py = centerY + Math.sin(particleAngle) * particleDistance;
            const particleSize = 3 + Math.sin(time * 5 + i * 2) * 2;
            
            ctx.fillStyle = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.8 * intensity})`;
            ctx.beginPath();
            ctx.arc(px, py, particleSize, 0, Math.PI * 2);
            ctx.fill();
        }

        // Ring animations
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${intensity * 1.4})`;
        this.outerRing.style.opacity = intensity * 0.4;
        this.middleRing.style.transform = `translate(-50%, -50%) scale(${intensity * 1.1})`;
        this.middleRing.style.opacity = intensity * 0.3;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${intensity * 0.6})`;
        this.coreCircle.style.opacity = intensity;
    }

    /**
     * 5. HEART GLOW - Radiating heart with love particles
     * @private
     */
    _animateHeartGlow(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        // Calculate heartbeat pulse
        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = this.currentPhase === 'hold1' ? 1 : 0.4;
        }

        // Add extra heartbeat pulse effect
        const heartbeat = Math.sin(time * 4) * 0.1 + 1;
        const scale = (0.5 + intensity * 0.5) * heartbeat;

        // Draw heart shape
        const heartSize = 80 * scale;
        ctx.save();
        ctx.translate(centerX, centerY);

        // Heart path
        ctx.beginPath();
        ctx.moveTo(0, heartSize * 0.3);
        ctx.bezierCurveTo(
            -heartSize * 0.5, -heartSize * 0.3,
            -heartSize, heartSize * 0.1,
            0, heartSize
        );
        ctx.bezierCurveTo(
            heartSize, heartSize * 0.1,
            heartSize * 0.5, -heartSize * 0.3,
            0, heartSize * 0.3
        );

        // Heart gradient fill
        const heartGradient = ctx.createRadialGradient(0, heartSize * 0.3, 0, 0, heartSize * 0.3, heartSize * 1.5);
        heartGradient.addColorStop(0, `rgba(255, 255, 255, ${0.9 * intensity})`);
        heartGradient.addColorStop(0.3, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.8 * intensity})`);
        heartGradient.addColorStop(0.6, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.7 * intensity})`);
        heartGradient.addColorStop(1, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${0.4 * intensity})`);
        
        ctx.fillStyle = heartGradient;
        ctx.shadowBlur = 40;
        ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, ${0.8 * intensity})`;
        ctx.fill();

        ctx.restore();

        // Draw radiating love waves
        for (let wave = 0; wave < 4; wave++) {
            const waveProgress = ((time * 0.5 + wave * 0.25) % 1);
            const waveRadius = 50 + waveProgress * 200;
            const waveAlpha = (1 - waveProgress) * 0.4 * intensity;

            ctx.beginPath();
            ctx.arc(centerX, centerY, waveRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${waveAlpha})`;
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        // Draw floating heart particles
        for (let i = 0; i < 20; i++) {
            const particleTime = time + i * 0.5;
            const floatProgress = (particleTime % 3) / 3;
            const angle = (i / 20) * Math.PI * 2 + Math.sin(time + i) * 0.3;
            const distance = 100 + floatProgress * 150;
            const px = centerX + Math.cos(angle) * distance;
            const py = centerY + Math.sin(angle) * distance - floatProgress * 50;
            const particleAlpha = (1 - floatProgress) * intensity * 0.6;
            const particleSize = 8 * (1 - floatProgress * 0.5);

            // Mini heart shape
            ctx.save();
            ctx.translate(px, py);
            ctx.scale(particleSize / 20, particleSize / 20);
            ctx.beginPath();
            ctx.moveTo(0, 3);
            ctx.bezierCurveTo(-5, -3, -10, 1, 0, 10);
            ctx.bezierCurveTo(10, 1, 5, -3, 0, 3);
            ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${particleAlpha})`;
            ctx.fill();
            ctx.restore();
        }

        // Draw coherence sine wave
        ctx.beginPath();
        for (let x = 0; x < this.particleCanvas.width; x += 4) {
            const waveY = centerY + 150 + Math.sin((x / 50) + time * 2) * 30 * intensity;
            if (x === 0) ctx.moveTo(x, waveY);
            else ctx.lineTo(x, waveY);
        }
        ctx.strokeStyle = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.4 * intensity})`;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 10;
        ctx.shadowColor = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, 0.6)`;
        ctx.stroke();

        // Ring animations
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${scale * 1.3})`;
        this.outerRing.style.opacity = intensity * 0.3;
        this.middleRing.style.transform = `translate(-50%, -50%) scale(${scale})`;
        this.middleRing.style.opacity = intensity * 0.4;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.5})`;
        this.coreCircle.style.opacity = intensity * 0.8;
    }

    /**
     * 6. CRYSTAL PRISM - Light refracting through crystal
     * @private
     */
    _animateCrystalPrism(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        // Calculate intensity
        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = this.currentPhase === 'hold1' ? 1 : 0.4;
        }

        const prismSize = 120 * (0.6 + intensity * 0.4);
        const rotation = time * 0.3;

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(rotation);

        // Draw main prism (3D effect)
        const prismPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 - Math.PI / 2;
            prismPoints.push({
                x: Math.cos(angle) * prismSize,
                y: Math.sin(angle) * prismSize,
            });
        }

        // Draw prism faces with gradient
        ctx.beginPath();
        ctx.moveTo(prismPoints[0].x, prismPoints[0].y);
        for (let i = 1; i < 3; i++) {
            ctx.lineTo(prismPoints[i].x, prismPoints[i].y);
        }
        ctx.closePath();

        const prismGradient = ctx.createLinearGradient(-prismSize, -prismSize, prismSize, prismSize);
        prismGradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.3 * intensity})`);
        prismGradient.addColorStop(0.5, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.4 * intensity})`);
        prismGradient.addColorStop(1, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${0.3 * intensity})`);
        ctx.fillStyle = prismGradient;
        ctx.fill();

        ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * intensity})`;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 20;
        ctx.shadowColor = `rgba(255, 255, 255, ${0.6 * intensity})`;
        ctx.stroke();

        ctx.restore();

        // Draw light beam entering prism
        const beamStartX = centerX - 250;
        const beamEndX = centerX - 50;
        ctx.beginPath();
        ctx.moveTo(beamStartX, centerY);
        ctx.lineTo(beamEndX, centerY);
        const beamGradient = ctx.createLinearGradient(beamStartX, centerY, beamEndX, centerY);
        beamGradient.addColorStop(0, 'transparent');
        beamGradient.addColorStop(0.5, `rgba(255, 255, 255, ${0.6 * intensity})`);
        beamGradient.addColorStop(1, `rgba(255, 255, 255, ${0.8 * intensity})`);
        ctx.strokeStyle = beamGradient;
        ctx.lineWidth = 8;
        ctx.shadowBlur = 15;
        ctx.shadowColor = `rgba(255, 255, 255, 0.8)`;
        ctx.stroke();

        // Draw refracted rainbow beams
        const rainbowColors = [
            { r: 255, g: 100, b: 100 }, // Red
            { r: 255, g: 180, b: 100 }, // Orange
            { r: 255, g: 255, b: 100 }, // Yellow
            { r: 100, g: 255, b: 100 }, // Green
            { r: 100, g: 200, b: 255 }, // Cyan
            { r: 150, g: 100, b: 255 }, // Blue
            { r: 200, g: 100, b: 255 }, // Violet
        ];

        for (let i = 0; i < rainbowColors.length; i++) {
            const beamAngle = -0.3 + (i / rainbowColors.length) * 0.6;
            const beamLength = 200 * intensity;
            const startX = centerX + 50;
            const startY = centerY;
            const endX = startX + Math.cos(beamAngle) * beamLength;
            const endY = startY + Math.sin(beamAngle) * beamLength;
            
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            
            const rc = rainbowColors[i];
            const rainbowGradient = ctx.createLinearGradient(startX, startY, endX, endY);
            rainbowGradient.addColorStop(0, `rgba(${rc.r}, ${rc.g}, ${rc.b}, ${0.8 * intensity})`);
            rainbowGradient.addColorStop(1, `rgba(${rc.r}, ${rc.g}, ${rc.b}, 0)`);
            
            ctx.strokeStyle = rainbowGradient;
            ctx.lineWidth = 6;
            ctx.shadowBlur = 15;
            ctx.shadowColor = `rgba(${rc.r}, ${rc.g}, ${rc.b}, 0.8)`;
            ctx.stroke();
        }

        // Add sparkle particles
        for (let i = 0; i < 25; i++) {
            const sparkleX = centerX + (Math.sin(i * 5.3 + time) * 0.5 + 0.5) * 300 - 100;
            const sparkleY = centerY + (Math.cos(i * 3.7 + time * 0.8) * 0.5) * 150;
            const twinkle = Math.sin(time * 4 + i * 2) * 0.5 + 0.5;
            const sparkleColor = rainbowColors[i % rainbowColors.length];
            
            const sparkleGradient = ctx.createRadialGradient(sparkleX, sparkleY, 0, sparkleX, sparkleY, 6);
            sparkleGradient.addColorStop(0, `rgba(255, 255, 255, ${twinkle * intensity})`);
            sparkleGradient.addColorStop(0.5, `rgba(${sparkleColor.r}, ${sparkleColor.g}, ${sparkleColor.b}, ${twinkle * intensity * 0.6})`);
            sparkleGradient.addColorStop(1, 'transparent');
            ctx.fillStyle = sparkleGradient;
            ctx.beginPath();
            ctx.arc(sparkleX, sparkleY, 6, 0, Math.PI * 2);
            ctx.fill();
        }

        // Ring animations
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${intensity * 1.2}) rotate(${rotation * 30}deg)`;
        this.outerRing.style.opacity = intensity * 0.2;
        this.middleRing.style.opacity = 0;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${intensity * 0.5})`;
        this.coreCircle.style.opacity = intensity * 0.8;
    }

    /**
     * 7. VOLCANIC FIRE - Molten lava eruption with ember particles
     * @private
     */
    _animateVolcanicFire(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        // Fast, intense breathing - more dramatic
        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else {
            intensity = 1 - this._easeInOutQuart(progress) * 0.7; // Keep some intensity during exhale
        }

        // Draw volcanic glow from below
        const lavaGlow = ctx.createRadialGradient(centerX, centerY + 100, 0, centerX, centerY + 100, 300);
        lavaGlow.addColorStop(0, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.4 * intensity})`);
        lavaGlow.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.2 * intensity})`);
        lavaGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = lavaGlow;
        ctx.fillRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        // Draw rising fire columns
        for (let col = 0; col < 5; col++) {
            const colX = centerX + (col - 2) * 60;
            const colHeight = 150 + Math.sin(time * 4 + col) * 50;
            
            for (let y = 0; y < colHeight * intensity; y += 10) {
                const flicker = Math.sin(time * 8 + y * 0.1 + col) * 15;
                const fx = colX + flicker;
                const fy = centerY + 50 - y;
                const flameSize = 20 * (1 - y / (colHeight * intensity)) * intensity;
                
                if (flameSize > 0) {
                    const flameGradient = ctx.createRadialGradient(fx, fy, 0, fx, fy, flameSize);
                    const yRatio = y / (colHeight * intensity);
                    
                    if (yRatio < 0.3) {
                        // Base - white hot
                        flameGradient.addColorStop(0, `rgba(255, 255, 255, ${0.9 * intensity})`);
                        flameGradient.addColorStop(0.5, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.7 * intensity})`);
                    } else if (yRatio < 0.6) {
                        // Middle - orange
                        flameGradient.addColorStop(0, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.8 * intensity})`);
                        flameGradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.6 * intensity})`);
                    } else {
                        // Top - deep red
                        flameGradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.7 * intensity})`);
                        flameGradient.addColorStop(0.5, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${0.4 * intensity})`);
                    }
                    flameGradient.addColorStop(1, 'transparent');
                    
                    ctx.fillStyle = flameGradient;
                    ctx.beginPath();
                    ctx.arc(fx, fy, flameSize, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // Draw ember particles rising
        for (let i = 0; i < 40; i++) {
            const emberTime = (time + i * 0.3) % 4;
            const emberProgress = emberTime / 4;
            const startX = centerX + (Math.sin(i * 3.7) * 100);
            const drift = Math.sin(time * 2 + i) * 30;
            const emberX = startX + drift;
            const emberY = centerY + 100 - emberProgress * 350;
            const emberAlpha = (1 - emberProgress) * intensity;
            const emberSize = 4 + Math.sin(time * 5 + i) * 2;
            
            if (emberAlpha > 0) {
                const emberGradient = ctx.createRadialGradient(emberX, emberY, 0, emberX, emberY, emberSize);
                emberGradient.addColorStop(0, `rgba(255, 255, 200, ${emberAlpha})`);
                emberGradient.addColorStop(0.5, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${emberAlpha * 0.8})`);
                emberGradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
                ctx.fillStyle = emberGradient;
                ctx.beginPath();
                ctx.arc(emberX, emberY, emberSize, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Draw central molten core
        const coreRadius = 60 + Math.sin(time * 6) * 10;
        const coreGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius * intensity);
        coreGradient.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
        coreGradient.addColorStop(0.2, `rgba(255, 255, 200, ${0.95 * intensity})`);
        coreGradient.addColorStop(0.4, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.9 * intensity})`);
        coreGradient.addColorStop(0.7, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.8 * intensity})`);
        coreGradient.addColorStop(1, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${0.5 * intensity})`);
        ctx.fillStyle = coreGradient;
        ctx.shadowBlur = 50;
        ctx.shadowColor = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, 1)`;
        ctx.beginPath();
        ctx.arc(centerX, centerY, coreRadius * intensity, 0, Math.PI * 2);
        ctx.fill();

        // Ring animations
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${intensity * 1.5})`;
        this.outerRing.style.opacity = intensity * 0.5;
        this.middleRing.style.transform = `translate(-50%, -50%) scale(${intensity * 1.2})`;
        this.middleRing.style.opacity = intensity * 0.4;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${intensity * 0.7})`;
        this.coreCircle.style.opacity = intensity;
    }

    /**
     * 8. OCEAN TIDE - Waves crashing and receding
     * @private
     */
    _animateOceanTide(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = 0.5;
        }

        // Draw ocean depth gradient as a large ellipse (no square edges)
        const depthGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 400);
        depthGradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.3 * intensity})`);
        depthGradient.addColorStop(0.5, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${0.2 * intensity})`);
        depthGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = depthGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 400, 0, Math.PI * 2);
        ctx.fill();

        // Draw multiple wave layers
        for (let layer = 0; layer < 6; layer++) {
            const baseY = centerY + (layer - 3) * 50;
            const amplitude = (40 - layer * 5) * intensity;
            const speed = 1 + layer * 0.2;
            const alpha = (0.6 - layer * 0.08) * intensity;

            ctx.beginPath();
            for (let x = 0; x < this.particleCanvas.width; x += 3) {
                const wave1 = Math.sin((x / 80) + time * speed) * amplitude;
                const wave2 = Math.sin((x / 40) + time * speed * 1.3 + layer) * amplitude * 0.4;
                const wave3 = Math.sin((x / 120) + time * speed * 0.7) * amplitude * 0.3;
                const y = baseY + wave1 + wave2 + wave3;

                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }

            ctx.strokeStyle = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${alpha})`;
            ctx.lineWidth = 4;
            ctx.shadowBlur = 15;
            ctx.shadowColor = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${alpha})`;
            ctx.stroke();
        }

        // Add foam/bubble particles
        for (let i = 0; i < 30; i++) {
            const bubbleTime = (time + i * 0.2) % 3;
            const bubbleProgress = bubbleTime / 3;
            const bubbleX = centerX + (Math.sin(i * 4.3) - 0.5) * 300;
            const bubbleY = centerY + 100 - bubbleProgress * 200;
            const bubbleAlpha = (1 - bubbleProgress) * intensity * 0.6;
            const bubbleSize = 3 + Math.sin(time * 3 + i) * 2;

            ctx.fillStyle = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${bubbleAlpha})`;
            ctx.beginPath();
            ctx.arc(bubbleX, bubbleY, bubbleSize, 0, Math.PI * 2);
            ctx.fill();
        }

        // Ring animations
        const scale = 0.4 + intensity * 0.6;
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${scale * 1.2})`;
        this.outerRing.style.opacity = intensity * 0.3;
        this.middleRing.style.transform = `translate(-50%, -50%) scale(${scale})`;
        this.middleRing.style.opacity = intensity * 0.4;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.5})`;
        this.coreCircle.style.opacity = intensity * 0.7;
    }

    /**
     * 9. ZEN GARDEN - Ripples on still water with stones
     * @private
     */
    _animateZenGarden(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = this.currentPhase === 'hold1' ? 1 : 0.3;
        }

        // Draw sand texture background as circular gradient (no square)
        const sandGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 350);
        sandGradient.addColorStop(0, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.15 * intensity})`);
        sandGradient.addColorStop(0.7, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${0.1 * intensity})`);
        sandGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = sandGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 350, 0, Math.PI * 2);
        ctx.fill();

        // Draw expanding ripples from center
        for (let ripple = 0; ripple < 8; ripple++) {
            const rippleTime = (time * 0.3 + ripple * 0.15) % 1;
            const rippleRadius = 30 + rippleTime * 250;
            const rippleAlpha = (1 - rippleTime) * 0.5 * intensity;

            ctx.beginPath();
            ctx.arc(centerX, centerY, rippleRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${rippleAlpha})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Draw zen stones
        const stones = [
            { x: centerX - 80, y: centerY - 40, size: 25 },
            { x: centerX + 60, y: centerY + 30, size: 20 },
            { x: centerX - 30, y: centerY + 60, size: 15 },
        ];

        stones.forEach((stone) => {
            // Stone shadow
            ctx.fillStyle = `rgba(0, 0, 0, ${0.2 * intensity})`;
            ctx.beginPath();
            ctx.ellipse(stone.x + 5, stone.y + 5, stone.size * 1.2, stone.size * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();

            // Stone body
            const stoneGradient = ctx.createRadialGradient(
                stone.x - stone.size * 0.3, stone.y - stone.size * 0.3, 0,
                stone.x, stone.y, stone.size
            );
            stoneGradient.addColorStop(0, `rgba(${tertiaryColor.r + 50}, ${tertiaryColor.g + 50}, ${tertiaryColor.b + 50}, ${0.9 * intensity})`);
            stoneGradient.addColorStop(0.7, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${0.8 * intensity})`);
            stoneGradient.addColorStop(1, `rgba(${tertiaryColor.r - 30}, ${tertiaryColor.g - 30}, ${tertiaryColor.b - 30}, ${0.7 * intensity})`);
            ctx.fillStyle = stoneGradient;
            ctx.beginPath();
            ctx.ellipse(stone.x, stone.y, stone.size, stone.size * 0.7, 0, 0, Math.PI * 2);
            ctx.fill();
        });

        // Draw raked sand lines (circular, not dashed to avoid artifacts)
        for (let line = 0; line < 10; line++) {
            const lineRadius = 100 + line * 25;
            if (lineRadius < 280) {
                ctx.beginPath();
                ctx.arc(centerX, centerY, lineRadius, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${0.12 * intensity})`;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        // Floating dust particles
        for (let i = 0; i < 15; i++) {
            const dustX = centerX + Math.sin(time * 0.5 + i * 2) * 150;
            const dustY = centerY + Math.cos(time * 0.3 + i * 1.5) * 100;
            const dustAlpha = (Math.sin(time + i) * 0.3 + 0.4) * intensity;

            ctx.fillStyle = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${dustAlpha})`;
            ctx.beginPath();
            ctx.arc(dustX, dustY, 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Ring animations - very subtle
        const scale = 0.5 + intensity * 0.5;
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${scale * 1.1})`;
        this.outerRing.style.opacity = intensity * 0.15;
        this.middleRing.style.opacity = 0;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.4})`;
        this.coreCircle.style.opacity = intensity * 0.5;
    }

    /**
     * 10. COSMIC NEBULA - Spinning galaxy with stars being born
     * @private
     */
    _animateCosmicNebula(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = this.currentPhase === 'hold1' ? 1 : 0.4;
        }

        // Spinning rotation - this is the key rotation value
        const spinAngle = time * 0.4; // Full rotation every ~15 seconds

        // Draw nebula gas clouds with distinct positions that spin
        for (let cloud = 0; cloud < 6; cloud++) {
            // Each cloud has a unique offset so rotation is visible
            const baseAngle = (cloud / 6) * Math.PI * 2;
            const cloudAngle = baseAngle + spinAngle; // ADD spin to angle
            const cloudDist = 100 + (cloud % 3) * 40;
            const cloudX = centerX + Math.cos(cloudAngle) * cloudDist * intensity;
            const cloudY = centerY + Math.sin(cloudAngle) * cloudDist * intensity;
            const cloudSize = 60 + (cloud % 2) * 30 + Math.sin(time * 0.5 + cloud) * 15;

            const colors = [color, secondaryColor, tertiaryColor];
            const c = colors[cloud % 3];

            const cloudGradient = ctx.createRadialGradient(cloudX, cloudY, 0, cloudX, cloudY, cloudSize);
            cloudGradient.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, ${0.4 * intensity})`);
            cloudGradient.addColorStop(0.5, `rgba(${c.r}, ${c.g}, ${c.b}, ${0.2 * intensity})`);
            cloudGradient.addColorStop(1, 'transparent');
            ctx.fillStyle = cloudGradient;
            ctx.beginPath();
            ctx.arc(cloudX, cloudY, cloudSize, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw spinning spiral arms - the spin is built into the angle calculation
        for (let arm = 0; arm < 3; arm++) {
            ctx.beginPath();
            for (let t = 0; t < 4; t += 0.02) {
                const spiralR = 15 + t * 60 * intensity;
                // Add spinAngle to make arms rotate!
                const spiralAngle = t * 2.5 + arm * (Math.PI * 2 / 3) + spinAngle;
                const x = centerX + Math.cos(spiralAngle) * spiralR;
                const y = centerY + Math.sin(spiralAngle) * spiralR;

                if (t === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            
            const armColors = [secondaryColor, color, tertiaryColor];
            const ac = armColors[arm];
            ctx.strokeStyle = `rgba(${ac.r}, ${ac.g}, ${ac.b}, ${0.6 * intensity})`;
            ctx.lineWidth = 18;
            ctx.lineCap = 'round';
            ctx.shadowBlur = 25;
            ctx.shadowColor = `rgba(${ac.r}, ${ac.g}, ${ac.b}, 0.8)`;
            ctx.stroke();
        }

        // Draw stars along spiral arms - they spin with the arms
        for (let i = 0; i < 100; i++) {
            const starT = (i / 100) * 4;
            const armIndex = i % 3;
            // Add spinAngle to make stars rotate with the galaxy!
            const spiralAngle = starT * 2.5 + armIndex * (Math.PI * 2 / 3) + spinAngle + Math.sin(i * 0.5) * 0.2;
            const spiralR = 15 + starT * 60 * intensity + Math.sin(i * 2) * 12;
            const starX = centerX + Math.cos(spiralAngle) * spiralR;
            const starY = centerY + Math.sin(spiralAngle) * spiralR;
            const twinkle = Math.sin(time * 5 + i * 1.3) * 0.5 + 0.5;
            const starSize = 1.5 + twinkle * 2.5;

            const starGradient = ctx.createRadialGradient(starX, starY, 0, starX, starY, starSize * 2);
            starGradient.addColorStop(0, `rgba(255, 255, 255, ${twinkle * intensity})`);
            starGradient.addColorStop(0.5, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${twinkle * intensity * 0.4})`);
            starGradient.addColorStop(1, 'transparent');
            ctx.fillStyle = starGradient;
            ctx.beginPath();
            ctx.arc(starX, starY, starSize * 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Add some outer orbiting bright stars for extra spin visibility
        for (let i = 0; i < 12; i++) {
            const orbitAngle = (i / 12) * Math.PI * 2 + spinAngle * 1.2; // Slightly faster spin
            const orbitDist = 180 + (i % 3) * 30;
            const starX = centerX + Math.cos(orbitAngle) * orbitDist * intensity;
            const starY = centerY + Math.sin(orbitAngle) * orbitDist * intensity;
            const brightness = Math.sin(time * 3 + i * 2) * 0.3 + 0.7;
            
            ctx.fillStyle = `rgba(255, 255, 255, ${brightness * intensity * 0.8})`;
            ctx.shadowBlur = 15;
            ctx.shadowColor = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${brightness * intensity})`;
            ctx.beginPath();
            ctx.arc(starX, starY, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Central bright core (stationary, pulsing)
        const corePulse = Math.sin(time * 2) * 0.1 + 1;
        const coreRadius = 45 * intensity * corePulse;
        const coreGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius);
        coreGradient.addColorStop(0, `rgba(255, 255, 255, ${0.95 * intensity})`);
        coreGradient.addColorStop(0.2, `rgba(255, 240, 220, ${0.8 * intensity})`);
        coreGradient.addColorStop(0.4, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.6 * intensity})`);
        coreGradient.addColorStop(0.7, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.3 * intensity})`);
        coreGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = coreGradient;
        ctx.shadowBlur = 40;
        ctx.shadowColor = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, 0.8)`;
        ctx.beginPath();
        ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
        ctx.fill();

        // Ring animations (spinning opposite direction)
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${intensity * 1.3}) rotate(${-time * 30}deg)`;
        this.outerRing.style.opacity = intensity * 0.2;
        this.middleRing.style.transform = `translate(-50%, -50%) scale(${intensity}) rotate(${time * 40}deg)`;
        this.middleRing.style.opacity = intensity * 0.25;
        this.innerRing.style.transform = `translate(-50%, -50%) scale(${intensity * 0.7}) rotate(${-time * 50}deg)`;
        this.innerRing.style.opacity = intensity * 0.3;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${intensity * 0.5})`;
        this.coreCircle.style.opacity = intensity * 0.9;
    }

    /**
     * 11. ANCIENT FOREST - Mystical trees with bioluminescent elements
     * @private
     */
    _animateAncientForest(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = this.currentPhase === 'hold1' ? 1 : 0.4;
        }

        // Draw mystical forest glow background
        const forestGlow = ctx.createRadialGradient(centerX, centerY + 50, 0, centerX, centerY, 350);
        forestGlow.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.15 * intensity})`);
        forestGlow.addColorStop(0.5, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${0.1 * intensity})`);
        forestGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = forestGlow;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 350, 0, Math.PI * 2);
        ctx.fill();

        // Draw ethereal light rays from above
        for (let ray = 0; ray < 6; ray++) {
            const rayX = centerX + (ray - 2.5) * 80;
            const rayWobble = Math.sin(time * 0.5 + ray) * 20;
            const rayAlpha = (0.2 + Math.sin(time * 0.8 + ray * 0.5) * 0.1) * intensity;

            ctx.beginPath();
            ctx.moveTo(rayX + rayWobble, 0);
            ctx.lineTo(rayX - 30 + rayWobble, centerY + 200);
            ctx.lineTo(rayX + 30 + rayWobble, centerY + 200);
            ctx.closePath();

            const rayGradient = ctx.createLinearGradient(rayX, 0, rayX, centerY + 200);
            rayGradient.addColorStop(0, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${rayAlpha})`);
            rayGradient.addColorStop(0.6, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${rayAlpha * 0.3})`);
            rayGradient.addColorStop(1, 'transparent');
            ctx.fillStyle = rayGradient;
            ctx.fill();
        }

        // Draw ancient tree of life (central, breathing)
        const treeScale = 0.8 + intensity * 0.2;
        const trunkHeight = 180 * treeScale;
        const trunkWidth = 25 * treeScale;
        
        // Tree trunk with texture
        const trunkGradient = ctx.createLinearGradient(centerX - trunkWidth, 0, centerX + trunkWidth, 0);
        trunkGradient.addColorStop(0, `rgba(${secondaryColor.r - 20}, ${secondaryColor.g - 20}, ${secondaryColor.b - 20}, ${0.8 * intensity})`);
        trunkGradient.addColorStop(0.3, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.9 * intensity})`);
        trunkGradient.addColorStop(0.7, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.9 * intensity})`);
        trunkGradient.addColorStop(1, `rgba(${secondaryColor.r - 20}, ${secondaryColor.g - 20}, ${secondaryColor.b - 20}, ${0.8 * intensity})`);
        
        ctx.fillStyle = trunkGradient;
        ctx.beginPath();
        ctx.moveTo(centerX - trunkWidth, centerY + 150);
        ctx.lineTo(centerX - trunkWidth * 0.6, centerY + 150 - trunkHeight);
        ctx.lineTo(centerX + trunkWidth * 0.6, centerY + 150 - trunkHeight);
        ctx.lineTo(centerX + trunkWidth, centerY + 150);
        ctx.closePath();
        ctx.fill();

        // Draw branches with leaves
        const branchCount = 8;
        for (let b = 0; b < branchCount; b++) {
            const branchY = centerY + 150 - trunkHeight * 0.3 - b * 20;
            const branchSide = b % 2 === 0 ? 1 : -1;
            const branchLength = (80 + b * 10) * treeScale;
            const branchAngle = branchSide * (0.4 + b * 0.05);
            const sway = Math.sin(time * 1.2 + b * 0.5) * 5;

            const endX = centerX + Math.cos(branchAngle) * branchLength * branchSide + sway;
            const endY = branchY - Math.sin(Math.abs(branchAngle)) * branchLength * 0.3;

            // Branch
            ctx.beginPath();
            ctx.moveTo(centerX, branchY);
            ctx.quadraticCurveTo(
                centerX + branchLength * 0.5 * branchSide,
                branchY - 10,
                endX,
                endY
            );
            ctx.strokeStyle = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.7 * intensity})`;
            ctx.lineWidth = 3;
            ctx.stroke();

            // Leaf clusters at branch ends
            for (let leaf = 0; leaf < 5; leaf++) {
                const leafAngle = (leaf / 5) * Math.PI * 2;
                const leafDist = 15 + Math.sin(time + b + leaf) * 5;
                const leafX = endX + Math.cos(leafAngle) * leafDist;
                const leafY = endY + Math.sin(leafAngle) * leafDist * 0.6;
                const leafSize = 12 + Math.sin(time * 2 + leaf) * 3;

                const leafGradient = ctx.createRadialGradient(leafX, leafY, 0, leafX, leafY, leafSize);
                leafGradient.addColorStop(0, `rgba(${color.r + 30}, ${color.g + 30}, ${color.b}, ${0.8 * intensity})`);
                leafGradient.addColorStop(0.7, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.5 * intensity})`);
                leafGradient.addColorStop(1, 'transparent');
                ctx.fillStyle = leafGradient;
                ctx.beginPath();
                ctx.arc(leafX, leafY, leafSize, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Draw tree crown (top foliage)
        for (let crown = 0; crown < 4; crown++) {
            const crownY = centerY + 150 - trunkHeight - crown * 25;
            const crownWidth = (70 - crown * 10) * treeScale;
            const crownSway = Math.sin(time * 1.5 + crown) * 8;

            const crownGradient = ctx.createRadialGradient(
                centerX + crownSway, crownY, 0,
                centerX + crownSway, crownY, crownWidth
            );
            crownGradient.addColorStop(0, `rgba(${color.r + 40}, ${color.g + 40}, ${color.b}, ${0.7 * intensity})`);
            crownGradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.5 * intensity})`);
            crownGradient.addColorStop(1, 'transparent');
            ctx.fillStyle = crownGradient;
            ctx.beginPath();
            ctx.ellipse(centerX + crownSway, crownY, crownWidth, crownWidth * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw floating magical particles (pollen/spores)
        for (let i = 0; i < 35; i++) {
            const particleTime = (time * 0.5 + i * 0.3) % 4;
            const particleProgress = particleTime / 4;
            const startX = centerX + (Math.sin(i * 2.7) - 0.5) * 250;
            const particleX = startX + Math.sin(time + i) * 40;
            const particleY = centerY + 200 - particleProgress * 400;
            const particleAlpha = Math.sin(particleProgress * Math.PI) * intensity * 0.8;
            const particleSize = 3 + Math.sin(time * 3 + i) * 2;

            if (particleAlpha > 0) {
                const particleGradient = ctx.createRadialGradient(particleX, particleY, 0, particleX, particleY, particleSize * 3);
                particleGradient.addColorStop(0, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${particleAlpha})`);
                particleGradient.addColorStop(0.5, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${particleAlpha * 0.4})`);
                particleGradient.addColorStop(1, 'transparent');
                ctx.fillStyle = particleGradient;
                ctx.beginPath();
                ctx.arc(particleX, particleY, particleSize * 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Draw bioluminescent fireflies
        for (let i = 0; i < 15; i++) {
            const fireflyX = centerX + Math.sin(time * 0.7 + i * 2.1) * 200;
            const fireflyY = centerY + Math.cos(time * 0.5 + i * 1.8) * 150;
            const glow = Math.sin(time * 4 + i * 2.5) * 0.5 + 0.5;
            const fireflySize = 6 + glow * 4;

            const fireflyGradient = ctx.createRadialGradient(fireflyX, fireflyY, 0, fireflyX, fireflyY, fireflySize);
            fireflyGradient.addColorStop(0, `rgba(${tertiaryColor.r + 50}, ${tertiaryColor.g + 50}, ${tertiaryColor.b}, ${glow * intensity})`);
            fireflyGradient.addColorStop(0.4, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${glow * intensity * 0.5})`);
            fireflyGradient.addColorStop(1, 'transparent');
            ctx.fillStyle = fireflyGradient;
            ctx.beginPath();
            ctx.arc(fireflyX, fireflyY, fireflySize, 0, Math.PI * 2);
            ctx.fill();
        }

        // Ring animations - subtle forest glow
        const scale = 0.4 + intensity * 0.6;
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${scale * 1.2})`;
        this.outerRing.style.opacity = intensity * 0.15;
        this.middleRing.style.transform = `translate(-50%, -50%) scale(${scale})`;
        this.middleRing.style.opacity = intensity * 0.2;
        this.innerRing.style.opacity = 0;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.4})`;
        this.coreCircle.style.opacity = intensity * 0.5;
    }

    /**
     * 12. ELECTRIC STORM - Lightning bolts and crackling energy
     * @private
     */
    _animateElectricStorm(progress) {
        const ctx = this.particleCtx;
        const centerX = this.particleCanvas.width / 2;
        const centerY = this.particleCanvas.height / 2;
        const { color, secondaryColor, tertiaryColor } = this.technique;
        const time = Date.now() / 1000;

        ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

        let intensity;
        if (this.currentPhase === 'inhale') {
            intensity = this._easeInOutQuart(progress);
        } else if (this.currentPhase === 'exhale') {
            intensity = 1 - this._easeInOutQuart(progress);
        } else {
            intensity = this.currentPhase === 'hold1' ? 1 : 0.5;
        }

        // Storm cloud background
        const stormGradient = ctx.createRadialGradient(centerX, centerY - 50, 0, centerX, centerY, 400);
        stormGradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.2 * intensity})`);
        stormGradient.addColorStop(0.4, `rgba(${secondaryColor.r * 0.3}, ${secondaryColor.g * 0.3}, ${secondaryColor.b * 0.3}, ${0.15 * intensity})`);
        stormGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = stormGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 400, 0, Math.PI * 2);
        ctx.fill();

        // Draw swirling storm clouds
        for (let cloud = 0; cloud < 6; cloud++) {
            const cloudAngle = (cloud / 6) * Math.PI * 2 + time * 0.3;
            const cloudDist = 120 + cloud * 20;
            const cloudX = centerX + Math.cos(cloudAngle) * cloudDist * intensity;
            const cloudY = centerY + Math.sin(cloudAngle) * cloudDist * 0.6 * intensity;
            const cloudSize = 80 + Math.sin(time * 2 + cloud) * 20;

            const cloudGradient = ctx.createRadialGradient(cloudX, cloudY, 0, cloudX, cloudY, cloudSize);
            cloudGradient.addColorStop(0, `rgba(${secondaryColor.r * 0.4}, ${secondaryColor.g * 0.4}, ${secondaryColor.b * 0.5}, ${0.4 * intensity})`);
            cloudGradient.addColorStop(0.6, `rgba(${color.r * 0.3}, ${color.g * 0.3}, ${color.b * 0.4}, ${0.2 * intensity})`);
            cloudGradient.addColorStop(1, 'transparent');
            ctx.fillStyle = cloudGradient;
            ctx.beginPath();
            ctx.arc(cloudX, cloudY, cloudSize, 0, Math.PI * 2);
            ctx.fill();
        }

        // Lightning bolt generation function
        const drawLightning = (startX, startY, endX, endY, branches, alpha, width) => {
            ctx.beginPath();
            ctx.moveTo(startX, startY);

            let x = startX;
            let y = startY;
            const dx = (endX - startX);
            const dy = (endY - startY);
            const segments = 8 + Math.floor(Math.random() * 4);

            for (let i = 1; i <= segments; i++) {
                const t = i / segments;
                const targetX = startX + dx * t;
                const targetY = startY + dy * t;
                const jitter = (1 - t) * 40 * intensity;
                x = targetX + (Math.random() - 0.5) * jitter;
                y = targetY + (Math.random() - 0.5) * jitter * 0.5;
                ctx.lineTo(x, y);

                // Create branches
                if (branches > 0 && Math.random() > 0.7 && i < segments - 1) {
                    const branchAngle = (Math.random() - 0.5) * Math.PI * 0.5;
                    const branchLength = 30 + Math.random() * 40;
                    const branchEndX = x + Math.cos(branchAngle + Math.atan2(dy, dx)) * branchLength;
                    const branchEndY = y + Math.sin(branchAngle + Math.atan2(dy, dx)) * branchLength;
                    drawLightning(x, y, branchEndX, branchEndY, branches - 1, alpha * 0.6, width * 0.5);
                }
            }

            // Lightning glow
            ctx.strokeStyle = `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${alpha})`;
            ctx.lineWidth = width + 4;
            ctx.shadowBlur = 20;
            ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
            ctx.stroke();

            // Lightning core
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
            ctx.lineWidth = width;
            ctx.stroke();
        };

        // Generate lightning bolts based on phase
        const lightningChance = this.currentPhase === 'inhale' ? 0.15 : 
                               this.currentPhase === 'hold1' ? 0.25 : 0.08;

        // Persistent lightning bolts (stored per frame for consistency)
        if (!this._stormLightning) this._stormLightning = [];
        
        // Add new lightning
        if (Math.random() < lightningChance) {
            const angle = Math.random() * Math.PI * 2;
            const startDist = 50 + Math.random() * 50;
            const endDist = 150 + Math.random() * 100;
            this._stormLightning.push({
                startX: centerX + Math.cos(angle) * startDist,
                startY: centerY + Math.sin(angle) * startDist * 0.6,
                endX: centerX + Math.cos(angle) * endDist,
                endY: centerY + Math.sin(angle) * endDist * 0.6,
                life: 1.0,
                branches: Math.floor(Math.random() * 3),
            });
        }

        // Draw and update lightning
        this._stormLightning = this._stormLightning.filter(bolt => {
            bolt.life -= 0.08;
            if (bolt.life > 0) {
                drawLightning(
                    bolt.startX, bolt.startY,
                    bolt.endX, bolt.endY,
                    bolt.branches,
                    bolt.life * intensity,
                    2 + bolt.life * 2
                );
                return true;
            }
            return false;
        });

        // Electric arcs around center
        for (let arc = 0; arc < 8; arc++) {
            const arcAngle = (arc / 8) * Math.PI * 2 + time * 2;
            const arcRadius = 60 + intensity * 40;
            const arcX = centerX + Math.cos(arcAngle) * arcRadius;
            const arcY = centerY + Math.sin(arcAngle) * arcRadius;
            const nextArcAngle = ((arc + 1) / 8) * Math.PI * 2 + time * 2;
            const nextArcX = centerX + Math.cos(nextArcAngle) * arcRadius;
            const nextArcY = centerY + Math.sin(nextArcAngle) * arcRadius;

            // Crackling arc between points
            ctx.beginPath();
            ctx.moveTo(arcX, arcY);
            const midX = (arcX + nextArcX) / 2 + (Math.random() - 0.5) * 20;
            const midY = (arcY + nextArcY) / 2 + (Math.random() - 0.5) * 20;
            ctx.quadraticCurveTo(midX, midY, nextArcX, nextArcY);
            
            const arcAlpha = (Math.sin(time * 8 + arc * 2) * 0.5 + 0.5) * intensity;
            ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${arcAlpha * 0.8})`;
            ctx.lineWidth = 2;
            ctx.shadowBlur = 10;
            ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, ${arcAlpha})`;
            ctx.stroke();
        }

        // Energy particles
        for (let i = 0; i < 40; i++) {
            const particleAngle = (i / 40) * Math.PI * 2 + time * 1.5 + Math.sin(time * 3 + i) * 0.3;
            const particleDist = 30 + (i % 15) * 12 + Math.sin(time * 4 + i * 2) * 20;
            const particleX = centerX + Math.cos(particleAngle) * particleDist * intensity;
            const particleY = centerY + Math.sin(particleAngle) * particleDist * 0.7 * intensity;
            const particleAlpha = (Math.sin(time * 5 + i * 1.5) * 0.5 + 0.5) * intensity;
            const particleSize = 2 + Math.sin(time * 6 + i) * 1.5;

            const colors = [color, secondaryColor, tertiaryColor];
            const pc = colors[i % 3];

            ctx.fillStyle = `rgba(${pc.r}, ${pc.g}, ${pc.b}, ${particleAlpha})`;
            ctx.shadowBlur = 8;
            ctx.shadowColor = `rgba(${pc.r}, ${pc.g}, ${pc.b}, ${particleAlpha})`;
            ctx.beginPath();
            ctx.arc(particleX, particleY, particleSize, 0, Math.PI * 2);
            ctx.fill();
        }

        // Central energy core
        const corePulse = Math.sin(time * 6) * 0.2 + 1;
        const coreRadius = 40 * intensity * corePulse;
        const coreGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius);
        coreGradient.addColorStop(0, `rgba(255, 255, 255, ${0.95 * intensity})`);
        coreGradient.addColorStop(0.2, `rgba(${tertiaryColor.r}, ${tertiaryColor.g}, ${tertiaryColor.b}, ${0.8 * intensity})`);
        coreGradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.6 * intensity})`);
        coreGradient.addColorStop(0.8, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, ${0.3 * intensity})`);
        coreGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = coreGradient;
        ctx.shadowBlur = 30;
        ctx.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.8)`;
        ctx.beginPath();
        ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
        ctx.fill();

        // Ring animations - electric crackling
        const scale = 0.5 + intensity * 0.5;
        const flicker = Math.sin(time * 15) * 0.1 + 1;
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${scale * 1.3 * flicker})`;
        this.outerRing.style.opacity = intensity * 0.3 * flicker;
        this.middleRing.style.transform = `translate(-50%, -50%) scale(${scale * flicker})`;
        this.middleRing.style.opacity = intensity * 0.4 * flicker;
        this.innerRing.style.transform = `translate(-50%, -50%) scale(${scale * 0.7})`;
        this.innerRing.style.opacity = intensity * 0.5;
        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.4 * corePulse})`;
        this.coreCircle.style.opacity = intensity * 0.9;
    }

    /**
     * Update colors based on phase
     * @private
     */
    _updateColors(progress) {
        const { color } = this.technique;
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
            : 1 - (-2 * t + 2) ** 4 / 2;
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
