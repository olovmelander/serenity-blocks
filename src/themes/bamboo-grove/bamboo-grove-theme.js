import { BaseTheme } from '../base-theme.js';

export default class BambooGroveTheme extends BaseTheme {
    constructor() {
        super('bamboo-grove');
    }

    async createScene() {
        // NOTE: Simplified version - see script.js lines 6458-6540 for full implementation

        // Sun dapples
        const dappleContainer = document.getElementById('bamboo-sun-dapples');
        if (dappleContainer && dappleContainer.children.length === 0) {
            for (let i = 0; i < 15; i++) {
                const dapple = document.createElement('div');
                dapple.className = 'sun-dapple';
                dapple.style.left = `${Math.random() * 100}%`;
                dapple.style.top = `${Math.random() * 100}%`;
                const size = Math.random() * 100 + 70;
                dapple.style.width = `${size}px`;
                dapple.style.height = `${size}px`;
                dapple.style.setProperty('--pulse-scale', Math.random() * 0.25 + 0.9);
                dapple.style.animationDelay = `-${Math.random() * 12}s`;
                dappleContainer.appendChild(dapple);
            }
            this.registerContainer(dappleContainer);
        }

        // TODO: Add bamboo stalks (back/mid/front layers), falling leaves
        // Full implementation in script.js createBambooGroveScene()
    }
}
