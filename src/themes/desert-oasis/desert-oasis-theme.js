import { BaseTheme } from '../base-theme.js';

export default class DesertOasisTheme extends BaseTheme {
    constructor() {
        super('desert-oasis');
        this.shootingStarTimeout = null;
    }

    async createScene() {
        // NOTE: This is a simplified version - full version uses WebGL for pyramids and dunes
        // See script.js lines 6041-6300 for complete implementation

        // Stars
        const starsContainer = document.getElementById('desert-stars');
        if (starsContainer && starsContainer.children.length === 0) {
            for (let i = 0; i < 120; i++) {
                const star = document.createElement('div');
                star.className = 'desert-star';
                const size = Math.random() * 2 + 0.5;
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.left = `${Math.random() * 100}%`;
                star.style.top = `${Math.random() * 70}%`;
                star.style.setProperty('--twinkle-delay', `${Math.random() * 8}s`);
                star.style.animationDelay = `-${Math.random() * 12}s`;
                starsContainer.appendChild(star);
            }
            this.registerContainer(starsContainer);

            // Shooting stars
            const createShootingStar = () => {
                if (!this.isActive) return;
                const shootingStar = document.createElement('div');
                shootingStar.className = 'shooting-star';
                shootingStar.style.left = `${Math.random() * 50 + 25}%`;
                shootingStar.style.top = `${Math.random() * 30}%`;
                shootingStar.style.setProperty('--angle', `${Math.random() * 30 + 30}deg`);
                starsContainer.appendChild(shootingStar);
                shootingStar.addEventListener('animationend', () => shootingStar.remove());
                this.shootingStarTimeout = setTimeout(createShootingStar, Math.random() * 30000 + 30000);
            };
            this.shootingStarTimeout = setTimeout(createShootingStar, 15000);
        }

        // TODO: Add WebGL pyramids and sand dune layers
        // Full implementation requires webglRenderer integration
    }

    stop() {
        if (this.shootingStarTimeout) {
            clearTimeout(this.shootingStarTimeout);
            this.shootingStarTimeout = null;
        }
        super.stop();
    }
}
