import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class SynthwaveSunsetTheme extends BaseTheme {
    constructor() {
        super('synthwave-sunset');
        this.gridCanvas = null;
        this.gridCtx = null;
        this.animationTime = 0;
        this.eventUnsubscribers = [];
        this.gridPulseIntensity = 0;
        this.comboColorShift = 0;

        // Random phase offsets for unique sun movement each time
        this.sunPhaseX = Math.random() * Math.PI * 2;
        this.sunPhaseY = Math.random() * Math.PI * 2;
        this.sunPhaseX2 = Math.random() * Math.PI * 2;
        this.sunPhaseY2 = Math.random() * Math.PI * 2;

        // Random starting time offset so sun starts at different position each time
        this.timeOffset = Math.random() * 10000;

        // Combo effects
        this.effectsCanvas = null;
        this.effectsCtx = null;
        this.horizonBursts = [];
        this.retroStreaks = [];
        this.retroParticles = [];
        this.gridWaves = [];
        this.sunPulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.cityGlowIntensity = 0;
        this.frontCityPath = null;
        this.backCityPath = null;

        // Performance limits
        this.MAX_BURSTS = 5;
        this.MAX_STREAKS = 8;
        this.MAX_PARTICLES = 150;
        this.MAX_WAVES = 4;
    }

    async createScene() {
        const container = this.getContainer('synthwave-sunset-theme');

        // Create sky gradient background (handled by CSS)
        const sky = this.getContainer('synthwave-sunset-sky');

        // Create sun
        this.createSun();

        // Create city glow effect
        this.createCityGlow();

        // Create city skyline
        this.createCitySkyline();

        // Create perspective grid
        this.createPerspectiveGrid();

        // Create scan lines overlay
        this.createScanLines();

        // Setup combo effects canvas
        this.setupComboEffects();

        // Setup event listeners for combo effects
        this.setupEventListeners();

        // Start animation loop
        this.animate();
    }

    createSun() {
        const sunContainer = this.getContainer('synthwave-sunset-sun');

        // Only create sun elements if container is empty
        if (sunContainer && sunContainer.children.length === 0) {
            // Create the sun element
            const sun = document.createElement('div');
            sun.className = 'synthwave-sun';
            sunContainer.appendChild(sun);

            // Create sun glow layers
            for (let i = 0; i < 3; i++) {
                const glow = document.createElement('div');
                glow.className = `synthwave-sun-glow glow-layer-${i}`;
                sunContainer.appendChild(glow);
            }
        }

        // Store reference to sun container for animation
        this.sunContainer = sunContainer;
    }

    calculateSunPosition() {
        // Smooth left-to-right horizontal drift centered around screen center
        // The sun drifts continuously from left to right with subtle vertical float

        // Movement range (percentage of viewport from center)
        const horizontalRange = 25; // Extended range for longer glide to the sides (50% total travel)
        const verticalRange = 3;    // Subtle up-down floating

        // Apply time offset so sun starts at different position each time
        const time = this.animationTime + this.timeOffset;

        // Continuous left-to-right drift using modulo to loop smoothly
        // Drift cycle takes about 30 seconds for a full left-to-right pass
        const driftSpeed = 0.002; // Speed of the drift (increased 10x for visible movement)
        const driftProgress = (time * driftSpeed) % 1; // 0 to 1 progress through drift cycle

        // Map progress to position: -horizontalRange (left) to +horizontalRange (right)
        const sunX = (driftProgress * 2 - 1) * horizontalRange; // Maps 0->1 to -25->+25

        // Subtle vertical float (very gentle)
        const sunY = Math.sin(time * 0.0004) * verticalRange;

        return {
            x: sunX,
            y: sunY
        };
    }

    updateSunPosition() {
        if (!this.sunContainer) return;

        const pos = this.calculateSunPosition();

        // Combine the centering transform (-50%, -50%) with the movement offset
        // The CSS centers the sun, and we add the drift on top of that
        const finalX = -50 + pos.x;
        const finalY = -50 + pos.y;

        this.sunContainer.style.transform = `translate(${finalX}%, ${finalY}%)`;
    }

    updateSunPulse() {
        if (!this.sunContainer) return;

        // Apply pulse effect by adjusting filter brightness
        if (this.sunPulseIntensity > 0) {
            const brightness = 1 + this.sunPulseIntensity * 0.5;
            const scale = 1 + this.sunPulseIntensity * 0.15;
            this.sunContainer.style.filter = `brightness(${brightness})`;
            this.sunContainer.style.scale = `${scale}`;
        } else {
            this.sunContainer.style.filter = '';
            this.sunContainer.style.scale = '1';
        }
    }

    updateCityGlow() {
        // Apply hot pink glow effect to front city outline
        if (this.frontCityPath) {
            if (this.cityGlowIntensity > 0) {
                const strokeWidth = this.cityGlowIntensity * 0.5;
                const glowBlur = this.cityGlowIntensity * 15;

                this.frontCityPath.setAttribute('stroke', '#ff0066');
                this.frontCityPath.setAttribute('stroke-width', strokeWidth);
                this.frontCityPath.style.filter = `drop-shadow(0 0 ${glowBlur}px #ff0066) drop-shadow(0 0 ${glowBlur * 0.5}px #ff0066)`;
            } else {
                this.frontCityPath.setAttribute('stroke', 'none');
                this.frontCityPath.setAttribute('stroke-width', '0');
                this.frontCityPath.style.filter = '';
            }
        }

        // Apply subtle purple glow effect to back city outline
        if (this.backCityPath) {
            if (this.cityGlowIntensity > 0) {
                // More subtle effect - half the intensity
                const strokeWidth = this.cityGlowIntensity * 0.25;
                const glowBlur = this.cityGlowIntensity * 8;

                this.backCityPath.setAttribute('stroke', '#b000ff');
                this.backCityPath.setAttribute('stroke-width', strokeWidth);
                this.backCityPath.style.filter = `drop-shadow(0 0 ${glowBlur}px #b000ff)`;
            } else {
                this.backCityPath.setAttribute('stroke', 'none');
                this.backCityPath.setAttribute('stroke-width', '0');
                this.backCityPath.style.filter = '';
            }
        }
    }

    createCityGlow() {
        const glowContainer = this.getContainer('synthwave-sunset-city-glow');

        // Only create glow beams if container is empty
        if (glowContainer && glowContainer.children.length === 0) {
            // Create multiple glow beams at different positions to simulate light coming from between buildings
            const glowPositions = [8, 18, 28, 38, 48, 58, 68, 78, 88, 95];

            glowPositions.forEach((xPos) => {
                const glow = document.createElement('div');
                glow.className = 'synthwave-city-glow-beam';
                glow.style.left = `${xPos}%`;

                // Vary the width and intensity slightly for more organic look
                const width = this.random(10, 18);
                const delay = this.random(0, 3);
                glow.style.width = `${width}%`;
                glow.style.animationDelay = `${delay}s`;

                glowContainer.appendChild(glow);
            });
        }
    }

    createCitySkyline() {
        // Create back city layer (smaller, more distant)
        this.createCityLayer('synthwave-sunset-city-back', '#08040f', 1.1);

        // Create front city layer (larger, closer)
        this.createCityLayer('synthwave-sunset-city-front', '#0a0515', 1.0
        );
    }

    createCityLayer(containerId, fillColor, sizeScale) {
        const cityContainer = this.getContainer(containerId);

        // Only create city layer if container is empty
        if (!cityContainer || cityContainer.children.length > 0) {
            return;
        }

        // Generate clean, simple city buildings
        const buildings = [];
        let currentX = 0;

        // Create buildings that span the entire width
        while (currentX < 100) {
            const width = this.random(2, 7);
            const baseHeight = this.random(20, 50);

            // Occasionally add a very tall building
            const isTall = this.random(0, 1) > 0.85;
            const height = isTall ? this.random(45, 55) : baseHeight;

            // Scale height for depth
            const finalHeight = height * sizeScale;

            buildings.push({
                x: currentX,
                width: width,
                height: finalHeight
            });

            currentX += width;
        }

        // Create simple SVG path for clean silhouette
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('viewBox', '0 0 100 50');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.classList.add('synthwave-city-svg');

        // Build clean rectangular skyline
        let pathData = 'M 0 50 ';

        buildings.forEach(building => {
            const x = building.x;
            const width = building.width;
            const height = building.height;
            const top = 50 - height;

            // Simple rectangle - no decorations
            pathData += `L ${x} 50 L ${x} ${top} L ${x + width} ${top} L ${x + width} 50 `;
        });

        pathData += 'L 100 50 Z';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('fill', fillColor);
        path.setAttribute('stroke', 'none');

        // Store reference to city paths for glow effects
        if (containerId === 'synthwave-sunset-city-front') {
            this.frontCityPath = path;
        } else if (containerId === 'synthwave-sunset-city-back') {
            this.backCityPath = path;
        }

        svg.appendChild(path);
        cityContainer.appendChild(svg);
    }

    createPerspectiveGrid() {
        const gridContainer = this.getContainer('synthwave-sunset-grid');

        // Only create canvas if container is empty
        if (gridContainer && gridContainer.children.length === 0) {
            // Create canvas for grid
            this.gridCanvas = document.createElement('canvas');
            this.gridCanvas.className = 'synthwave-grid-canvas';
            this.gridCtx = this.gridCanvas.getContext('2d');

            gridContainer.appendChild(this.gridCanvas);

            // Size canvas
            this.resizeGrid();

            // Handle resize
            window.addEventListener('resize', () => this.resizeGrid());
        } else if (gridContainer && gridContainer.children.length > 0) {
            // Reuse existing canvas
            this.gridCanvas = gridContainer.querySelector('.synthwave-grid-canvas');
            if (this.gridCanvas) {
                this.gridCtx = this.gridCanvas.getContext('2d');
                this.resizeGrid();
            }
        }
    }

    resizeGrid() {
        if (!this.gridCanvas) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = this.gridCanvas.getBoundingClientRect();

        this.gridCanvas.width = rect.width * dpr;
        this.gridCanvas.height = rect.height * dpr;

        this.gridCtx.scale(dpr, dpr);

        this.gridWidth = rect.width;
        this.gridHeight = rect.height;
    }

    drawPerspectiveGrid() {
        if (!this.gridCtx || !this.gridCanvas) return;

        const ctx = this.gridCtx;
        const width = this.gridWidth;
        const height = this.gridHeight;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Grid parameters matching reference
        const vanishingPointX = width / 2;
        const vanishingPointY = height * 0.08; // Vanishing point very high for dramatic perspective

        // Grid configuration
        const rows = 40; // Number of horizontal divisions
        const cols = 40; // Number of vertical divisions
        const cellSize = 40; // Base cell size in the foreground

        // Animation offset
        const scrollSpeed = 30;
        const animOffset = (this.animationTime * scrollSpeed) % cellSize;

        // Bright pink/magenta grid color
        const gridColor = '#ff0066';
        const brightness = 0.8 + this.gridPulseIntensity * 0.2;

        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw horizontal lines (going into depth)
        for (let row = 0; row <= rows; row++) {
            const depth = (row + animOffset / cellSize) / rows;

            if (depth > 1) continue;

            // Calculate Y position with perspective
            let y = vanishingPointY + (height - vanishingPointY) * depth;

            if (y > height) continue;

            // Apply grid wave effects
            let waveOffset = 0;
            this.gridWaves.forEach(wave => {
                const waveDist = Math.abs(depth - wave.progress);
                if (waveDist < 0.3) {
                    const waveIntensity = (1 - waveDist / 0.3) * wave.intensity * wave.life;
                    waveOffset += Math.sin(waveDist * 10) * waveIntensity * 15;
                }
            });
            y += waveOffset;

            // Calculate alpha and line width based on depth
            const alpha = Math.max(0.25, 1 - depth * 0.7) * brightness;
            const lineWidth = Math.max(1, 2.5 - depth * 1.5);

            // Calculate perspective scale for line width
            const scale = 1 - depth * 0.25;
            const lineSpan = width * scale;
            const xStart = vanishingPointX - lineSpan / 2;
            const xEnd = vanishingPointX + lineSpan / 2;

            ctx.globalAlpha = alpha;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(xStart, y);
            ctx.lineTo(xEnd, y);
            ctx.stroke();
        }

        // Draw vertical lines (converging to vanishing point)
        for (let col = -cols / 2; col <= cols / 2; col++) {
            const lateralPos = col / (cols / 2); // -1 to 1

            // Calculate alpha based on distance from center
            const alpha = Math.max(0.25, 1 - Math.abs(lateralPos) * 0.6) * brightness;
            const lineWidth = Math.max(1, 2.5 - Math.abs(lateralPos) * 1.2);

            // Start point at vanishing point
            const startX = vanishingPointX;
            const startY = vanishingPointY;

            // End point at bottom of screen
            const spread = cellSize * col;
            const endX = vanishingPointX + spread;
            const endY = height;

            ctx.globalAlpha = alpha;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
        }

        // Reset context
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        // Decay pulse effects
        if (this.gridPulseIntensity > 0) {
            this.gridPulseIntensity *= 0.95;
            if (this.gridPulseIntensity < 0.01) this.gridPulseIntensity = 0;
        }

        if (this.comboColorShift !== 0) {
            this.comboColorShift *= 0.95;
            if (Math.abs(this.comboColorShift) < 0.1) this.comboColorShift = 0;
        }
    }

    createScanLines() {
        const container = this.getContainer('synthwave-sunset-scanlines');

        // Only create scanlines if container is empty
        if (container && container.children.length === 0) {
            const scanlines = document.createElement('div');
            scanlines.className = 'synthwave-scanlines';
            container.appendChild(scanlines);
        }
    }

    setupComboEffects() {
        const themeContainer = this.getContainer('synthwave-sunset-theme');
        if (!themeContainer) return;

        // Create canvas for combo effects
        let canvas = themeContainer.querySelector('.synthwave-effects-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.className = 'synthwave-effects-canvas';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '100';
            themeContainer.appendChild(canvas);
        }

        this.effectsCanvas = canvas;
        this.effectsCtx = canvas.getContext('2d', { alpha: true });

        // Size canvas
        const resizeEffectsCanvas = () => {
            if (!this.effectsCanvas || !themeContainer) return;
            const rect = themeContainer.getBoundingClientRect();
            this.effectsCanvas.width = rect.width;
            this.effectsCanvas.height = rect.height;
        };
        resizeEffectsCanvas();
        window.addEventListener('resize', resizeEffectsCanvas);
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            console.log('LINE_CLEAR event:', {
                isActive: this.isActive,
                backgroundComboEffects: settings?.backgroundComboEffects,
                data
            });
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            console.log('COMBO event:', {
                isActive: this.isActive,
                backgroundComboEffects: settings?.backgroundComboEffects,
                data
            });
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleCombo(data);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    handleLineClear(data) {
        const { lineCount } = data;
        console.log('Synthwave Sunset: LINE_CLEAR event received', { lineCount, isActive: this.isActive });

        // Pulse the grid
        this.gridPulseIntensity = Math.min(1, this.gridPulseIntensity + 0.3 * lineCount);

        // Pulse the city glow
        this.cityGlowIntensity = Math.min(1, this.cityGlowIntensity + 0.3 * lineCount);

        // Create horizon light bursts
        this.createHorizonBursts(lineCount);

        // Create retro streaks for multi-line clears
        if (lineCount >= 2) {
            this.createRetroStreaks(lineCount);
        }

        // Create grid waves for big clears
        if (lineCount >= 3) {
            this.createGridWave();
        }
    }

    handleCombo(data) {
        const { comboCount } = data;
        console.log('Synthwave Sunset: COMBO event received', { comboCount, isActive: this.isActive });

        this.comboMultiplier = Math.min(1 + comboCount * 0.2, 2.5);

        // Color shift based on combo count
        this.comboColorShift = Math.min(60, comboCount * 10);
        this.gridPulseIntensity = Math.min(1, 0.5 + comboCount * 0.1);

        // Pulse the sun
        this.sunPulseIntensity = Math.min(1, this.sunPulseIntensity + 0.4);

        // Pulse the city glow
        this.cityGlowIntensity = Math.min(1, this.cityGlowIntensity + 0.4);

        // Create retro particles
        if (comboCount >= 2) {
            this.createRetroParticles(comboCount);
        }

        // Create additional streaks for high combos
        if (comboCount >= 4) {
            this.createRetroStreaks(Math.floor(comboCount / 2));
        }
    }

    createHorizonBursts(lineCount) {
        if (!this.effectsCanvas) {
            console.warn('Synthwave Sunset: effectsCanvas not available for horizon bursts');
            return;
        }
        if (this.horizonBursts.length >= this.MAX_BURSTS) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;
        const horizonY = height * 0.65; // Position near city horizon

        console.log('Creating horizon bursts:', { lineCount, width, height, horizonY });

        // Sunset-themed colors: hot pink, orange-red, deep pink, violet purple, coral
        const colors = ['#ff0066', '#ff4500', '#ff006e', '#b000ff', '#ff5e78'];
        const burstCount = Math.min(lineCount, this.MAX_BURSTS - this.horizonBursts.length);

        for (let i = 0; i < burstCount; i++) {
            const x = Math.random() * width;
            const color = colors[Math.floor(Math.random() * colors.length)];
            const particleCount = Math.floor(15 + Math.random() * 20) * this.comboMultiplier;

            const particles = [];
            for (let j = 0; j < particleCount; j++) {
                const angle = Math.random() * Math.PI - Math.PI / 2; // Upward burst
                const speed = (Math.random() * 2 + 1.5) * this.comboMultiplier;
                particles.push({
                    x: x,
                    y: horizonY,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life: 1.0,
                    size: Math.random() * 3 + 1.5,
                });
            }

            this.horizonBursts.push({
                particles,
                color,
                life: 1.0,
                maxLife: 1.2 + Math.random() * 0.4,
            });
        }
    }

    createRetroStreaks(count) {
        if (!this.effectsCanvas) return;
        if (this.retroStreaks.length >= this.MAX_STREAKS) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;
        // Sunset-themed colors: hot pink, orange-red, violet purple, deep pink
        const colors = ['#ff0066', '#ff4500', '#b000ff', '#ff006e'];
        const streakCount = Math.min(count * 2, this.MAX_STREAKS - this.retroStreaks.length);

        for (let i = 0; i < streakCount; i++) {
            const y = Math.random() * height * 0.7;
            const color = colors[Math.floor(Math.random() * colors.length)];
            const speed = (Math.random() * 400 + 300) * (Math.random() > 0.5 ? 1 : -1);

            this.retroStreaks.push({
                x: Math.random() > 0.5 ? -50 : width + 50,
                y,
                speed,
                life: 1.0,
                maxLife: 0.6 + Math.random() * 0.4,
                width: Math.random() * 150 + 100,
                height: Math.random() * 3 + 2,
                color,
            });
        }
    }

    createRetroParticles(comboCount) {
        if (!this.effectsCanvas) return;
        if (this.retroParticles.length >= this.MAX_PARTICLES) {
            // Remove oldest particles
            this.retroParticles.splice(0, Math.floor(this.MAX_PARTICLES * 0.3));
        }

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        // Sunset-themed colors: hot pink, orange-red, deep pink, violet purple, coral
        const colors = ['#ff0066', '#ff4500', '#ff006e', '#b000ff', '#ff5e78'];
        const particleCount = Math.min(comboCount * 15, this.MAX_PARTICLES);

        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = (Math.random() * 2.5 + 2) * this.comboMultiplier;
            const color = colors[Math.floor(Math.random() * colors.length)];
            const isSquare = Math.random() > 0.5;

            this.retroParticles.push({
                x: centerX,
                y: centerY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                maxLife: Math.random() * 0.8 + 0.5,
                size: Math.random() * 4 + 2,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.1,
                color,
                isSquare,
                glow: Math.random() * 12 + 8,
            });
        }
    }

    createGridWave() {
        if (!this.gridWaves || this.gridWaves.length >= this.MAX_WAVES) return;

        this.gridWaves.push({
            progress: 0,
            life: 1.0,
            maxLife: 1.5,
            intensity: 0.8,
        });
    }

    updateEffects(delta) {
        // Update horizon bursts
        for (let i = this.horizonBursts.length - 1; i >= 0; i--) {
            const burst = this.horizonBursts[i];
            burst.life -= delta / burst.maxLife;

            burst.particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.1; // Gravity
                p.life -= delta / burst.maxLife;
            });

            if (burst.life <= 0) {
                this.horizonBursts.splice(i, 1);
            }
        }

        // Update retro streaks
        for (let i = this.retroStreaks.length - 1; i >= 0; i--) {
            const streak = this.retroStreaks[i];
            streak.x += streak.speed * delta;
            streak.life -= delta / streak.maxLife;

            if (streak.life <= 0) {
                this.retroStreaks.splice(i, 1);
            }
        }

        // Update retro particles
        for (let i = this.retroParticles.length - 1; i >= 0; i--) {
            const p = this.retroParticles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.08; // Slight gravity
            p.rotation += p.rotationSpeed;
            p.life -= delta / p.maxLife;

            if (p.life <= 0) {
                this.retroParticles.splice(i, 1);
            }
        }

        // Update grid waves
        for (let i = this.gridWaves.length - 1; i >= 0; i--) {
            const wave = this.gridWaves[i];
            wave.progress += delta * 0.5;
            wave.life -= delta / wave.maxLife;

            if (wave.life <= 0) {
                this.gridWaves.splice(i, 1);
            }
        }

        // Decay sun pulse
        if (this.sunPulseIntensity > 0) {
            this.sunPulseIntensity *= 0.92;
            if (this.sunPulseIntensity < 0.01) this.sunPulseIntensity = 0;
        }

        // Decay city glow
        if (this.cityGlowIntensity > 0) {
            this.cityGlowIntensity *= 0.92;
            if (this.cityGlowIntensity < 0.01) this.cityGlowIntensity = 0;
        }
    }

    renderEffects() {
        if (!this.effectsCanvas || !this.effectsCtx) return;

        const ctx = this.effectsCtx;
        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Render retro streaks
        this.retroStreaks.forEach(streak => {
            const alpha = streak.life * 0.7;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.shadowBlur = 20;
            ctx.shadowColor = streak.color;
            ctx.fillStyle = streak.color;
            ctx.fillRect(streak.x, streak.y, streak.width, streak.height);
            ctx.restore();
        });

        // Render horizon bursts
        this.horizonBursts.forEach(burst => {
            burst.particles.forEach(p => {
                const alpha = p.life * burst.life;
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.shadowBlur = 12;
                ctx.shadowColor = burst.color;
                ctx.fillStyle = burst.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });
        });

        // Render retro particles
        this.retroParticles.forEach(p => {
            const alpha = p.life;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.shadowBlur = p.glow;
            ctx.shadowColor = p.color;
            ctx.fillStyle = p.color;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);

            if (p.isSquare) {
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        });
    }

    animate() {
        if (!this.isActive) return;

        this.animationTime += 0.016; // Approximately 60fps

        // Update sun position
        this.updateSunPosition();

        // Update sun glow for pulse effect
        this.updateSunPulse();

        // Update city glow for combo effects
        this.updateCityGlow();

        // Draw grid
        this.drawPerspectiveGrid();

        // Update and render combo effects
        this.updateEffects(0.016);
        this.renderEffects();

        // Continue animation loop
        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    update(deltaTime) {
        // Optional: Additional per-frame updates can go here
    }

    resize(width, height) {
        this.resizeGrid();
    }

    stop() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Clear combo effects
        this.horizonBursts = [];
        this.retroStreaks = [];
        this.retroParticles = [];
        this.gridWaves = [];
        this.sunPulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.cityGlowIntensity = 0;

        // Clear effects canvas
        if (this.effectsCanvas && this.effectsCtx) {
            this.effectsCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
        }

        // Clear references
        this.sunContainer = null;
        this.gridCanvas = null;
        this.gridCtx = null;
        this.effectsCanvas = null;
        this.effectsCtx = null;
        this.frontCityPath = null;
        this.backCityPath = null;

        super.stop();
    }
}
