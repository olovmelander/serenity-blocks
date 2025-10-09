import { BaseTheme } from '../base-theme.js';

export default class SingingBowlTheme extends BaseTheme {
    constructor() {
        super('singing-bowl');
    }

    async createScene() {
        const ripplesContainer = document.getElementById('bowl-ripples');
        if (ripplesContainer && ripplesContainer.children.length === 0) {
            for (let i=0; i<5; i++) {
                let ripple = document.createElement('div');
                ripple.className = 'bowl-ripple';
                const duration = Math.random() * 4 + 6;
                ripple.style.animationDuration = `${duration}s`;
                ripple.style.animationDelay = `-${Math.random() * duration}s`;
                ripple.style.opacity = Math.random() * 0.4 + 0.6;
                ripplesContainer.appendChild(ripple);
            }
            this.registerContainer(ripplesContainer);
        }
        const motesContainer = document.getElementById('bowl-motes');
        if (motesContainer && motesContainer.children.length === 0) {
            for (let i=0; i<40; i++) {
                let mote = document.createElement('div');
                mote.className = 'bowl-mote';
                const size = Math.random() * 4 + 1;
                mote.style.width = `${size}px`;
                mote.style.height = `${size}px`;
                mote.style.left = `${Math.random() * 40 + 30}%`;
                mote.style.animationDuration = `${Math.random() * 8 + 12}s`;
                mote.style.animationDelay = `-${Math.random() * 20}s`;
                mote.style.setProperty('--x-drift', `${Math.random() * 10 - 5}vw`);
                motesContainer.appendChild(mote);
            }
            this.registerContainer(motesContainer);
        }
    }
}
