import { BaseTheme } from '../base-theme.js';

export default class GalaxyTheme extends BaseTheme {
    constructor() {
        super('galaxy');
    }

    async createScene() {
        // Background Stars
        const starsContainer = document.getElementById('galaxy-stars-bg');
        if (starsContainer && starsContainer.children.length === 0) {
            for (let i = 0; i < 200; i++) {
                const star = document.createElement('div');
                star.className = 'galaxy-star-bg';
                const size = Math.random() * 2 + 0.5;
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.left = `${Math.random() * 100}%`;
                star.style.top = `${Math.random() * 100}%`;
                star.style.animationDelay = `${Math.random() * 15}s`;
                starsContainer.appendChild(star);
            }
            this.registerContainer(starsContainer);
        }
    }
}
