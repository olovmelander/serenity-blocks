import { BaseTheme } from '../base-theme.js';

export default class MountainTheme extends BaseTheme {
    constructor() {
        super('mountain');
    }

    async createScene() {
        // Stars
        const starsContainer = document.getElementById('mountain-stars');
        if (starsContainer && starsContainer.children.length === 0) {
            for (let i = 0; i < 150; i++) {
                const star = document.createElement('div');
                star.className = 'mountain-star';
                const size = Math.random() * 2 + 1;
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.left = `${Math.random() * 100}%`;
                star.style.top = `${Math.random() * 50}%`;
                const dayNightCycle = document.querySelector('.mountain-sky').style.animation;
                star.style.setProperty('--start-op', 0);
                star.style.setProperty('--end-op', Math.random() * 0.8);
                star.style.animationDelay = `${Math.random() * 10}s`;
                starsContainer.appendChild(star);
            }
            this.registerContainer(starsContainer);
        }

        // Mountain Ranges
        const mountainLayers = [
            {
                el: document.getElementById('mountain-range-back'),
                color: '#3E517A',
                height: 0.6,
                peaks: 5,
                jaggedness: 0.4,
            },
            {
                el: document.getElementById('mountain-range-mid'),
                color: '#2C3E50',
                height: 0.7,
                peaks: 7,
                jaggedness: 0.6,
            },
            {
                el: document.getElementById('mountain-range-front'),
                color: '#1B2631',
                height: 0.8,
                peaks: 9,
                jaggedness: 0.8,
            },
        ];
        mountainLayers.forEach((layer) => {
            if (layer.el && layer.el.children.length === 0) {
                const canvas = document.createElement('canvas');
                const C_WIDTH = 2048;
                canvas.width = C_WIDTH * 2;
                canvas.height = window.innerHeight;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = layer.color;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);
                const y = canvas.height * layer.height;
                let x = 0;
                while (x < canvas.width) {
                    const peakWidth = canvas.width / (layer.peaks * 2);
                    const step = peakWidth / 20;
                    for (let i = 0; i < 20; i++) {
                        const sineX = (x / peakWidth) * Math.PI;
                        const sineY = Math.sin(sineX) * (peakWidth / 3) * (0.5 + Math.sin(x * 0.01) * 0.5);
                        const noise = (Math.random() - 0.5) * layer.jaggedness * step;
                        ctx.lineTo(x, y - sineY + noise);
                        x += step;
                    }
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.closePath();
                ctx.fill();
                canvas.style.position = 'absolute';
                canvas.style.left = '0';
                canvas.style.bottom = '0';
                canvas.style.width = `${canvas.width}px`;
                canvas.style.height = '100%';
                layer.el.appendChild(canvas);
                this.registerContainer(layer.el);
            }
        });

        // Clouds
        const cloudContainer = document.querySelector('.mountain-clouds');
        if (cloudContainer && cloudContainer.children.length === 0) {
            const canvas = document.createElement('canvas');
            canvas.width = 4096;
            canvas.height = 400;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';

            for (let i = 0; i < 15; i++) {
                const startX = Math.random() * canvas.width;
                const startY = Math.random() * (canvas.height * 0.6) + canvas.height * 0.1;
                const cloudLength = Math.random() * 400 + 200;
                const puffCount = 20;

                ctx.filter = `blur(${Math.random() * 10 + 8}px)`;

                for (let j = 0; j < puffCount; j++) {
                    const progress = j / puffCount;
                    const puffX = startX + progress * cloudLength + (Math.random() - 0.5) * 50;
                    const puffY = startY + Math.sin(progress * Math.PI) * 40 + (Math.random() - 0.5) * 30;
                    const maxRadius = Math.sin(progress * Math.PI) * 60 + 20;
                    const puffR = Math.random() * maxRadius;

                    ctx.beginPath();
                    ctx.arc(puffX, puffY, puffR, 0, 2 * Math.PI);
                    ctx.fill();
                }
            }
            canvas.style.position = 'absolute';
            canvas.style.left = '0';
            canvas.style.top = '0';
            canvas.style.width = `${canvas.width}px`;
            canvas.style.height = '100%';
            cloudContainer.appendChild(canvas);
            this.registerContainer(cloudContainer);
        }
    }
}
