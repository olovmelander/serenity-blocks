import { BaseTheme } from '../base-theme.js';

export default class FallTheme extends BaseTheme {
    constructor() {
        super('fall');
    }

    async createScene() {
        // Define leaf shapes and colors
        const leafShapes = [
            'M15 0 C0 5, 5 25, 15 30 C25 25, 30 5, 15 0 Z', // Simple teardrop
            'M15 0 L17 10 L30 12 L18 18 L22 30 L15 25 L8 30 L12 18 L0 12 L13 10 Z', // Maple-like
            'M15 0 C 0 10, 0 20, 5 30 C 10 25, 20 25, 25 30 C 30 20, 30 10, 15 0 Z' // Oak-like
        ];
        const leafColors = ['#d44d2d', '#f7a156', '#a26e49', '#6d4c3c'];

        // Multi-layered falling leaves
        const leafLayers = [
            { container: document.getElementById('fall-leaves-back'), count: 20, minSize: 15, maxSize: 25, minDuration: 15, maxDuration: 20 },
            { container: document.getElementById('fall-leaves-mid'), count: 15, minSize: 20, maxSize: 35, minDuration: 10, maxDuration: 15 },
            { container: document.getElementById('fall-leaves-front'), count: 10, minSize: 25, maxSize: 45, minDuration: 7, maxDuration: 12 }
        ];

        leafLayers.forEach(layer => {
            if (layer.container && layer.container.children.length === 0) {
                for (let i = 0; i < layer.count; i++) {
                    let leaf = document.createElement('div');
                    leaf.className = 'leaf';
                    const shape = leafShapes[Math.floor(Math.random() * leafShapes.length)];
                    const color = leafColors[Math.floor(Math.random() * leafColors.length)];
                    leaf.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="${shape}" fill="${encodeURIComponent(color)}"/></svg>')`;
                    const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                    leaf.style.width = `${size}px`;
                    leaf.style.height = `${size}px`;

                    leaf.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                    leaf.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                    leaf.style.setProperty('--r-start', `${Math.random() * 360}deg`);
                    leaf.style.setProperty('--r-end', `${Math.random() * 1440 - 720}deg`);
                    for(let j = 1; j <= 4; j++) {
                        leaf.style.setProperty(`--x-gust${j}`, `${Math.random() * 20 - 10}vw`);
                    }

                    const duration = Math.random() * (layer.maxDuration - layer.minDuration) + layer.minDuration;
                    leaf.style.animationDuration = `${duration}s`;
                    leaf.style.animationDelay = `-${Math.random() * duration}s`;
                    layer.container.appendChild(leaf);
                }
                this.registerContainer(layer.container);
            }
        });

        // Dynamic Ground leaves
        const groundContainer = document.querySelector('.ground-leaves');
        if (groundContainer && groundContainer.children.length === 0) {
            groundContainer.style.backgroundImage = '';
            for (let i = 0; i < 80; i++) {
                let leaf = document.createElement('div');
                leaf.className = 'ground-leaf';
                const shape = leafShapes[Math.floor(Math.random() * leafShapes.length)];
                const color = leafColors[Math.floor(Math.random() * leafColors.length)];
                leaf.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="${shape}" fill="${encodeURIComponent(color)}"/></svg>')`;

                const size = Math.random() * 25 + 20;
                leaf.style.width = `${size}px`;
                leaf.style.height = `${size}px`;
                leaf.style.left = `${Math.random() * 100}%`;
                leaf.style.bottom = `${Math.random() * 40 - 10}px`;
                leaf.style.opacity = Math.random() * 0.5 + 0.5;

                leaf.style.setProperty('--r1', `${Math.random() * 20 - 10}deg`);
                leaf.style.setProperty('--r2', `${Math.random() * 20 - 10}deg`);
                leaf.style.animationDuration = `${Math.random() * 5 + 5}s`;
                leaf.style.animationDelay = `-${Math.random() * 10}s`;

                groundContainer.appendChild(leaf);
            }
            this.registerContainer(groundContainer);
        }

        // Wind Particles
        const windContainer = document.getElementById('fall-wind-particles');
        if (windContainer && windContainer.children.length === 0) {
            for (let i = 0; i < 10; i++) {
                let particle = document.createElement('div');
                particle.className = 'fall-wind-particle';
                particle.style.top = `${Math.random() * 100}%`;
                const duration = Math.random() * 3 + 2;
                particle.style.animationDuration = `${duration}s`;
                particle.style.animationDelay = `-${Math.random() * duration}s`;
                windContainer.appendChild(particle);
            }
            this.registerContainer(windContainer);
        }
    }
}
