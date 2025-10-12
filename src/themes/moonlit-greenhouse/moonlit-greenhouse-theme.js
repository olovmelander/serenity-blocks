/**
 * @fileoverview Moonlit Greenhouse Theme - Tranquil greenhouse with plant silhouettes, dewdrops, and moths
 */

import { BaseTheme } from '../base-theme.js';

/**
 * Moonlit Greenhouse Theme
 * Features:
 * - Plant silhouettes in parallax layers
 * - Glistening dewdrops
 * - Flying moths
 */
export default class MoonlitGreenhouseTheme extends BaseTheme {
    constructor() {
        super('moonlit-greenhouse');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // 1. Plant Silhouettes
        const plantLayers = [
            {
                el: document.getElementById('greenhouse-plants-back'),
                count: 15,
                color: 'rgba(5, 20, 15, 0.6)',
            },
            {
                el: document.getElementById('greenhouse-plants-mid'),
                count: 12,
                color: 'rgba(10, 30, 25, 0.7)',
            },
            {
                el: document.getElementById('greenhouse-plants-front'),
                count: 10,
                color: 'rgba(15, 40, 35, 0.8)',
            },
        ];

        const plantSVGs = [
            'M 50 100 C 20 80, 20 40, 50 0 C 80 40, 80 80, 50 100', // Fern-like
            'M 50 100 V 50 A 40 40 0 1 1 50 50', // Monstera-like leaf
            'M 50 100 L 50 0 M 50 20 L 80 10 M 50 40 L 20 30 M 50 60 L 80 50', // Branchy
        ];

        plantLayers.forEach((layer) => {
            if (layer.el) {
                this.registerContainer(layer.el);
                if (layer.el.children.length === 0) {
                    for (let i = 0; i < layer.count; i++) {
                        const plant = document.createElement('div');
                        plant.className = 'greenhouse-plant';
                        const svg = plantSVGs[Math.floor(Math.random() * plantSVGs.length)];
                        plant.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${svg}" fill="${layer.color}" stroke="${layer.color}" stroke-width="2"/></svg>')`;

                        const size = Math.random() * 150 + 100;
                        plant.style.width = `${size}px`;
                        plant.style.height = `${size}px`;
                        plant.style.left = `${Math.random() * 100}%`;
                        plant.style.bottom = `${Math.random() * 20 - 10}%`;
                        plant.style.transform = `rotate(${Math.random() * 20 - 10}deg)`;
                        plant.style.animationDelay = `-${Math.random() * 10}s`;
                        layer.el.appendChild(plant);
                    }
                }
            }
        });

        // 2. Dewdrops
        const dewdropContainer = this.getContainer('greenhouse-dewdrops');
        if (dewdropContainer && dewdropContainer.children.length === 0) {
            for (let i = 0; i < 60; i++) {
                const dewdrop = document.createElement('div');
                dewdrop.className = 'dewdrop';
                dewdrop.style.left = `${Math.random() * 100}%`;
                dewdrop.style.top = `${Math.random() * 100}%`;
                dewdrop.style.animationDelay = `-${Math.random() * 8}s`;
                dewdropContainer.appendChild(dewdrop);
            }
        }

        // 3. Moths
        const mothContainer = this.getContainer('greenhouse-moths');
        if (mothContainer && mothContainer.children.length === 0) {
            for (let i = 0; i < 7; i++) {
                const moth = document.createElement('div');
                moth.className = 'greenhouse-moth';
                moth.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                moth.style.setProperty('--y-start', `${Math.random() * 100}vh`);
                moth.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                moth.style.setProperty('--y-end', `${Math.random() * 100}vh`);
                const duration = Math.random() * 15 + 10;
                moth.style.animationDuration = `${duration}s`;
                moth.style.animationDelay = `-${Math.random() * duration}s`;
                mothContainer.appendChild(moth);
            }
        }
    }
}
