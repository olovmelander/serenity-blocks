import { BaseTheme } from '../base-theme.js';

export default class BioluminescenceTheme extends BaseTheme {
    constructor() {
        super('bioluminescence');
    }

    async createScene() {
        const mushroomContainer = document.getElementById('bio-mushrooms');
        if (mushroomContainer && mushroomContainer.children.length === 0) {
            const numMushrooms = 20;
            for (let i = 0; i < numMushrooms; i++) {
                const mushroom = document.createElement('div');
                mushroom.className = 'bio-mushroom';
                const cap = document.createElement('div');
                cap.className = 'bio-mushroom-cap';
                const stem = document.createElement('div');
                stem.className = 'bio-mushroom-stem';

                mushroom.appendChild(cap);
                mushroom.appendChild(stem);

                const size = Math.random() * 60 + 40;
                mushroom.style.width = `${size}px`;
                mushroom.style.height = `${size * 1.25}px`;
                mushroom.style.left = `${Math.random() * 95}%`;
                mushroom.style.bottom = `-${Math.random() * 20}px`;
                mushroom.style.zIndex = Math.floor(Math.random() * 4) + 1;
                cap.style.animationDelay = `-${Math.random() * 10}s`;

                mushroomContainer.appendChild(mushroom);
            }
            this.registerContainer(mushroomContainer);
        }
        const sporeContainer = document.getElementById('bio-spores');
        if (sporeContainer && sporeContainer.children.length === 0) {
            for (let i = 0; i < 50; i++) {
                const spore = document.createElement('div');
                spore.className = 'bio-spore';
                spore.style.left = `${Math.random() * 100}%`;
                spore.style.bottom = `${Math.random() * 100}%`;
                spore.style.setProperty('--x-drift', `${Math.random() * 10 - 5}vw`);
                spore.style.animationDelay = `-${Math.random() * 20}s`;
                sporeContainer.appendChild(spore);
            }
            this.registerContainer(sporeContainer);
        }
    }
}
