import { BaseTheme } from '../base-theme.js';

export default class ElectricDreamsTheme extends BaseTheme {
    constructor() {
        super('electric-dreams');
    }

    async createScene() {
        // 1. Create morphing, glowing blobs (lava lamp effect)
        const veinContainer = document.getElementById('electric-veins');
        if (veinContainer && veinContainer.children.length === 0) {
            // LAVA LAMP: More blobs with overlapping paths for constant merging
            const numVeins = 10;
            for (let i = 0; i < numVeins; i++) {
                const vein = document.createElement('div');
                vein.className = 'electric-vein';
                // LAVA LAMP: Varied sizes (180-320px) for organic feel
                const size = Math.random() * 140 + 180;
                vein.style.width = `${size}px`;
                vein.style.height = `${size}px`;

                // LAVA LAMP: Free-flowing movement across nearly entire screen
                const xStart = Math.random() * 90 + 5; // 5-95% of screen width
                const yStart = Math.random() * 90 + 5; // 5-95% of screen height
                const xEnd = Math.random() * 90 + 5;
                const yEnd = Math.random() * 90 + 5;

                vein.style.setProperty('--x-start', `${xStart}vw`);
                vein.style.setProperty('--y-start', `${yStart}vh`);
                vein.style.setProperty('--x-end', `${xEnd}vw`);
                vein.style.setProperty('--y-end', `${yEnd}vh`);

                // LAVA LAMP: Minimal scale variation for consistent merging
                vein.style.setProperty('--scale-start', `${Math.random() * 0.2 + 0.95}`);
                vein.style.setProperty('--scale-end', `${Math.random() * 0.2 + 0.95}`);
                vein.style.setProperty('--hue-start', `${Math.random() * 360}deg`);
                vein.style.setProperty('--hue-end', `${Math.random() * 360}deg`);

                // LAVA LAMP: Super slow, hypnotic movement (35-60s)
                const moveDuration = Math.random() * 25 + 35;
                const pulseDuration = Math.random() * 3 + 6;
                const morphDuration = Math.random() * 5 + 10;
                vein.style.animationDuration = `${moveDuration}s, ${pulseDuration}s, 20s, ${morphDuration}s`;
                vein.style.animationDelay = `-${Math.random() * moveDuration}s, -${Math.random() * pulseDuration}s, -${Math.random() * 20}s, -${Math.random() * morphDuration}s`;
                vein.style.willChange = 'transform, filter';
                vein.style.transform = 'translate3d(0,0,0)';

                veinContainer.appendChild(vein);
            }
            this.registerContainer(veinContainer);
        }

        // 2. Create glowing particles
        const particleContainer = document.getElementById('electric-particles');
        if (particleContainer && particleContainer.children.length === 0) {
            // OPTIMIZATION: Reduced from 40 to 30 particles for better performance
            const numParticles = 30;
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
