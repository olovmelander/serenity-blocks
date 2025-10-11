/**
 * @fileoverview Meditation Temple Theme - Serene temple scene with stupas, clouds, and golden particles
 */

import { BaseTheme } from '../base-theme.js';

/**
 * Meditation Temple Theme
 * Features:
 * - Layered clouds in upper portion
 * - Distant, mid, and near stupas in parallax layers
 * - Golden light particles
 */
export default class MeditationTempleTheme extends BaseTheme {
    constructor() {
        super('meditation-temple');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    /**
     * Helper function to create stupa SVG
     * @private
     */
    createStupaSVG(width, height, opacity) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 150');
        svg.style.width = `${width}px`;
        svg.style.height = `${height}px`;
        svg.style.position = 'absolute';
        svg.style.opacity = opacity;

        // Stupa path with spire, dome, and base
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute(
            'd',
            'M 50 5 L 48 20 L 52 20 Z M 45 20 L 55 20 L 53 30 L 47 30 Z M 40 30 Q 40 50 50 55 Q 60 50 60 30 Z M 35 55 L 65 55 L 63 75 L 37 75 Z M 30 75 L 70 75 L 68 95 L 32 95 Z M 25 95 L 75 95 L 75 100 L 25 100 Z M 20 100 L 80 100 L 80 110 L 20 110 Z M 15 110 L 85 110 L 85 120 L 15 120 Z M 10 120 L 90 120 L 90 135 L 10 135 Z M 5 135 L 95 135 L 95 150 L 5 150 Z'
        );
        path.style.fill = 'currentColor';

        svg.appendChild(path);
        return svg;
    }

    async createScene() {
        // Layer 3 - Clouds (improved design, positioned higher)
        const cloudsContainer = this.getContainer('meditation-temple-clouds');
        if (cloudsContainer && cloudsContainer.children.length === 0) {
            // Create beautiful layered clouds in the upper portion
            const cloudConfigs = [
                // Top layer - small wispy clouds
                {
                    count: 5,
                    baseWidth: 80,
                    baseHeight: 40,
                    topRange: [5, 20],
                    speed: [180, 240],
                },
                // Mid-upper layer - medium fluffy clouds
                {
                    count: 6,
                    baseWidth: 120,
                    baseHeight: 60,
                    topRange: [15, 35],
                    speed: [140, 200],
                },
                // Lower layer - larger clouds
                {
                    count: 4,
                    baseWidth: 160,
                    baseHeight: 80,
                    topRange: [25, 45],
                    speed: [100, 160],
                },
            ];

            cloudConfigs.forEach((config, layerIndex) => {
                for (let i = 0; i < config.count; i++) {
                    const cloud = document.createElement('div');
                    cloud.className = 'temple-cloud';
                    const width = config.baseWidth + Math.random() * 80;
                    const height = config.baseHeight + Math.random() * 40;
                    cloud.style.width = `${width}px`;
                    cloud.style.height = `${height}px`;

                    // Position in upper part of screen
                    const [minTop, maxTop] = config.topRange;
                    cloud.style.top = `${minTop + Math.random() * (maxTop - minTop)}%`;

                    // Start off-screen
                    cloud.style.left = `-${width + 50}px`;

                    // Vary opacity for depth
                    cloud.style.opacity = (0.6 + Math.random() * 0.3).toString();

                    // Speed based on layer
                    const [minSpeed, maxSpeed] = config.speed;
                    const duration = minSpeed + Math.random() * (maxSpeed - minSpeed);
                    cloud.style.animationDuration = `${duration}s`;
                    cloud.style.animationDelay = `-${Math.random() * duration}s`;

                    cloudsContainer.appendChild(cloud);
                }
            });
        }

        // Layer 4 - Distant Stupas
        const stupasFar = this.getContainer('meditation-temple-stupas-far');
        if (stupasFar && stupasFar.children.length === 0) {
            for (let i = 0; i < 12; i++) {
                const stupa = this.createStupaSVG(
                    60 + Math.random() * 40,
                    90 + Math.random() * 60,
                    0.4
                );
                stupa.style.bottom = '35%';
                stupa.style.left = `${i * 180 + Math.random() * 100}px`;
                stupa.style.color = 'rgba(93, 78, 55, 0.4)';
                stupa.style.filter = 'blur(2px)';
                stupasFar.appendChild(stupa);
            }
        }

        // Layer 5 - Mid Stupas
        const stupasMid = this.getContainer('meditation-temple-stupas-mid');
        if (stupasMid && stupasMid.children.length === 0) {
            for (let i = 0; i < 10; i++) {
                const stupa = this.createStupaSVG(
                    80 + Math.random() * 50,
                    120 + Math.random() * 80,
                    0.65
                );
                stupa.style.bottom = '30%';
                stupa.style.left = `${i * 220 + Math.random() * 120}px`;
                stupa.style.color = 'rgba(62, 39, 35, 0.65)';
                stupa.style.filter = 'blur(1px)';
                stupasMid.appendChild(stupa);
            }
        }

        // Layer 6 - Near Stupas (foreground)
        const stupasNear = this.getContainer('meditation-temple-stupas-near');
        if (stupasNear && stupasNear.children.length === 0) {
            // Left side stupas
            for (let i = 0; i < 3; i++) {
                const stupa = this.createStupaSVG(
                    120 + Math.random() * 80,
                    180 + Math.random() * 120,
                    0.9
                );
                stupa.style.bottom = '20%';
                stupa.style.left = `${i * 150 - 100}px`;
                stupa.style.color = 'rgba(26, 26, 26, 0.9)';
                stupasNear.appendChild(stupa);
            }
            // Right side stupas
            for (let i = 0; i < 3; i++) {
                const stupa = this.createStupaSVG(
                    120 + Math.random() * 80,
                    180 + Math.random() * 120,
                    0.9
                );
                stupa.style.bottom = '20%';
                stupa.style.left = `${i * 150 + 1400}px`;
                stupa.style.color = 'rgba(26, 26, 26, 0.9)';
                stupasNear.appendChild(stupa);
            }
        }

        // Layer 7 - Golden Light Particles
        const particlesContainer = this.getContainer('meditation-temple-particles');
        if (particlesContainer && particlesContainer.children.length === 0) {
            for (let i = 0; i < 30; i++) {
                const particle = document.createElement('div');
                particle.className = 'temple-particle';
                particle.style.left = `${Math.random() * 100}%`;
                particle.style.bottom = `${Math.random() * 30}%`;
                const duration = 15 + Math.random() * 20;
                const drift = (Math.random() - 0.5) * 200;
                particle.style.animationDuration = `${duration}s`;
                particle.style.animationDelay = `-${Math.random() * duration}s`;
                particle.style.setProperty('--drift', `${drift}px`);
                particlesContainer.appendChild(particle);
            }
        }
    }
}
