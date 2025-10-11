/**
 * @fileoverview Lantern Festival Theme - Traditional Asian festival with floating lanterns, petals, and embers
 */

import { BaseTheme } from '../base-theme.js';
import { lanternFestivalElementPool } from '../../utils/cache.js';

/**
 * Lantern Festival Theme
 * Features:
 * - Floating lanterns in three parallax layers
 * - Water reflections
 * - Cherry blossom petals
 * - Rising embers
 * - Pooled element optimization for performance
 */
export default class LanternFestivalTheme extends BaseTheme {
    constructor() {
        super('lantern-festival');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // Check if already initialized with pooled elements
        if (lanternFestivalElementPool.initialized) {
            // Reuse existing elements - just make sure they're in the right containers
            const lanternLayers = [
                { container: this.getContainer('lanterns-back'), count: 20 },
                { container: this.getContainer('lanterns-mid'), count: 15 },
                { container: this.getContainer('lanterns-front'), count: 10 },
            ];

            let lanternIndex = 0;
            lanternLayers.forEach(layer => {
                if (layer.container) {
                    // Reattach pooled lanterns to this layer
                    for (let i = 0; i < layer.count; i++) {
                        if (lanternFestivalElementPool.lanterns[lanternIndex]) {
                            layer.container.appendChild(
                                lanternFestivalElementPool.lanterns[lanternIndex]
                            );
                            lanternIndex++;
                        }
                    }
                }
            });

            // Reattach reflections
            const waterContainer = this.getContainer('lantern-water');
            if (waterContainer) {
                lanternFestivalElementPool.reflections.forEach(reflection => {
                    waterContainer.appendChild(reflection);
                });
            }

            // Reattach petals
            const petalContainer = this.getContainer('lantern-petals');
            if (petalContainer) {
                lanternFestivalElementPool.petals.forEach(petal => {
                    petalContainer.appendChild(petal);
                });
            }

            // Reattach embers
            const emberContainer = this.getContainer('lantern-embers');
            if (emberContainer) {
                lanternFestivalElementPool.embers.forEach(ember => {
                    emberContainer.appendChild(ember);
                });
            }

            return; // Skip expensive generation
        }

        // First time - create elements with seeded random for deterministic output
        const rng = this.seededRandom(88888); // Seed for lantern festival

        // 1. Lanterns
        const lanternLayers = [
            {
                container: this.getContainer('lanterns-back'),
                count: 20,
                minSize: 20,
                maxSize: 40,
                minDuration: 40,
                maxDuration: 60,
            },
            {
                container: this.getContainer('lanterns-mid'),
                count: 15,
                minSize: 40,
                maxSize: 60,
                minDuration: 30,
                maxDuration: 50,
            },
            {
                container: this.getContainer('lanterns-front'),
                count: 10,
                minSize: 60,
                maxSize: 80,
                minDuration: 20,
                maxDuration: 40,
            },
        ];

        const lanternShapes = [
            // Classic round
            '<path d="M10 80 C 10 80, 0 60, 0 40 C 0 20, 10 0, 10 0 L 40 0 C 40 0, 50 20, 50 40 C 50 60, 40 80, 40 80 Z" />',
            // Cylinder
            '<path d="M0 10 C0 -10, 50 -10, 50 10 L 50 70 C 50 90, 0 90, 0 70 Z" />',
            // Diamond
            '<path d="M25 0 L50 40 L25 80 L0 40 Z" />',
        ];
        const lanternColors = ['#ff7675', '#feca57', '#ff9f43', '#ee5253', '#ab54c5'];

        const waterContainer = this.getContainer('lantern-water');

        lanternLayers.forEach(layer => {
            if (layer.container && layer.container.children.length === 0) {
                for (let i = 0; i < layer.count; i++) {
                    const lantern = document.createElement('div');
                    lantern.className = 'lantern';

                    const color = lanternColors[Math.floor(rng() * lanternColors.length)];
                    const shape = lanternShapes[Math.floor(rng() * lanternShapes.length)];
                    lantern.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 80"><g fill="${encodeURIComponent(color)}" opacity="0.9">${shape}</g></svg>')`;

                    const size = rng() * (layer.maxSize - layer.minSize) + layer.minSize;
                    lantern.style.width = `${size}px`;
                    lantern.style.height = `${size * 1.2}px`;

                    const xPos = rng() * 100;
                    lantern.style.left = `${xPos}%`;

                    const duration =
                        rng() * (layer.maxDuration - layer.minDuration) + layer.minDuration;
                    lantern.style.animationDuration = `${duration}s`;
                    lantern.style.animationDelay = `-${rng() * duration}s`;

                    lantern.style.setProperty('--x-sway1', `${(rng() - 0.5) * 10}vw`);
                    lantern.style.setProperty('--x-sway2', `${(rng() - 0.5) * 10}vw`);
                    lantern.style.setProperty('--start-opacity', `${rng() * 0.5 + 0.5}`);

                    layer.container.appendChild(lantern);
                    lanternFestivalElementPool.lanterns.push(lantern); // Store in pool

                    // Add reflection for front lanterns
                    if (layer.container.id === 'lanterns-front' && waterContainer) {
                        const reflection = document.createElement('div');
                        reflection.className = 'lantern-reflection';
                        reflection.style.width = `${size}px`;
                        reflection.style.height = `${size}px`;
                        reflection.style.left = `${xPos}%`;

                        // Match animation properties
                        reflection.style.animationDuration = `${duration}s, 4s`;
                        reflection.style.animationDelay = `-${rng() * duration}s, -${rng() * 4}s`;
                        reflection.style.setProperty('--x-sway1', `${(rng() - 0.5) * 10}vw`);
                        reflection.style.setProperty('--x-sway2', `${(rng() - 0.5) * 10}vw`);
                        reflection.style.setProperty('--start-opacity', '0.4'); // Reflections are fainter

                        waterContainer.appendChild(reflection);
                        lanternFestivalElementPool.reflections.push(reflection); // Store in pool
                    }
                }
            }
        });

        // 2. Petals
        const petalContainer = this.getContainer('lantern-petals');
        if (petalContainer && petalContainer.children.length === 0) {
            for (let i = 0; i < 20; i++) {
                const petal = document.createElement('div');
                petal.className = 'lantern-petal';
                petal.style.setProperty('--x-start', `${rng() * 100}vw`);
                petal.style.setProperty('--y-start', '-10vh');
                petal.style.setProperty('--x-end', `${rng() * 100}vw`);
                petal.style.setProperty('--y-end', '110vh');
                petal.style.setProperty('--r-start', `${rng() * 360}deg`);
                petal.style.setProperty('--r-end', `${rng() * 720 - 360}deg`);
                const duration = rng() * 10 + 15;
                petal.style.animationDuration = `${duration}s`;
                petal.style.animationDelay = `-${rng() * duration}s`;
                petalContainer.appendChild(petal);
                lanternFestivalElementPool.petals.push(petal); // Store in pool
            }
        }

        // 3. Embers
        const emberContainer = this.getContainer('lantern-embers');
        if (emberContainer && emberContainer.children.length === 0) {
            for (let i = 0; i < 40; i++) {
                const ember = document.createElement('div');
                ember.className = 'lantern-ember';
                ember.style.left = `${rng() * 100}%`;
                ember.style.bottom = `-${rng() * 20}vh`; // Start from below or near bottom
                const duration = rng() * 8 + 6;
                ember.style.animationDuration = `${duration}s`;
                ember.style.animationDelay = `-${rng() * duration}s`;
                emberContainer.appendChild(ember);
                lanternFestivalElementPool.embers.push(ember); // Store in pool
            }
        }

        // Mark as initialized
        lanternFestivalElementPool.initialized = true;
    }
}
