import { BaseTheme } from '../base-theme.js';

export default class StarlightTheme extends BaseTheme {
    constructor() {
        super('starlight');
    }

    async createScene() {
        const layers = [
            { container: document.getElementById('starlights-back'), count: 40, minSize: 0.5, maxSize: 1.5 },
            { container: document.getElementById('starlights-mid'), count: 30, minSize: 1, maxSize: 2 },
            { container: document.getElementById('starlights-front'), count: 20, minSize: 1.5, maxSize: 2.5 }
        ];
        layers.forEach(layer => {
            if (layer.container && layer.container.children.length === 0) {
                for (let i = 0; i < layer.count; i++) {
                    let star = document.createElement('div');
                    star.className = 'starlight';
                    const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                    star.style.width = `${size}px`;
                    star.style.height = `${size}px`;
                    star.style.left = `${Math.random() * 100}%`;
                    star.style.top = `${Math.random() * 100}%`;
                    star.style.animationDelay = `-${Math.random() * 8}s`;
                    layer.container.appendChild(star);
                }
                this.registerContainer(layer.container);
            }
        });

        // Add shooting stars
        const shootingStarContainer = document.getElementById('starlight-shooting-stars');
        if (shootingStarContainer && shootingStarContainer.children.length === 0) {
            for (let i = 0; i < 5; i++) {
                let star = document.createElement('div');
                star.className = 'shooting-star-starlight';
                star.style.top = `${Math.random() * 100}%`;
                const duration = Math.random() * 4 + 3;
                star.style.animationDuration = `${duration}s`;
                star.style.animationDelay = `-${Math.random() * 20}s`;
                star.style.width = `${Math.random() * 100 + 150}px`;
                shootingStarContainer.appendChild(star);
            }
            this.registerContainer(shootingStarContainer);
        }
    }
}
