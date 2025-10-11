import { BaseTheme } from '../base-theme.js';

export default class WinterTheme extends BaseTheme {
    constructor() {
        super('winter');
    }

    async createScene() {
        // Multi-layered snowfall
        const snowflakeLayers = [
            {
                container: document.getElementById('snowflakes-back'),
                count: 70,
                minSize: 1,
                maxSize: 3,
                minDuration: 20,
                maxDuration: 30,
            },
            {
                container: document.getElementById('snowflakes-mid'),
                count: 50,
                minSize: 2,
                maxSize: 5,
                minDuration: 10,
                maxDuration: 15,
            },
            {
                container: document.getElementById('snowflakes-front'),
                count: 30,
                minSize: 4,
                maxSize: 8,
                minDuration: 5,
                maxDuration: 8,
            },
        ];

        snowflakeLayers.forEach(layer => {
            if (layer.container && layer.container.children.length === 0) {
                for (let i = 0; i < layer.count; i++) {
                    const flake = document.createElement('div');
                    flake.className = 'snowflake';
                    const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                    flake.style.width = `${size}px`;
                    flake.style.height = `${size}px`;
                    const xStart = Math.random() * 120 - 10;
                    const windEffect = (Math.random() - 0.5) * 50;
                    flake.style.setProperty('--x-start', `${xStart}vw`);
                    flake.style.setProperty(
                        '--x-end',
                        `${xStart + windEffect + (Math.random() * 20 - 10)}vw`
                    );
                    flake.style.setProperty('--r-end', `${Math.random() * 720 - 360}deg`);
                    const duration =
                        Math.random() * (layer.maxDuration - layer.minDuration) + layer.minDuration;
                    flake.style.animationDuration = `${duration}s`;
                    flake.style.animationDelay = `-${Math.random() * duration}s`;
                    layer.container.appendChild(flake);
                }
                this.registerContainer(layer.container);
            }
        });

        // Ice crystal generation
        const crystalContainer = document.querySelector('.ice-crystals');
        if (crystalContainer && crystalContainer.children.length === 0) {
            for (let i = 0; i < 5; i++) {
                const crystal = document.createElement('div');
                crystal.className = 'ice-crystal';

                // Position near corners
                const corner = Math.floor(Math.random() * 4);
                const xPos =
                    corner % 2 === 0 ? `${Math.random() * 20}%` : `${80 + Math.random() * 20}%`;
                const yPos = corner < 2 ? `${Math.random() * 20}%` : `${80 + Math.random() * 20}%`;
                crystal.style.left = xPos;
                crystal.style.top = yPos;

                const size = Math.random() * 80 + 40;
                crystal.style.width = `${size}px`;
                crystal.style.height = `${size}px`;
                crystal.style.animationDelay = `-${Math.random() * 30}s`;
                crystalContainer.appendChild(crystal);
            }
            this.registerContainer(crystalContainer);
        }
    }
}
