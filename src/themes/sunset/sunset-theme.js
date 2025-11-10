import { BaseTheme } from '../base-theme.js';

export default class SunsetTheme extends BaseTheme {
    constructor() {
        super('sunset');
    }

    async createScene() {
        const themeContainer = document.getElementById('sunset-theme');
        const sun = themeContainer.querySelector('.sun');

        // Procedurally generate clouds
        const cloudLayers = [
            {
                el: document.getElementById('sunset-clouds-back'),
                count: 10,
                color: 'rgba(255, 255, 255, 0.2)',
                height: 300,
                width: 800,
            },
            {
                el: document.getElementById('sunset-clouds-mid'),
                count: 8,
                color: 'rgba(255, 230, 200, 0.5)',
                height: 250,
                width: 600,
            },
            {
                el: document.getElementById('sunset-clouds-front'),
                count: 6,
                color: 'rgba(255, 240, 220, 0.8)',
                height: 200,
                width: 400,
            },
        ];

        cloudLayers.forEach((layer) => {
            if (layer.el && layer.el.children.length === 0) {
                const canvas = document.createElement('canvas');
                canvas.width = layer.count * layer.width;
                canvas.height = layer.height;
                const ctx = canvas.getContext('2d');

                for (let i = 0; i < layer.count; i++) {
                    const x = i * layer.width + Math.random() * (layer.width / 2);
                    const y = Math.random() * (canvas.height * 0.4) + canvas.height * 0.1;
                    const w = layer.width * (0.6 + Math.random() * 0.4);
                    const h = layer.height * (0.4 + Math.random() * 0.3);
                    ctx.fillStyle = layer.color;
                    ctx.filter = `blur(${Math.random() * 10 + 5}px)`;

                    for (let j = 0; j < 8; j++) {
                        const puffX = x + (Math.random() - 0.5) * w;
                        const puffY = y + (Math.random() - 0.5) * h;
                        const puffR = Math.random() * (w / 4) + w / 8;
                        ctx.beginPath();
                        ctx.arc(puffX, puffY, puffR, 0, 2 * Math.PI);
                        ctx.fill();
                    }
                }
                canvas.style.position = 'absolute';
                canvas.style.left = '0';
                canvas.style.top = `${Math.random() * 20}%`;
                canvas.style.width = `${canvas.width}px`;
                canvas.style.height = '100%';
                layer.el.appendChild(canvas);
                this.registerContainer(layer.el);
            }
        });

        // Procedurally generate mountain silhouette
        const mountainContainer = document.querySelector('.mountain-silhouette');
        if (mountainContainer && mountainContainer.children.length === 0) {
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight * 0.25;
            const ctx = canvas.getContext('2d');

            const drawMountainRange = (color, startY, amplitude, peaks) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);
                let x = 0;
                while (x < canvas.width) {
                    const peakWidth = canvas.width / peaks;
                    const step = peakWidth / 20;
                    for (let i = 0; i < 20; i++) {
                        const y = startY
                            + Math.sin((x / peakWidth) * Math.PI * 2)
                                * amplitude
                                * Math.sin((x / canvas.width) * Math.PI);
                        ctx.lineTo(x, y);
                        x += step;
                    }
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.closePath();
                ctx.fill();
            };

            drawMountainRange('rgba(20, 20, 40, 0.6)', canvas.height * 0.7, canvas.height * 0.4, 3);
            drawMountainRange('rgba(40, 40, 60, 0.8)', canvas.height * 0.8, canvas.height * 0.3, 5);
            drawMountainRange('rgba(60, 60, 80, 1.0)', canvas.height * 0.9, canvas.height * 0.2, 8);

            canvas.style.position = 'absolute';
            canvas.style.left = '0';
            canvas.style.bottom = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            mountainContainer.appendChild(canvas);
            this.registerContainer(mountainContainer);
        }

        // Sunflares - positioned around the sun
        const sunflareContainer = document.getElementById('sunset-sunflares');
        if (sunflareContainer && sunflareContainer.children.length === 0) {
            const flareConfigs = [
                {
                    color: 'rgba(255, 200, 100, 0.6)',
                    size: 150,
                    offsetX: 0,
                    offsetY: 0,
                }, // Center main flare
                {
                    color: 'rgba(255, 150, 80, 0.5)',
                    size: 100,
                    offsetX: 80,
                    offsetY: -40,
                }, // Top right
                {
                    color: 'rgba(255, 220, 150, 0.4)',
                    size: 120,
                    offsetX: -70,
                    offsetY: 50,
                }, // Bottom left
                {
                    color: 'rgba(255, 180, 120, 0.5)',
                    size: 90,
                    offsetX: 60,
                    offsetY: 70,
                }, // Bottom right
                {
                    color: 'rgba(255, 240, 200, 0.3)',
                    size: 180,
                    offsetX: -20,
                    offsetY: -10,
                }, // Slightly off-center large
                {
                    color: 'rgba(255, 160, 100, 0.4)',
                    size: 110,
                    offsetX: -90,
                    offsetY: -60,
                }, // Top left
            ];

            flareConfigs.forEach((flare, i) => {
                const flareEl = document.createElement('div');
                flareEl.className = 'sunset-sunflare';
                flareEl.style.width = `${flare.size}px`;
                flareEl.style.height = `${flare.size}px`;
                flareEl.style.background = `radial-gradient(circle, ${flare.color} 0%, transparent 70%)`;
                flareEl.style.marginLeft = `${flare.offsetX}px`;
                flareEl.style.marginTop = `${flare.offsetY}px`;
                flareEl.style.animationDelay = `-${i * 0.5}s`;
                sunflareContainer.appendChild(flareEl);
            });
            this.registerContainer(sunflareContainer);
        }

        // God Rays
        const godRayContainer = document.querySelector('.sunset-god-rays');
        if (godRayContainer && godRayContainer.children.length === 0) {
            for (let i = 0; i < 30; i++) {
                const ray = document.createElement('div');
                ray.className = 'sunset-god-ray';
                const angle = i * 12 + (Math.random() * 4 - 2);
                const length = this.random(260, 360);
                const width = this.random(2, 4.5);
                const opacity = this.random(0.3, 0.55);

                ray.style.setProperty('--ray-angle', `${angle}deg`);
                ray.style.setProperty('--ray-length', `${length}px`);
                ray.style.setProperty('--ray-width', `${width}px`);
                ray.style.setProperty('--ray-opacity', opacity.toFixed(2));

                godRayContainer.appendChild(ray);
            }
            this.registerContainer(godRayContainer);
        }

        // Enhanced Dust Motes - Particle System
        const dustContainer = document.getElementById('dust-motes');
        if (dustContainer && dustContainer.children.length === 0) {
            // Create multiple types of particles
            const particleTypes = [
                {
                    count: 60,
                    size: [1, 3],
                    speed: [15, 25],
                    color: 'rgba(255, 240, 200, 0.6)',
                }, // Dust motes
                {
                    count: 30,
                    size: [2, 4],
                    speed: [20, 35],
                    color: 'rgba(255, 220, 180, 0.5)',
                }, // Light particles
                {
                    count: 20,
                    size: [1, 2],
                    speed: [10, 18],
                    color: 'rgba(255, 255, 240, 0.7)',
                }, // Sparkles
            ];

            particleTypes.forEach((type) => {
                for (let i = 0; i < type.count; i++) {
                    const particle = document.createElement('div');
                    particle.className = 'sunset-dust-particle';

                    const size = this.random(type.size[0], type.size[1]);
                    particle.style.width = `${size}px`;
                    particle.style.height = `${size}px`;
                    particle.style.background = type.color;
                    particle.style.borderRadius = '50%';
                    particle.style.position = 'absolute';
                    particle.style.boxShadow = `0 0 ${size * 2}px ${type.color}`;

                    // Random starting position
                    particle.style.left = `${Math.random() * 100}%`;
                    particle.style.top = `${Math.random() * 100}%`;

                    // Random animation properties
                    const duration = this.random(type.speed[0], type.speed[1]);
                    particle.style.animation = `sunset-particle-float ${duration}s ease-in-out infinite alternate`;
                    particle.style.animationDelay = `-${Math.random() * duration}s`;

                    // Store end position as CSS variables for animation
                    particle.style.setProperty('--end-x', `${(Math.random() - 0.5) * 30}vw`);
                    particle.style.setProperty('--end-y', `${(Math.random() - 0.5) * 30}vh`);

                    dustContainer.appendChild(particle);
                }
            });

            // Add particle animation to stylesheet if not exists
            if (!document.getElementById('sunset-particle-style')) {
                const style = document.createElement('style');
                style.id = 'sunset-particle-style';
                style.textContent = `
                    @keyframes sunset-particle-float {
                        0% {
                            transform: translate(0, 0) scale(1);
                            opacity: 0;
                        }
                        10% {
                            opacity: 1;
                        }
                        90% {
                            opacity: 1;
                        }
                        100% {
                            transform: translate(var(--end-x), var(--end-y)) scale(0.5);
                            opacity: 0;
                        }
                    }
                `;
                document.head.appendChild(style);
            }
            this.registerContainer(dustContainer);
        }

        // Add birds during day
        if (!dustContainer.querySelector('.sunset-bird')) {
            for (let i = 0; i < 5; i++) {
                const bird = document.createElement('div');
                bird.className = 'sunset-bird';
                bird.style.position = 'absolute';
                bird.style.width = '20px';
                bird.style.height = '8px';
                bird.style.top = `${20 + Math.random() * 40}%`;
                bird.style.left = '-5%';
                bird.innerHTML = '<svg width="20" height="8" viewBox="0 0 20 8"><path d="M 0 4 Q 5 0, 10 4 Q 15 0, 20 4" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1"/></svg>';

                const duration = this.random(25, 40);
                bird.style.animation = `sunset-bird-fly ${duration}s linear infinite`;
                bird.style.animationDelay = `-${Math.random() * duration}s`;

                dustContainer.appendChild(bird);
            }

            // Add bird animation
            if (!document.getElementById('sunset-bird-style')) {
                const style = document.createElement('style');
                style.id = 'sunset-bird-style';
                style.textContent = `
                    @keyframes sunset-bird-fly {
                        0% {
                            transform: translateX(0) translateY(0);
                            opacity: 0;
                        }
                        5% {
                            opacity: 0.4;
                        }
                        95% {
                            opacity: 0.4;
                        }
                        100% {
                            transform: translateX(110vw) translateY(-20vh);
                            opacity: 0;
                        }
                    }
                `;
                document.head.appendChild(style);
            }
        }

        // Sparkling stars for night time
        const starsContainer = document.getElementById('sunset-stars');
        if (starsContainer && starsContainer.children.length === 0) {
            for (let i = 0; i < 200; i++) {
                const star = document.createElement('div');
                star.className = 'sunset-star';

                // Random size (1-3px)
                const size = Math.random() * 2 + 1;
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;

                // Random position
                star.style.left = `${Math.random() * 100}%`;
                star.style.top = `${Math.random() * 60}%`; // Stars mostly in upper part of sky

                // Random animation delay for twinkling effect
                star.style.animationDelay = `${Math.random() * 2}s`;
                star.style.animationDuration = `${2 + Math.random() * 3}s`;

                starsContainer.appendChild(star);
            }
            this.registerContainer(starsContainer);
        }
    }
}
