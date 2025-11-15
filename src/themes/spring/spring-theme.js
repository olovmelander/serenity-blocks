import { BaseTheme } from '../base-theme.js';
import { SPRING_TETROMINOS } from './spring-tetrominos.js';

export default class SpringTheme extends BaseTheme {
    constructor() {
        super('spring');
    }

    async createScene() {
        // Drifting Clouds
        const cloudContainer = document.getElementById('spring-clouds');
        if (cloudContainer && cloudContainer.children.length === 0) {
            for (let i = 0; i < 15; i++) {
                const cloud = document.createElement('div');
                cloud.className = 'spring-cloud';
                const size = Math.random() * 150 + 100;
                cloud.style.width = `${size}px`;
                cloud.style.height = `${size * 0.6}px`;
                cloud.style.top = `${Math.random() * 50}%`;
                cloud.style.opacity = Math.random() * 0.4 + 0.3;
                const duration = Math.random() * 80 + 60;
                cloud.style.animationDuration = `${duration}s`;
                cloud.style.animationDelay = `-${Math.random() * duration}s`;
                cloudContainer.appendChild(cloud);
            }
            this.registerContainer(cloudContainer);
        }

        // Multi-layered Rain
        const rainLayers = [
            {
                container: document.getElementById('rain-back'),
                count: 50,
                width: '0.8px',
                height: '40px',
                duration: 0.6,
                drift: -10,
            },
            {
                container: document.getElementById('rain-mid'),
                count: 60,
                width: '1px',
                height: '60px',
                duration: 0.5,
                drift: -15,
            },
            {
                container: document.getElementById('rain-front'),
                count: 30,
                width: '1.2px',
                height: '80px',
                duration: 0.4,
                drift: -20,
            },
        ];
        rainLayers.forEach((layer) => {
            if (layer.container && layer.container.children.length === 0) {
                for (let i = 0; i < layer.count; i++) {
                    const drop = document.createElement('div');
                    drop.className = 'spring-raindrop';
                    drop.style.left = `${Math.random() * 105}%`;
                    drop.style.width = layer.width;
                    drop.style.height = layer.height;
                    const animDuration = Math.random() * 0.2 + layer.duration;
                    drop.style.animationDuration = `${animDuration}s`;
                    drop.style.animationDelay = `-${Math.random() * animDuration * 5}s`;
                    drop.style.setProperty('--x-drift', `${layer.drift}px`);
                    layer.container.appendChild(drop);
                }
                this.registerContainer(layer.container);
            }
        });

        // Unfurling Sprouts with Life Cycle
        const sproutsContainer = document.getElementById('sprouts-container');
        if (sproutsContainer && sproutsContainer.children.length === 0) {
            for (let i = 0; i < 25; i++) {
                const sprout = document.createElement('div');
                sprout.className = 'sprout';
                sprout.style.left = `${5 + Math.random() * 90}%`;
                sprout.style.animationDelay = `-${Math.random() * 25}s`;

                const leftLeaf = document.createElement('div');
                leftLeaf.className = 'left';
                const rightLeaf = document.createElement('div');
                rightLeaf.className = 'right';

                // Vary sway speed for each sprout
                const swayDuration = Math.random() * 2 + 4;
                leftLeaf.style.animationDuration = `${swayDuration}s`;
                rightLeaf.style.animationDuration = `${swayDuration}s`;

                sprout.appendChild(leftLeaf);
                sprout.appendChild(rightLeaf);
                sproutsContainer.appendChild(sprout);
            }
            this.registerContainer(sproutsContainer);
        }
    }

    /**
     * Provide Spring themed tetrominos (pastel bloom palette)
     * @returns {Object} Spring tetromino configuration
     */
    getTetrominoConfig() {
        return SPRING_TETROMINOS;
    }
}
