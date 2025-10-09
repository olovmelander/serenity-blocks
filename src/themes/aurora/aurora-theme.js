import { BaseTheme } from '../base-theme.js';

export default class AuroraTheme extends BaseTheme {
    constructor() {
        super('aurora');
    }

    async createScene() {
        // NOTE: This is a simplified version of the aurora theme
        // The original implementation is highly complex with dynamic keyframes and color cycling
        // For full functionality, additional work may be needed to port all dynamic animations

        const starsContainer = document.getElementById('aurora-stars');
        if (starsContainer && starsContainer.children.length === 0) {
            const fragment = document.createDocumentFragment();
            const starCount = 48;
            for (let i = 0; i < starCount; i++) {
                const star = document.createElement('div');
                star.className = 'aurora-star';
                const size = this.random(0.6, 1.2);
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.left = `${this.random(0, 100)}%`;
                star.style.top = `${this.random(0, 100)}%`;
                star.style.opacity = `${this.random(0.3, 0.8).toFixed(2)}`;
                star.style.animationDelay = `${this.random(0, 8)}s`;
                fragment.appendChild(star);
            }
            starsContainer.appendChild(fragment);
            this.registerContainer(starsContainer);
        }

        this.generateAuroraCurtains();
        this.generateAuroraShimmers();
    }

    generateAuroraCurtains() {
        const veilContainer = this.getContainer('aurora-veil-container');
        if (!veilContainer || veilContainer.children.length > 0) return;

        const layerCount = 2;
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < layerCount; i++) {
            const veil = document.createElement('div');
            veil.className = 'aurora-veil';

            const hue = this.random(120, 140);
            const duration = this.random(18, 24);
            const glow = this.random(7, 9);
            const shift = this.random(3, 8);
            const rise = this.random(-6, -3);
            const tilt = this.random(-3, 3);
            const opacity = this.random(0.25, 0.38);
            const height = this.random(40, 48);
            const top = this.random(22, 32);
            const leftOffset = this.random(-4, 4);

            veil.style.setProperty('--aurora-hue', hue.toFixed(1));
            veil.style.setProperty('--aurora-duration', `${duration.toFixed(2)}s`);
            veil.style.setProperty('--aurora-glow', `${glow.toFixed(2)}s`);
            veil.style.setProperty('--aurora-offset', `${shift.toFixed(2)}%`);
            veil.style.setProperty('--aurora-rise', `${rise.toFixed(2)}%`);
            veil.style.setProperty('--aurora-tilt', `${tilt.toFixed(2)}deg`);
            veil.style.setProperty('--aurora-opacity', opacity.toFixed(2));
            veil.style.setProperty('--aurora-height', `${height.toFixed(2)}vh`);
            const insetTop = top.toFixed(2);
            const insetLeft = (-15 + leftOffset).toFixed(2);
            veil.style.setProperty('--aurora-inset', `${insetTop}% ${insetLeft}% auto ${insetLeft}%`);
            veil.style.zIndex = `${2 + i}`;
            veil.style.animationDelay = `${this.random(0, 4).toFixed(2)}s`;

            fragment.appendChild(veil);
        }

        veilContainer.appendChild(fragment);
    }

    generateAuroraShimmers() {
        const shimmerContainer = this.getContainer('aurora-shimmers');
        if (shimmerContainer) {
            shimmerContainer.innerHTML = '';
        }
    }
}
