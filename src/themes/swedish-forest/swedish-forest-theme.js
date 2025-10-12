import { BaseTheme } from '../base-theme.js';

export default class SwedishForestTheme extends BaseTheme {
    constructor() {
        super('swedish-forest');
    }

    async createScene() {
        // Pine tree generation for parallax layers
        const layers = [
            {
                el: document.getElementById('sf-layer-1'),
                count: 80,
                height: 150,
                color: 'rgba(20, 40, 50, 0.7)',
            },
            {
                el: document.getElementById('sf-layer-2'),
                count: 60,
                height: 250,
                color: 'rgba(30, 55, 70, 0.8)',
            },
            {
                el: document.getElementById('sf-layer-3'),
                count: 40,
                height: 400,
                color: 'rgba(40, 70, 90, 0.9)',
            },
        ];

        layers.forEach((layer) => {
            if (layer.el && layer.el.children.length === 0) {
                const T_WIDTH = 100;
                const canvas = document.createElement('canvas');
                canvas.width = layer.count * T_WIDTH;
                canvas.height = layer.height;
                const ctx = canvas.getContext('2d');

                for (let i = 0; i < layer.count; i++) {
                    const h = layer.height * (0.6 + Math.random() * 0.4);
                    const tH = h * (0.1 + Math.random() * 0.05);
                    const x = i * T_WIDTH + (Math.random() - 0.5) * 20;

                    // Draw trunk
                    ctx.fillStyle = layer.color;
                    ctx.fillRect(x + T_WIDTH / 2 - 5, canvas.height - tH, 10, tH);

                    // Draw foliage
                    const y = canvas.height - tH;
                    const w = T_WIDTH * 0.9;
                    const numLayers = 5 + Math.floor(Math.random() * 3);
                    const layerHeight = y / numLayers;

                    for (let j = 0; j < numLayers; j++) {
                        const cY = y - j * layerHeight;
                        const cW = w * ((numLayers - j) / numLayers) * (1 + (Math.random() - 0.5) * 0.2);
                        const sway = (Math.random() - 0.5) * 10;

                        ctx.beginPath();
                        ctx.moveTo(x + T_WIDTH / 2 + sway, cY - layerHeight);
                        ctx.lineTo(x + T_WIDTH / 2 - cW / 2, cY);
                        ctx.lineTo(x + T_WIDTH / 2 + cW / 2, cY);
                        ctx.closePath();
                        ctx.fill();
                    }
                }
                canvas.style.position = 'absolute';
                canvas.style.left = '0';
                canvas.style.bottom = '0';
                canvas.style.width = `${canvas.width}px`;
                canvas.style.height = `${canvas.height}px`;
                layer.el.appendChild(canvas);
                this.registerContainer(layer.el);
            }
        });

        // God ray generation
        const godRayContainer = document.querySelector('.god-ray-container');
        if (godRayContainer && godRayContainer.children.length === 0) {
            for (let i = 0; i < 15; i++) {
                const ray = document.createElement('div');
                ray.className = 'god-ray';
                ray.style.left = `${Math.random() * 120 - 10}%`;
                ray.style.top = '0px';
                ray.style.width = `${Math.random() * 4 + 2}px`;
                ray.style.height = '120%';
                ray.style.transform = `rotate(${Math.random() * 20 - 10}deg)`;
                ray.style.opacity = `${Math.random() * 0.1 + 0.05}`;
                godRayContainer.appendChild(ray);
            }
            this.registerContainer(godRayContainer);
        }
    }
}
