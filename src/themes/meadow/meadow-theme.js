import { BaseTheme } from '../base-theme.js';

export default class MeadowTheme extends BaseTheme {
    constructor() {
        super('meadow');
    }

    async createScene() {
        // 1. Swaying Grass
        const grassContainer = document.querySelector('.meadow-grass');
        if (grassContainer && grassContainer.children.length === 0) {
            for (let i = 0; i < 150; i++) {
                let blade = document.createElement('div');
                blade.className = 'grass-blade';
                blade.style.left = `${Math.random() * 100}%`;
                blade.style.height = `${Math.random() * 60 + 40}px`;
                const swayDuration = Math.random() * 4 + 4;
                blade.style.animationDuration = `${swayDuration}s`;
                blade.style.animationDelay = `-${Math.random() * swayDuration}s`;
                blade.style.background = `linear-gradient(to top, #4a7c3b, hsl(90, 39%, ${Math.random() * 15 + 45}%))`;
                grassContainer.appendChild(blade);
            }
            this.registerContainer(grassContainer);
        }

        // 2. Colorful Flowers
        const flowerContainer = document.getElementById('meadow-flowers');
        if (flowerContainer && flowerContainer.children.length === 0) {
            const flowerData = [
                { color: '#e53935', svg: '<path d="M10 25 L5 15 A5 5 0 1 1 15 15 L10 25 Z" fill="{color}"/>' },
                { color: '#fdd835', svg: '<circle cx="10" cy="10" r="5" fill="{color}"/><circle cx="10" cy="10" r="2" fill="#8d6e63"/>' },
                { color: '#8e24aa', svg: '<path d="M10 25 L5 20 L0 10 L5 0 L15 0 L20 10 L15 20 Z" fill="{color}"/>' }
            ];
            for (let i = 0; i < 25; i++) {
                let flower = document.createElement('div');
                flower.className = 'meadow-flower';
                const data = flowerData[Math.floor(Math.random() * flowerData.length)];
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 25">${data.svg.replace('{color}', data.color)}</svg>`;
                flower.style.backgroundImage = `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}')`;
                flower.style.left = `${Math.random() * 98}%`;
                flower.style.bottom = `${Math.random() * 60}%`;
                flower.style.animationDelay = `-${Math.random() * 10}s`;
                flowerContainer.appendChild(flower);
            }
            this.registerContainer(flowerContainer);
        }

        // 3. Enhanced Butterflies
        const butterflyContainer = document.getElementById('meadow-butterflies');
        if (butterflyContainer && butterflyContainer.children.length === 0) {
            const wingColors = [
                { stroke: 'gold', fill: 'rgba(255,215,0,0.7)' },
                { stroke: '#a29bfe', fill: 'rgba(162,155,254,0.7)' },
                { stroke: '#ff7675', fill: 'rgba(255,118,117,0.7)' }
            ];
            for (let i = 0; i < 10; i++) {
                let butterfly = document.createElement('div');
                butterfly.className = 'butterfly';
                const wingLeft = document.createElement('div');
                wingLeft.className = 'butterfly-wing left';
                const wingRight = document.createElement('div');
                wingRight.className = 'butterfly-wing right';

                const colors = wingColors[Math.floor(Math.random() * wingColors.length)];
                const wingSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15 30"><path d="M 15 15 C 0 0, 0 30, 15 15" stroke="${colors.stroke}" fill="${colors.fill}" stroke-width="2"/></svg>`;
                wingLeft.style.backgroundImage = `url('data:image/svg+xml;utf8,${encodeURIComponent(wingSvg)}')`;
                wingRight.style.backgroundImage = `url('data:image/svg+xml;utf8,${encodeURIComponent(wingSvg)}')`;

                butterfly.appendChild(wingLeft);
                butterfly.appendChild(wingRight);

                for(let j=1; j<=8; j++){
                    butterfly.style.setProperty(`--x${j}`, `${Math.random() * 90}vw`);
                    butterfly.style.setProperty(`--y${j}`, `${Math.random() * 70}vh`);
                }
                const duration = Math.random() * 10 + 15;
                butterfly.style.animationDuration = `${duration}s`;
                butterfly.style.animationDelay = `-${Math.random() * duration}s`;
                const flapSpeed = Math.random() * 0.3 + 0.3;
                wingLeft.style.animationDuration = `${flapSpeed}s`;
                wingRight.style.animationDuration = `${flapSpeed}s`;

                butterflyContainer.appendChild(butterfly);
            }
            this.registerContainer(butterflyContainer);
        }

        // 4. Improved Pollen
        const pollenContainer = document.getElementById('meadow-pollen');
        if (pollenContainer && pollenContainer.children.length === 0) {
            for (let i = 0; i < 100; i++) {
                let particle = document.createElement('div');
                particle.className = 'pollen-particle';
                particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                particle.style.setProperty('--y-start', `${100 + Math.random() * 30}vh`);
                particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                for(let j = 1; j <= 3; j++) {
                    particle.style.setProperty(`--x-gust${j}`, `${Math.random() * 60 - 30}vw`);
                }
                particle.style.animationDelay = `-${Math.random() * 10}s`;
                pollenContainer.appendChild(particle);
            }
            this.registerContainer(pollenContainer);
        }
    }
}
