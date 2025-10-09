import { BaseTheme } from '../base-theme.js';

export default class RainyWindowTheme extends BaseTheme {
    constructor() {
        super('rainy-window');
        this.canvas = null;
        this.ctx = null;
        this.drops = [];
        this.resizeHandler = null;
    }

    async createScene() {
        this.canvas = document.getElementById('rain-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.resizeHandler = () => this.resizeCanvas();
        window.addEventListener('resize', this.resizeHandler, false);
        this.resizeCanvas();

        this.drops = [];
        for(let i=0; i<150; i++){
            this.drops.push(this.createDrop(true));
        }

        this.animate();
    }

    resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    createDrop(isInitial) {
        return {
            x: Math.random() * this.canvas.width,
            y: isInitial ? Math.random() * this.canvas.height : -50,
            r: Math.random() * 1.5 + 1,
            vy: Math.random() * 3 + 2,
            isStreaking: false
        };
    }

    animate() {
        if (!this.isActive) {
            return;
        }

        const streakStyle = 'rgba(220, 230, 255, 0.3)';
        const dropStyle = 'rgba(220, 230, 255, 0.6)';

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if(Math.random() > 0.8) this.drops.push(this.createDrop(false));

        for (let i = this.drops.length - 1; i >= 0; i--) {
            let drop = this.drops[i];
            if (drop.r > 3.5) drop.isStreaking = true;
            drop.y += drop.vy;
            if (drop.isStreaking) {
                this.ctx.beginPath();
                this.ctx.moveTo(drop.x, drop.y - drop.r * 4);
                this.ctx.lineTo(drop.x, drop.y);
                this.ctx.strokeStyle = streakStyle;
                this.ctx.lineWidth = drop.r * 0.6;
                this.ctx.stroke();
            }
            this.ctx.beginPath();
            this.ctx.arc(drop.x, drop.y, drop.r, 0, Math.PI * 2);
            this.ctx.fillStyle = dropStyle;
            this.ctx.fill();

            // Optimized collision detection
            for (let j = i - 1; j >= 0; j--) {
                let other = this.drops[j];
                let dx = drop.x - other.x;
                let dy = drop.y - other.y;
                let distanceSq = dx * dx + dy * dy;
                let combinedRadius = drop.r + other.r;
                let combinedRadiusSq = combinedRadius * combinedRadius;

                if (distanceSq < combinedRadiusSq) {
                    drop.r = Math.min(Math.sqrt(drop.r * drop.r + other.r * other.r), 15);
                    this.drops[j] = this.drops[this.drops.length - 1];
                    this.drops.pop();
                    i--;
                    break;
                }
            }
            if (drop.y > this.canvas.height + 50) {
                this.drops[i] = this.drops[this.drops.length - 1];
                this.drops.pop();
            }
        }
        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    stop() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        super.stop();
    }
}
