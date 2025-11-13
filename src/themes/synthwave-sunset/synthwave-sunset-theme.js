import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class SynthwaveSunsetTheme extends BaseTheme {
    constructor() {
        super('synthwave-sunset');
        this.gridCanvas = null;
        this.gridCtx = null;
        this.animationTime = 0;
        this.cityBuildings = [];
        this.eventUnsubscribers = [];
        this.gridPulseIntensity = 0;
        this.comboColorShift = 0;
        this.resizeHandler = null;
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

        // Setup event listeners for combo effects
        this.setupEventListeners();

        // Start animation loop
        this.animate();
    }

    createSun() {
        const sunContainer = this.getContainer('synthwave-sunset-sun');

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

    createCityGlow() {
        const glowContainer = this.getContainer('synthwave-sunset-city-glow');

        // Create multiple glow beams at different positions to simulate light coming from between buildings
        const glowPositions = [8, 18, 28, 38, 48, 58, 68, 78, 88, 95];

        glowPositions.forEach((xPos, index) => {
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

    createCitySkyline() {
        // Create back city layer (smaller, more distant)
        this.createCityLayer('synthwave-sunset-city-back', '#08040f', 0.8);

        // Create front city layer (larger, closer)
        this.createCityLayer('synthwave-sunset-city-front', '#0a0515', 1.0);
    }

    createCityLayer(containerId, fillColor, sizeScale) {
        const cityContainer = this.getContainer(containerId);

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

        svg.appendChild(path);
        cityContainer.appendChild(svg);
    }

    createPerspectiveGrid() {
        const gridContainer = this.getContainer('synthwave-sunset-grid');

        // Create canvas for grid
        this.gridCanvas = document.createElement('canvas');
        this.gridCanvas.className = 'synthwave-grid-canvas';
        this.gridCtx = this.gridCanvas.getContext('2d');

        gridContainer.appendChild(this.gridCanvas);

        // Size canvas
        this.resizeGrid();

        // Handle resize - store handler reference for cleanup
        this.resizeHandler = () => this.resizeGrid();
        window.addEventListener('resize', this.resizeHandler);
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
            const y = vanishingPointY + (height - vanishingPointY) * depth;

            if (y > height) continue;

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

        const scanlines = document.createElement('div');
        scanlines.className = 'synthwave-scanlines';
        container.appendChild(scanlines);
    }

    setupEventListeners() {
        const settings = window.app?.settingsManager?.getSettings();

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleCombo(data);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    handleLineClear(data) {
        // Pulse the grid
        this.gridPulseIntensity = Math.min(1, this.gridPulseIntensity + 0.3);
    }

    handleCombo(data) {
        // Color shift based on combo count
        const comboCount = data.comboCount || 1;
        this.comboColorShift = Math.min(60, comboCount * 10);
        this.gridPulseIntensity = Math.min(1, 0.5 + comboCount * 0.1);
    }

    animate() {
        if (!this.isActive) return;

        this.animationTime += 0.016; // Approximately 60fps

        // Draw grid
        this.drawPerspectiveGrid();

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
        super.stop();
    }

    cleanup() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Remove resize event listener
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // Clean up all containers by clearing their contents
        const containerIds = [
            'synthwave-sunset-sun',
            'synthwave-sunset-city-glow',
            'synthwave-sunset-city-back',
            'synthwave-sunset-city-front',
            'synthwave-sunset-grid',
            'synthwave-sunset-scanlines'
        ];

        containerIds.forEach(id => {
            const container = document.getElementById(id);
            if (container) {
                container.innerHTML = '';
            }
        });

        // Clean up canvas references
        this.gridCanvas = null;
        this.gridCtx = null;

        super.cleanup();
    }
}
