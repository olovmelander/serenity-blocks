/**
 * @fileoverview Waves Theme - Serene underwater scene with floating wave particles
 */

import { BaseTheme } from '../base-theme.js';

/**
 * Waves Theme
 * Features:
 * - Floating wave particles with organic movement
 * - Smooth animations and transitions
 */
export default class WavesTheme extends BaseTheme {
    constructor() {
        super('waves');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // Create wave particles
        const particleContainer = this.getContainer('waves-particles');
        if (particleContainer && particleContainer.children.length === 0) {
            for (let i = 0; i < 30; i++) {
                let particle = document.createElement('div');
                particle.className = 'wave-particle';
                const size = Math.random() * 2.5 + 1;
                particle.style.width = `${size}px`;
                particle.style.height = `${size}px`;
                particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                particle.style.setProperty('--y-start', `${Math.random() * 100}vh`);
                particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                particle.style.setProperty('--y-end', `${Math.random() * 100}vh`);
                particle.style.animationDelay = `-${Math.random() * 15}s`;
                particleContainer.appendChild(particle);
            }
        }
    }
}
