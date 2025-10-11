import { BaseTheme } from '../base-theme.js';

export default class OceanTheme extends BaseTheme {
    constructor() {
        super('ocean');
    }

    async createScene() {
        // Caustics
        const causticsContainer = document.querySelector('#ocean-theme .caustics-container');
        if (causticsContainer && causticsContainer.children.length === 0) {
            const light = document.createElement('div');
            light.className = 'caustic-light';
            causticsContainer.appendChild(light);
            this.registerContainer(causticsContainer);
        }

        // God Rays
        const godRayContainer = document.querySelector('.ocean-god-rays');
        if (godRayContainer && godRayContainer.children.length === 0) {
            for (let i = 0; i < 15; i++) {
                const ray = document.createElement('div');
                ray.className = 'ocean-god-ray';
                ray.style.left = `${Math.random() * 120 - 10}%`;
                ray.style.top = '0px';
                ray.style.width = `${Math.random() * 3 + 1}px`;
                ray.style.height = '120%';
                ray.style.transform = `rotate(${Math.random() * 20 - 10}deg)`;
                ray.style.opacity = `${Math.random() * 0.1 + 0.05}`;
                godRayContainer.appendChild(ray);
            }
            this.registerContainer(godRayContainer);
        }

        // Floating Sediment - Adds underwater depth and movement
        const sedimentContainer = document.getElementById('ocean-sediment-layer');
        if (sedimentContainer) {
            sedimentContainer.innerHTML = ''; // Clear old sediment
            for (let i = 0; i < 100; i++) {
                const particle = document.createElement('div');
                particle.className = 'ocean-sediment';
                const size = Math.random() * 3 + 1;
                particle.style.width = `${size}px`;
                particle.style.height = `${size}px`;
                const startX = Math.random() * 100;
                const startY = Math.random() * 100;
                particle.style.setProperty('--x-start', `${startX}vw`);
                particle.style.setProperty('--y-start', `${startY}vh`);
                particle.style.setProperty('--x-end', `${startX + (Math.random() * 40 - 20)}vw`);
                particle.style.setProperty('--y-end', `${startY + (Math.random() * 40 - 20)}vh`);
                particle.style.animationDelay = `-${Math.random() * 30}s`;
                particle.style.animationDuration = `${Math.random() * 40 + 30}s`;
                sedimentContainer.appendChild(particle);
            }
            this.registerContainer(sedimentContainer);
        }

        // Bubbles - More bubbles for underwater feel
        const bubblesContainer = document.getElementById('bubbles');
        if (bubblesContainer) {
            bubblesContainer.innerHTML = ''; // Clear old bubbles
            for (let i = 0; i < 150; i++) {
                const el = document.createElement('div');
                el.className = 'bubble';
                const size = Math.random() * 12 + 3;
                el.style.width = `${size}px`;
                el.style.height = `${size}px`;
                el.style.left = `${Math.random() * 100}%`;
                el.style.animationDuration = `${Math.random() * 15 + 8}s`;
                el.style.animationDelay = `-${Math.random() * 20}s`;
                el.style.setProperty('--x-drift', `${Math.random() * 6 - 3}vw`);
                el.style.setProperty('--x-drift-end', `${Math.random() * 6 - 3}vw`);
                bubblesContainer.appendChild(el);
            }
            this.registerContainer(bubblesContainer);
        }

        // Plankton - More particles for immersive underwater feel
        const planktonContainer = document.getElementById('ocean-plankton-layer');
        if (planktonContainer) {
            planktonContainer.innerHTML = ''; // Clear old plankton
            for (let i = 0; i < 200; i++) {
                const particle = document.createElement('div');
                particle.className = 'ocean-plankton';
                const size = Math.random() * 2 + 0.5;
                particle.style.width = `${size}px`;
                particle.style.height = `${size}px`;
                particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                particle.style.setProperty('--y-start', `${Math.random() * 100}vh`);
                particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                particle.style.setProperty('--y-end', `${Math.random() * 100}vh`);
                particle.style.animationDelay = `-${Math.random() * 15}s`;
                particle.style.animationDuration = `${Math.random() * 20 + 15}s`;
                planktonContainer.appendChild(particle);
            }
            this.registerContainer(planktonContainer);
        }

        // Jellyfish - More jellyfish for life
        const jellyfishContainer = document.getElementById('jellyfish-layer');
        if (jellyfishContainer) {
            jellyfishContainer.innerHTML = ''; // Clear old jellyfish
            for (let i = 0; i < 12; i++) {
                const fish = document.createElement('div');
                fish.className = 'jellyfish';
                const body = document.createElement('div');
                body.className = 'jelly-body';
                const tentacles = document.createElement('div');
                tentacles.className = 'jelly-tentacles';

                for (let j = 0; j < 5; j++) {
                    const tentacle = document.createElement('div');
                    tentacle.className = 'tentacle';
                    tentacle.style.height = `${Math.random() * 40 + 30}px`;
                    tentacle.style.left = `${Math.random() * 40 - 20}px`;
                    tentacle.style.animationDelay = `-${Math.random() * 4}s`;
                    tentacles.appendChild(tentacle);
                }

                fish.appendChild(body);
                fish.appendChild(tentacles);

                fish.style.setProperty('--x-start', `${-10 + Math.random() * 120}vw`);
                fish.style.setProperty('--y-start', `${110}vh`);
                fish.style.setProperty('--x-end', `${-10 + Math.random() * 120}vw`);
                fish.style.setProperty('--y-end', `${-20}vh`);
                fish.style.animationDuration = `${Math.random() * 20 + 15}s`;
                fish.style.animationDelay = `-${Math.random() * 35}s`;
                body.style.animationDelay = `-${Math.random() * 4}s`;

                jellyfishContainer.appendChild(fish);
            }
            this.registerContainer(jellyfishContainer);
        }

        // Ocean floor layers
        const layers = [
            {
                el: document.getElementById('ocean-floor-bg'),
                count: 80,
                color: 'rgba(5, 30, 50, 0.6)',
                height: 120,
            },
            {
                el: document.getElementById('ocean-floor-mid'),
                count: 50,
                color: 'rgba(10, 40, 65, 0.8)',
                height: 180,
            },
            {
                el: document.getElementById('ocean-floor-fg'),
                count: 30,
                color: 'rgba(15, 50, 80, 1.0)',
                height: 250,
            },
        ];

        layers.forEach(layer => {
            if (layer.el && layer.el.children.length === 0) {
                const C_WIDTH = 250;
                const canvas = document.createElement('canvas');
                canvas.width = layer.count * C_WIDTH;
                canvas.height = layer.height;
                const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });

                // Clear canvas to transparent
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // Draw ground at bottom only
                ctx.fillStyle = layer.color;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);
                let y = canvas.height * 0.85; // Start higher to leave more transparent space
                ctx.lineTo(0, y);
                for (let i = 0; i < canvas.width; i++) {
                    y += (Math.random() - 0.5) * 0.5;
                    y = Math.max(canvas.height * 0.6, Math.min(canvas.height * 0.9, y));
                    ctx.lineTo(i, y);
                }
                ctx.lineTo(canvas.width, y);
                ctx.lineTo(canvas.width, canvas.height);
                ctx.closePath();
                ctx.fill();

                // Draw flora
                for (let i = 0; i < layer.count * 1.5; i++) {
                    const x = Math.random() * canvas.width;
                    let groundY = 0;
                    // Find ground Y at this x (approximate)
                    for (let j = 0; j < canvas.height; j++) {
                        if (ctx.getImageData(x, j, 1, 1).data[3] > 0) {
                            groundY = j;
                            break;
                        }
                    }
                    if (groundY === 0) continue;

                    if (Math.random() > 0.3) {
                        // Seaweed
                        ctx.strokeStyle = `rgba(${parseInt(layer.color.slice(5, -1).split(',')[0]) + 10}, ${parseInt(layer.color.slice(5, -1).split(',')[1]) + 10}, ${parseInt(layer.color.slice(5, -1).split(',')[2]) + 10}, ${parseFloat(layer.color.slice(5, -1).split(',')[3]) * 1.2})`;
                        const h = (Math.random() * 0.8 + 0.2) * layer.height;
                        ctx.beginPath();
                        ctx.moveTo(x, groundY);
                        ctx.bezierCurveTo(
                            x + (Math.random() - 0.5) * 50,
                            groundY - h * 0.3,
                            x + (Math.random() - 0.5) * 50,
                            groundY - h * 0.7,
                            x + (Math.random() - 0.5) * 30,
                            groundY - h
                        );
                        ctx.lineWidth = Math.random() * 3 + 1;
                        ctx.stroke();
                    } else {
                        // Coral Fan
                        ctx.fillStyle = `rgba(${parseInt(layer.color.slice(5, -1).split(',')[0]) - 5}, ${parseInt(layer.color.slice(5, -1).split(',')[1]) + 5}, ${parseInt(layer.color.slice(5, -1).split(',')[2]) + 5}, ${parseFloat(layer.color.slice(5, -1).split(',')[3])})`;
                        const h = (Math.random() * 0.2 + 0.1) * layer.height;
                        const w = ((Math.random() * 0.4 + 0.2) * C_WIDTH) / 4;
                        ctx.beginPath();
                        ctx.moveTo(x, groundY);
                        for (let j = 0; j < 5; j++) {
                            ctx.lineTo(x + (Math.random() - 0.5) * w, groundY - Math.random() * h);
                        }
                        ctx.closePath();
                        ctx.fill();
                    }
                }
                canvas.style.position = 'absolute';
                canvas.style.left = '0';
                canvas.style.bottom = '0';
                canvas.style.width = `${canvas.width}px`;
                canvas.style.height = `${canvas.height}px`;
                canvas.style.pointerEvents = 'none';
                canvas.style.backgroundColor = 'transparent';
                layer.el.appendChild(canvas);
                this.registerContainer(layer.el);
            }
        });
    }
}
