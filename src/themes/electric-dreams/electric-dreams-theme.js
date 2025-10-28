import { BaseTheme } from '../base-theme.js';

export default class ElectricDreamsTheme extends BaseTheme {
    constructor() {
        super('electric-dreams');
    }

    async createScene() {
        // 1. Create morphing, glowing veins
        const veinContainer = document.getElementById('electric-veins');
        if (veinContainer && veinContainer.children.length === 0) {
            const numVeins = 10;
            for (let i = 0; i < numVeins; i++) {
                const vein = document.createElement('div');
                vein.className = 'electric-vein';
                const size = Math.random() * 120 + 80;
                vein.style.width = `${size}px`;
                vein.style.height = `${size}px`;

                vein.style.setProperty('--x-start', `${Math.random() * 80 + 10}vw`);
                vein.style.setProperty('--y-start', `${Math.random() * 80 + 10}vh`);
                vein.style.setProperty('--x-end', `${Math.random() * 80 + 10}vw`);
                vein.style.setProperty('--y-end', `${Math.random() * 80 + 10}vh`);
                vein.style.setProperty('--scale-start', `${Math.random() * 0.5 + 0.8}`);
                vein.style.setProperty('--scale-end', `${Math.random() * 0.5 + 0.8}`);
                vein.style.setProperty('--hue-start', `${Math.random() * 360}deg`);
                vein.style.setProperty('--hue-end', `${Math.random() * 360}deg`);

                const moveDuration = Math.random() * 15 + 20;
                const pulseDuration = Math.random() * 2 + 5;
                vein.style.animationDuration = `${moveDuration}s, ${pulseDuration}s, 20s`;
                vein.style.animationDelay = `-${Math.random() * moveDuration}s, -${Math.random() * pulseDuration}s, -${Math.random() * 20}s`;
                vein.style.willChange = 'transform, filter';
                vein.style.transform = 'translate3d(0,0,0)';

                veinContainer.appendChild(vein);
            }
            this.registerContainer(veinContainer);
        }

        // 2. Create glowing particles
        const particleContainer = document.getElementById('electric-particles');
        if (particleContainer && particleContainer.children.length === 0) {
            const numParticles = 40;
            for (let i = 0; i < numParticles; i++) {
                const particle = document.createElement('div');
                particle.className = 'electric-particle';
                const size = Math.random() * 3 + 1;
                particle.style.width = `${size}px`;
                particle.style.height = `${size}px`;

                particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                particle.style.setProperty('--y-start', `${Math.random() * 100}vh`);
                particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                particle.style.setProperty('--y-end', `${Math.random() * 100}vh`);

                const duration = Math.random() * 10 + 10;
                particle.style.animationDuration = `${duration}s`;
                particle.style.animationDelay = `-${Math.random() * duration}s`;
                particle.style.willChange = 'transform, opacity';
                particle.style.transform = 'translate3d(0,0,0)';

                particleContainer.appendChild(particle);
            }
            this.registerContainer(particleContainer);
        }
    }
}
