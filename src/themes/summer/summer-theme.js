import { BaseTheme } from '../base-theme.js';

export default class SummerTheme extends BaseTheme {
    constructor() {
        super('summer');
    }

    async createScene() {
        // God Rays
        const godRayContainer = document.querySelector('.god-rays-summer');
        if (godRayContainer && godRayContainer.children.length === 0) {
            for (let i = 0; i < 20; i++) {
                let ray = document.createElement('div');
                ray.className = 'summer-god-ray';
                ray.style.left = `${Math.random() * 140 - 20}%`;
                ray.style.top = '0px';
                ray.style.width = `${Math.random() * 4 + 2}px`;
                ray.style.height = '120%';
                ray.style.transform = `rotate(${Math.random() * 40 - 20}deg)`;
                ray.style.animationDelay = `-${Math.random() * 8}s`;
                godRayContainer.appendChild(ray);
            }
            this.registerContainer(godRayContainer);
        }

        // Dandelion Seeds
        const seedContainer = document.getElementById('dandelion-seeds');
        if (seedContainer && seedContainer.children.length === 0) {
            for (let i = 0; i < 60; i++) {
                let seed = document.createElement('div');
                seed.className = 'dandelion-seed';
                const xStart = Math.random() * 100;
                const yStart = 100 + Math.random() * 20;
                const xEnd = Math.random() * 100;
                const yEnd = -20 + Math.random() * -20;
                seed.style.setProperty('--x-start', `${xStart}vw`);
                seed.style.setProperty('--y-start', `${yStart}vh`);
                seed.style.setProperty('--x-mid', `${xStart + (Math.random() - 0.5) * 40}vw`);
                seed.style.setProperty('--y-mid', `${(yStart + yEnd) / 2}vh`);
                seed.style.setProperty('--x-end', `${xEnd}vw`);
                seed.style.setProperty('--y-end', `${yEnd}vh`);
                seed.style.animationDuration = `${Math.random() * 10 + 15}s`;
                seed.style.animationDelay = `-${Math.random() * 25}s`;
                seedContainer.appendChild(seed);
            }
            this.registerContainer(seedContainer);
        }

        // Swaying Grass
        const grassContainer = document.querySelector('.summer-grass');
        if (grassContainer && grassContainer.children.length === 0) {
            for (let i = 0; i < 120; i++) {
                let blade = document.createElement('div');
                blade.className = 'summer-grass-blade';
                blade.style.left = `${Math.random() * 100}%`;
                blade.style.height = `${Math.random() * 40 + 20}px`;
                blade.style.animationDelay = `-${Math.random() * 7}s`;
                blade.style.filter = `brightness(${Math.random() * 0.3 + 0.8})`;
                grassContainer.appendChild(blade);
            }
            this.registerContainer(grassContainer);
        }
    }
}
