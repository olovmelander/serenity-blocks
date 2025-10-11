import { BaseTheme } from '../base-theme.js';

export default class KoiPondTheme extends BaseTheme {
    constructor() {
        super('koi-pond');
        this.koiInstances = [];
        this.lastRippleTime = 0;
    }

    async createScene() {
        // 1. Lily Pads
        const lilyPadContainer = document.getElementById('lily-pads');
        if (lilyPadContainer && lilyPadContainer.children.length === 0) {
            const numPads = 6;
            for (let i = 0; i < numPads; i++) {
                const pad = document.createElement('div');
                pad.className = 'lily-pad';
                const size = Math.random() * 50 + 70;
                pad.style.width = `${size}px`;
                pad.style.height = `${size}px`;
                pad.style.setProperty('--x-pos', `${10 + Math.random() * 80}vw`);
                pad.style.setProperty('--y-pos', `${10 + Math.random() * 80}vh`);
                pad.style.animationDelay = `-${Math.random() * 20}s`;
                lilyPadContainer.appendChild(pad);
            }
            this.registerContainer(lilyPadContainer);
        }

        // 2. Koi Fish & Ripples
        const koiContainer = document.getElementById('koi-fish');
        const rippleContainer = document.getElementById('koi-ripples');

        if (koiContainer && koiContainer.children.length === 0) {
            const numKoi = 7;
            const koiColors = [
                { base: '#f08c28', spots: ['#000', '#fff'] },
                { base: '#fff', spots: ['#d44d2d', '#000'] },
                { base: '#333', spots: ['#f08c28', '#fff'] },
                { base: '#f2c94c', spots: ['#fff'] },
            ];

            for (let i = 0; i < numKoi; i++) {
                const koi = document.createElement('div');
                koi.className = 'koi';

                const colors = koiColors[Math.floor(Math.random() * koiColors.length)];
                let spotsSvg = '';
                const spotCount = Math.floor(Math.random() * 4) + 2;
                for (let j = 0; j < spotCount; j++) {
                    spotsSvg += `<circle cx="${Math.random() * 80 + 10}" cy="${Math.random() * 20 + 10}" r="${Math.random() * 6 + 4}" fill="${colors.spots[Math.floor(Math.random() * colors.spots.length)]}" opacity="${Math.random() * 0.3 + 0.6}"/>`;
                }
                const koiSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M50 0 C20 0, 0 20, 0 20 S20 40, 50 40 C80 40, 100 20, 100 20 S80 0, 50 0 Z" fill="${colors.base}"/>${spotsSvg}</svg>`;
                koi.style.backgroundImage = `url('data:image/svg+xml;utf8,${encodeURIComponent(koiSvg)}')`;

                for (let j = 1; j <= 5; j++) {
                    koi.style.setProperty(`--x${j}`, `${Math.random() * 90}vw`);
                    koi.style.setProperty(`--y${j}`, `${Math.random() * 90}vh`);
                    koi.style.setProperty(`--r${j}`, `${Math.random() * 360}deg`);
                }
                const duration = Math.random() * 10 + 20;
                koi.style.animationDuration = `${duration}s`;
                koi.style.animationDelay = `-${Math.random() * duration}s`;

                koiContainer.appendChild(koi);
                this.koiInstances.push(koi);
            }
            this.registerContainer(koiContainer);

            const rippleLoop = timestamp => {
                if (!this.isActive) {
                    return;
                }
                // Generate ripple roughly every 500-1000ms
                if (timestamp - this.lastRippleTime > Math.random() * 500 + 500) {
                    this.lastRippleTime = timestamp;
                    const koi =
                        this.koiInstances[Math.floor(Math.random() * this.koiInstances.length)];
                    const rect = koi.getBoundingClientRect();

                    if (
                        rect.top > 0 &&
                        rect.left > 0 &&
                        rect.bottom < window.innerHeight &&
                        rect.right < window.innerWidth
                    ) {
                        const ripple = document.createElement('div');
                        ripple.className = 'koi-ripple';
                        const rippleX = rect.left + rect.width * 0.2;
                        const rippleY = rect.top + rect.height / 2;
                        ripple.style.left = `${rippleX}px`;
                        ripple.style.top = `${rippleY}px`;
                        ripple.style.width = `${rect.width * 1.5}px`;
                        ripple.style.height = `${rect.width * 1.5}px`;
                        ripple.addEventListener('animationend', () => ripple.remove(), {
                            once: true,
                        });
                        rippleContainer.appendChild(ripple);
                    }
                }
                const animId = requestAnimationFrame(rippleLoop);
                this.registerAnimation(animId);
            };
            rippleLoop(0);
            this.registerContainer(rippleContainer);
        }
    }
}
