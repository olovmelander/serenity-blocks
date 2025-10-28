import { BaseTheme } from '../base-theme.js';

export default class GeodeTheme extends BaseTheme {
    constructor() {
        super('geode');
        this.animationTime = 0;
        this.crystals = [];
    }

    async createScene() {
        // Create immersive geode cave with depth and atmosphere
        this.createCrystalClusters();
        this.createLayeredDust();
        this.createCrystalRefractions();
        this.createAmbientGlow();
        this.setupDynamicLighting();
    }

    /**
     * Create crystal clusters with varied sizes, colors, and depth
     */
    createCrystalClusters() {
        const crystalContainer = document.getElementById('geode-crystals');
        if (!crystalContainer || crystalContainer.children.length > 0) return;

        // Enhanced crystal palettes with more vibrant, emotional colors
        const crystalPalettes = [
            // Mystical Purple-Blue
            {
                colors: ['#9b59b6', '#8e44ad', '#3498db', '#2980b9'],
                glow: '#9b59b6',
                intensity: 1.2,
            },
            // Ethereal Cyan-Teal
            {
                colors: ['#1abc9c', '#16a085', '#00d4ff', '#00a8cc'],
                glow: '#1abc9c',
                intensity: 1.0,
            },
            // Warm Amber-Rose
            {
                colors: ['#e74c3c', '#c0392b', '#f39c12', '#e67e22'],
                glow: '#e74c3c',
                intensity: 0.9,
            },
            // Electric Pink-Purple
            {
                colors: ['#ff006e', '#8338ec', '#fb5607', '#ff006e'],
                glow: '#ff006e',
                intensity: 1.3,
            },
            // Cosmic Green-Blue
            {
                colors: ['#06ffa5', '#00d9ff', '#4dff88', '#00ffc8'],
                glow: '#06ffa5',
                intensity: 1.1,
            },
        ];

        // Sophisticated crystal shapes
        const crystalShapes = [
            'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)', // Pentagon
            'polygon(50% 0%, 95% 30%, 80% 100%, 20% 100%, 5% 30%)', // Elongated pentagon
            'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)', // Octagon
            'polygon(50% 0%, 90% 20%, 100% 60%, 75% 100%, 25% 100%, 0% 60%, 10% 20%)', // Heptagon
            'polygon(50% 0%, 80% 10%, 100% 50%, 80% 90%, 50% 100%, 20% 90%, 0% 50%, 20% 10%)', // Diamond
        ];

        // Create layered crystal clusters for depth - FEWER, LARGER crystals for less clutter
        const layers = [
            {
                count: 4,
                depthClass: 'crystal-back',
                zIndex: 1,
                scaleRange: [80, 160],
            },
            {
                count: 5,
                depthClass: 'crystal-mid',
                zIndex: 2,
                scaleRange: [120, 220],
            },
            {
                count: 6,
                depthClass: 'crystal-front',
                zIndex: 3,
                scaleRange: [150, 280],
            },
        ];

        layers.forEach((layer) => {
            for (let i = 0; i < layer.count; i++) {
                const crystal = document.createElement('div');
                crystal.className = `crystal ${layer.depthClass}`;

                const palette = crystalPalettes[Math.floor(Math.random() * crystalPalettes.length)];
                const shape = crystalShapes[Math.floor(Math.random() * crystalShapes.length)];

                const size = Math.random() * (layer.scaleRange[1] - layer.scaleRange[0])
                    + layer.scaleRange[0];
                const aspectRatio = Math.random() * 0.6 + 0.7; // 0.7 to 1.3

                // Starting position
                const startX = Math.random() * 100;
                const startY = Math.random() * 100;

                crystal.style.width = `${size}px`;
                crystal.style.height = `${size * aspectRatio}px`;
                crystal.style.left = `${startX}%`;
                crystal.style.top = `${startY}%`;
                crystal.style.clipPath = shape;
                crystal.style.zIndex = layer.zIndex;

                // Create multi-layered crystal structure
                const gradientAngle = Math.random() * 360;
                const gradientColors = palette.colors.join(', ');
                crystal.style.background = `linear-gradient(${gradientAngle}deg, ${gradientColors})`;

                // Inner glow layer
                const innerGlow = document.createElement('div');
                innerGlow.className = 'crystal-inner-glow';
                innerGlow.style.clipPath = shape;
                innerGlow.style.background = `radial-gradient(circle at ${30 + Math.random() * 40}% ${30 + Math.random() * 40}%,
                    ${palette.glow}88, transparent 60%)`;

                // Outer glow layer
                const outerGlow = document.createElement('div');
                outerGlow.className = 'crystal-outer-glow';
                outerGlow.style.clipPath = shape;
                outerGlow.style.background = `linear-gradient(${gradientAngle + 180}deg, ${gradientColors})`;
                outerGlow.style.setProperty('--glow-color', palette.glow);
                outerGlow.style.setProperty('--glow-intensity', palette.intensity);

                // Refraction/highlight effect
                const highlight = document.createElement('div');
                highlight.className = 'crystal-highlight';
                highlight.style.clipPath = shape;
                const highlightPos = Math.random() * 100;
                highlight.style.background = `linear-gradient(${gradientAngle - 45}deg,
                    transparent ${highlightPos}%,
                    rgba(255,255,255,0.4) ${highlightPos + 5}%,
                    transparent ${highlightPos + 10}%)`;

                // Animation properties
                crystal.style.setProperty('--rotate-start', `${Math.random() * 15 - 7.5}deg`);
                crystal.style.setProperty('--rotate-end', `${Math.random() * 15 - 7.5}deg`);
                crystal.style.setProperty('--pulse-delay', `${Math.random() * 10}s`);
                crystal.style.animationDelay = `-${Math.random() * 60}s`;
                outerGlow.style.animationDelay = `-${Math.random() * 12}s`;
                innerGlow.style.animationDelay = `-${Math.random() * 8}s`;

                crystal.appendChild(innerGlow);
                crystal.appendChild(outerGlow);
                crystal.appendChild(highlight);
                crystalContainer.appendChild(crystal);

                this.crystals.push({
                    element: crystal,
                    x: startX,
                    y: startY,
                    vx: (Math.random() - 0.5) * 0.05,
                    vy: (Math.random() - 0.5) * 0.05,
                    rotation: Math.random() * 360,
                    rotationSpeed: (Math.random() - 0.5) * 0.1,
                });
            }
        });

        this.registerContainer(crystalContainer);
    }

    /**
     * Create multi-layered floating dust particles for atmosphere - REDUCED for less clutter
     */
    createLayeredDust() {
        const dustLayers = [
            {
                container: document.getElementById('geode-dust-back'),
                count: 25,
                sizeRange: [1, 3],
                durationRange: [30, 50],
                opacity: 0.2,
                blur: 2,
            },
            {
                container: document.getElementById('geode-dust-mid'),
                count: 20,
                sizeRange: [1.5, 4],
                durationRange: [25, 40],
                opacity: 0.35,
                blur: 1.5,
            },
            {
                container: document.getElementById('geode-dust-front'),
                count: 15,
                sizeRange: [2, 5],
                durationRange: [20, 35],
                opacity: 0.5,
                blur: 1,
            },
        ];

        const dustColors = ['#a29bfe', '#74b9ff', '#81ecec', '#ffeaa7', '#dfe6e9', '#b2bec3'];

        dustLayers.forEach((layer) => {
            if (!layer.container || layer.container.children.length > 0) return;

            for (let i = 0; i < layer.count; i++) {
                const particle = document.createElement('div');
                particle.className = 'geode-dust-particle';

                const size = Math.random() * (layer.sizeRange[1] - layer.sizeRange[0]) + layer.sizeRange[0];
                const color = dustColors[Math.floor(Math.random() * dustColors.length)];

                particle.style.width = `${size}px`;
                particle.style.height = `${size}px`;
                particle.style.backgroundColor = color;
                particle.style.filter = `blur(${layer.blur}px)`;

                // Create organic, flowing motion paths
                const startX = Math.random() * 120 - 10; // -10 to 110
                const startY = Math.random() * 120 - 10;
                const endX = Math.random() * 120 - 10;
                const endY = Math.random() * 120 - 10;

                particle.style.setProperty('--x-start', `${startX}vw`);
                particle.style.setProperty('--y-start', `${startY}vh`);
                particle.style.setProperty(
                    '--x-mid',
                    `${(startX + endX) / 2 + (Math.random() * 30 - 15)}vw`,
                );
                particle.style.setProperty(
                    '--y-mid',
                    `${(startY + endY) / 2 + (Math.random() * 30 - 15)}vh`,
                );
                particle.style.setProperty('--x-end', `${endX}vw`);
                particle.style.setProperty('--y-end', `${endY}vh`);
                particle.style.setProperty('--opacity', layer.opacity);

                const duration = Math.random() * (layer.durationRange[1] - layer.durationRange[0])
                    + layer.durationRange[0];
                particle.style.animationDuration = `${duration}s`;
                particle.style.animationDelay = `-${Math.random() * duration}s`;

                layer.container.appendChild(particle);
            }

            this.registerContainer(layer.container);
        });
    }

    /**
     * Create crystal refraction effects for realism - MORE DRAMATIC, FLOWING
     */
    createCrystalRefractions() {
        const refractionContainer = document.getElementById('geode-crystals');
        if (!refractionContainer) return;

        // Add sweeping light rays refracting through crystals
        const rayCount = 12;
        for (let i = 0; i < rayCount; i++) {
            const ray = document.createElement('div');
            ray.className = 'crystal-refraction-ray';

            const angle = (360 / rayCount) * i + Math.random() * 15;
            const length = Math.random() * 60 + 50;
            const width = Math.random() * 3 + 0.5;
            const hue = Math.random() * 80 + 260; // Purple to cyan range

            ray.style.left = `${50 + Math.random() * 30 - 15}%`;
            ray.style.top = `${50 + Math.random() * 30 - 15}%`;
            ray.style.width = `${width}px`;
            ray.style.height = `${length}vh`;
            ray.style.setProperty('--ray-angle', `${angle}deg`);
            ray.style.background = `linear-gradient(to bottom,
                transparent,
                hsla(${hue}, 80%, 60%, 0.4) 50%,
                transparent)`;
            ray.style.animationDelay = `-${Math.random() * 20}s`;
            ray.style.animationDuration = `${15 + Math.random() * 10}s`;

            refractionContainer.appendChild(ray);
        }
    }

    /**
     * Create ambient glow that pulses throughout the cave
     */
    createAmbientGlow() {
        const glowContainer = document.getElementById('geode-crystals');
        if (!glowContainer) return;

        // Create radial glow zones
        const glowZones = 5;
        for (let i = 0; i < glowZones; i++) {
            const glow = document.createElement('div');
            glow.className = 'geode-ambient-glow';

            const size = Math.random() * 40 + 30;
            const hue = Math.random() * 80 + 260; // Purple to cyan range

            glow.style.width = `${size}vw`;
            glow.style.height = `${size}vh`;
            glow.style.left = `${Math.random() * 80 + 10}%`;
            glow.style.top = `${Math.random() * 80 + 10}%`;
            glow.style.background = `radial-gradient(circle, hsla(${hue}, 80%, 50%, 0.15), transparent 70%)`;
            glow.style.animationDelay = `-${Math.random() * 20}s`;

            glowContainer.appendChild(glow);
        }
    }

    /**
     * Setup dynamic lighting that responds to time
     */
    setupDynamicLighting() {
        // Animate lighting over time
        const animate = () => {
            if (!this.isActive) return;

            this.animationTime += 0.016; // ~60fps

            // Update global lighting variables via CSS custom properties
            const root = document.documentElement;
            const lightIntensity = Math.sin(this.animationTime * 0.5) * 0.3 + 0.7;
            const hueShift = Math.sin(this.animationTime * 0.2) * 30;

            root.style.setProperty('--geode-light-intensity', lightIntensity);
            root.style.setProperty('--geode-hue-shift', `${hueShift}deg`);

            this.animateCrystals();

            this.registerAnimationFrame(requestAnimationFrame(animate));
        };

        this.registerAnimationFrame(requestAnimationFrame(animate));
    }

    animateCrystals() {
        this.crystals.forEach((crystal) => {
            crystal.x += crystal.vx;
            crystal.y += crystal.vy;
            crystal.rotation += crystal.rotationSpeed;

            if (crystal.x < -10 || crystal.x > 110) {
                crystal.vx *= -1;
            }

            if (crystal.y < -10 || crystal.y > 110) {
                crystal.vy *= -1;
            }

            crystal.element.style.left = `${crystal.x}%`;
            crystal.element.style.top = `${crystal.y}%`;
            crystal.element.style.transform = `rotate(${crystal.rotation}deg)`;
        });
    }

    stop() {
        super.stop();
        this.animationTime = 0;
    }
}
