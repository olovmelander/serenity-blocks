import { BaseTheme } from '../base-theme.js';

export default class CosmicChimesTheme extends BaseTheme {
    constructor() {
        super('cosmic-chimes');
    }

    async createScene() {
        const dustContainer = document.getElementById('space-dust');
        if (dustContainer && dustContainer.children.length === 0) {
            for (let i = 0; i < 70; i++) {
                let particle = document.createElement('div');
                particle.className = 'dust-particle';
                const size = Math.random() * 2 + 1;
                particle.style.width = `${size}px`;
                particle.style.height = `${size}px`;
                particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                particle.style.setProperty('--y-start', `${Math.random() * 100}vh`);
                particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                particle.style.setProperty('--y-end', `${Math.random() * 100}vh`);
                particle.style.animationDelay = `-${Math.random() * 30}s`;
                dustContainer.appendChild(particle);
            }
            this.registerContainer(dustContainer);
        }
        const chimesContainer = document.getElementById('chimes');
        if (chimesContainer && chimesContainer.children.length === 0) {
             for (let i = 0; i < 12; i++) {
                let chime = document.createElement('div');
                chime.className = 'chime';
                chime.style.left = `${5 + Math.random() * 90}%`;
                chime.style.top = `${-10 + Math.random() * 30}%`;
                chime.style.setProperty('--r-start', `${Math.random() * 10 - 5}deg`);
                chime.style.setProperty('--r-end', `${Math.random() * 10 - 5}deg`);
                chime.style.animationDelay = `-${Math.random() * 12}s`;
                chimesContainer.appendChild(chime);
            }
            this.registerContainer(chimesContainer);
        }
    }
}
