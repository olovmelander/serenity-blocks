import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { MOUNTAIN_TETROMINOS } from './mountain-tetrominos.js';

// Quality presets for performance scaling
const QUALITY_PRESETS = {
    Ultra: {
        maxParticles: 50,
        effectCooldown: 100,
        enableLightning: true,
        enableTremor: true,
    },
    High: {
        maxParticles: 30,
        effectCooldown: 200,
        enableLightning: true,
        enableTremor: true,
    },
    Medium: {
        maxParticles: 15,
        effectCooldown: 300,
        enableLightning: false,
        enableTremor: true,
    },
    Low: {
        maxParticles: 5,
        effectCooldown: 500,
        enableLightning: false,
        enableTremor: false,
    },
};

export default class MountainTheme extends BaseTheme {
    constructor() {
        super('mountain');
        this.eventUnsubscribers = [];
        this.lastComboEffectTime = 0;
        this.activeParticles = [];
        this.qualityPreset = QUALITY_PRESETS.High;
    }

    getTetrominoConfig() {
        return MOUNTAIN_TETROMINOS;
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

        // Setup combo effects event listeners
        this.setupEventListeners();

        // Setup quality preset based on settings
        this.updateQualityPreset();
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data.piece);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    updateQualityPreset() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        const quality = settings?.visualQuality || 'High';
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
    }

    canRunComboEffects() {
        const now = Date.now();
        if (now - this.lastComboEffectTime < this.qualityPreset.effectCooldown) {
            return false;
        }
        this.lastComboEffectTime = now;
        return true;
    }

    // Line Clear Effect Handler
    onLineClear(lineCount) {
        // Mountain peak glow effect
        this.mountainPeakGlow(lineCount);

        // Cloud disturbance
        this.cloudDisturbance(lineCount);

        // Star twinkle (if night time)
        this.starTwinkle(lineCount);
    }

    // Combo Effect Handler
    onCombo(comboCount) {
        if (!this.canRunComboEffects()) return;

        if (comboCount >= 2 && comboCount <= 3) {
            // Tier 1: Gentle effects
            this.mountainTremor(0.3);
            this.mountainPeakGlow(2);
            this.skyIntensify(0.1);
        } else if (comboCount >= 4 && comboCount <= 6) {
            // Tier 2: Alpine phenomena
            this.mountainTremor(0.6);
            this.mountainPeakGlow(3);
            this.skyIntensify(0.2);
            this.createAvalanche(10);
            this.cloudBrighten();
            this.starBurst();
        } else if (comboCount >= 7) {
            // Tier 3: Dramatic mountain response
            this.mountainTremor(1.0);
            this.mountainPeakGlow(4);
            this.skyIntensify(0.3);
            this.createAvalanche(Math.min(comboCount * 3, this.qualityPreset.maxParticles));
            this.cloudBrighten();
            this.starBurst();
            if (this.qualityPreset.enableLightning) {
                this.lightningFlash();
            }
        }
    }

    // Piece Lock Effect Handler
    onPieceLock() {
        // 30% chance for subtle effect
        if (Math.random() < 0.3) {
            const effect = Math.random();
            if (effect < 0.33) {
                this.dustPuff();
            } else if (effect < 0.66) {
                this.starTwinkle(1);
            } else {
                this.cloudWisp();
            }
        }
    }

    // Effect: Mountain Peak Glow
    mountainPeakGlow(intensity) {
        const ranges = ['mountain-range-back', 'mountain-range-mid', 'mountain-range-front'];
        const brightness = 1 + (intensity * 0.15);

        ranges.forEach((id, index) => {
            const range = document.getElementById(id);
            if (range) {
                range.style.transition = 'filter 0.3s ease-out';
                range.style.filter = `brightness(${brightness})`;

                setTimeout(() => {
                    range.style.filter = 'brightness(1)';
                }, 300 + (index * 100));
            }
        });
    }

    // Effect: Cloud Disturbance
    cloudDisturbance(intensity) {
        const cloudContainer = document.querySelector('.mountain-clouds');
        if (cloudContainer && cloudContainer.firstChild) {
            const canvas = cloudContainer.firstChild;
            const originalDuration = 200;
            const newDuration = originalDuration * (1 - intensity * 0.1);

            canvas.style.animation = `slide-mountain ${newDuration}s linear infinite`;

            setTimeout(() => {
                canvas.style.animation = '';
            }, 1000);
        }
    }

    // Effect: Star Twinkle
    starTwinkle(count) {
        const starsContainer = document.getElementById('mountain-stars');
        if (!starsContainer) return;

        const stars = Array.from(starsContainer.children);
        const numToTwinkle = Math.min(count * 3, stars.length);

        for (let i = 0; i < numToTwinkle; i++) {
            const star = stars[Math.floor(Math.random() * stars.length)];
            if (star) {
                star.style.transition = 'opacity 0.2s ease-out';
                star.style.opacity = '1';

                setTimeout(() => {
                    star.style.opacity = '';
                }, 200 + Math.random() * 300);
            }
        }
    }

    // Effect: Mountain Tremor
    mountainTremor(intensity) {
        if (!this.qualityPreset.enableTremor) return;

        const theme = document.getElementById('mountain-theme');
        if (!theme) return;

        const shakeAmount = intensity * 3;
        const duration = 300;

        theme.style.transition = `transform ${duration}ms ease-out`;
        theme.style.transform = `translate(${shakeAmount}px, ${shakeAmount * 0.5}px)`;

        setTimeout(() => {
            theme.style.transform = `translate(-${shakeAmount * 0.5}px, 0)`;
        }, duration / 3);

        setTimeout(() => {
            theme.style.transform = 'translate(0, 0)';
        }, duration);
    }

    // Effect: Sky Intensify
    skyIntensify(intensity) {
        const sky = document.querySelector('.mountain-sky');
        if (!sky) return;

        const brightness = 1 + intensity;
        const saturate = 1 + (intensity * 0.5);

        sky.style.transition = 'filter 0.4s ease-out';
        sky.style.filter = `brightness(${brightness}) saturate(${saturate})`;

        setTimeout(() => {
            sky.style.filter = '';
        }, 400);
    }

    // Effect: Create Avalanche Particles
    createAvalanche(particleCount) {
        const theme = document.getElementById('mountain-theme');
        if (!theme) return;

        const count = Math.min(particleCount, this.qualityPreset.maxParticles);

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                this.createAvalancheParticle();
            }, i * 50);
        }
    }

    createAvalancheParticle() {
        const theme = document.getElementById('mountain-theme');
        if (!theme) return;

        const particle = document.createElement('div');
        particle.className = 'mountain-avalanche-particle';

        const startX = Math.random() * 100;
        const startY = 40 + Math.random() * 30;
        const size = 2 + Math.random() * 4;
        const duration = 1000 + Math.random() * 1000;

        particle.style.cssText = `
            position: absolute;
            left: ${startX}%;
            top: ${startY}%;
            width: ${size}px;
            height: ${size}px;
            background: rgba(255, 255, 255, 0.8);
            border-radius: 50%;
            pointer-events: none;
            z-index: 5;
            box-shadow: 0 0 ${size}px rgba(255, 255, 255, 0.5);
        `;

        theme.appendChild(particle);
        this.activeParticles.push(particle);

        // Animate particle falling
        const fallDistance = (100 - startY) + 20;
        const drift = (Math.random() - 0.5) * 30;

        particle.animate([
            { transform: 'translate(0, 0)', opacity: 1 },
            { transform: `translate(${drift}px, ${fallDistance}vh)`, opacity: 0 },
        ], {
            duration,
            easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }).onfinish = () => {
            particle.remove();
            const index = this.activeParticles.indexOf(particle);
            if (index > -1) this.activeParticles.splice(index, 1);
        };
    }

    // Effect: Cloud Brighten
    cloudBrighten() {
        const cloudContainer = document.querySelector('.mountain-clouds');
        if (!cloudContainer) return;

        cloudContainer.style.transition = 'filter 0.3s ease-out';
        cloudContainer.style.filter = 'brightness(1.5)';

        setTimeout(() => {
            cloudContainer.style.filter = '';
        }, 300);
    }

    // Effect: Star Burst
    starBurst() {
        const starsContainer = document.getElementById('mountain-stars');
        if (!starsContainer) return;

        starsContainer.style.transition = 'filter 0.3s ease-out';
        starsContainer.style.filter = 'brightness(2) drop-shadow(0 0 2px white)';

        setTimeout(() => {
            starsContainer.style.filter = '';
        }, 300);
    }

    // Effect: Lightning Flash
    lightningFlash() {
        const theme = document.getElementById('mountain-theme');
        if (!theme) return;

        const flash = document.createElement('div');
        flash.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(to bottom, rgba(200, 220, 255, 0.8), transparent);
            pointer-events: none;
            z-index: 10;
        `;

        theme.appendChild(flash);

        flash.animate([
            { opacity: 0 },
            { opacity: 1 },
            { opacity: 0 },
            { opacity: 0.6 },
            { opacity: 0 },
        ], {
            duration: 400,
            easing: 'ease-in-out',
        }).onfinish = () => {
            flash.remove();
        };
    }

    // Effect: Dust Puff (subtle)
    dustPuff() {
        const theme = document.getElementById('mountain-theme');
        if (!theme) return;

        const puff = document.createElement('div');
        const x = Math.random() * 100;
        const y = 60 + Math.random() * 20;

        puff.style.cssText = `
            position: absolute;
            left: ${x}%;
            top: ${y}%;
            width: 8px;
            height: 8px;
            background: rgba(200, 200, 200, 0.4);
            border-radius: 50%;
            pointer-events: none;
            z-index: 5;
        `;

        theme.appendChild(puff);

        puff.animate([
            { transform: 'scale(1)', opacity: 0.4 },
            { transform: 'scale(3)', opacity: 0 },
        ], {
            duration: 600,
            easing: 'ease-out',
        }).onfinish = () => {
            puff.remove();
        };
    }

    // Effect: Cloud Wisp (subtle)
    cloudWisp() {
        const cloudContainer = document.querySelector('.mountain-clouds');
        if (!cloudContainer) return;

        cloudContainer.style.transition = 'opacity 0.2s ease-out';
        const originalOpacity = cloudContainer.style.opacity || '1';
        cloudContainer.style.opacity = '0.7';

        setTimeout(() => {
            cloudContainer.style.opacity = originalOpacity;
        }, 200);
    }

    stop() {
        // Clean up event listeners
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Clean up active particles
        this.activeParticles.forEach((particle) => particle.remove());
        this.activeParticles = [];

        // Reset filters
        const sky = document.querySelector('.mountain-sky');
        if (sky) sky.style.filter = '';

        const ranges = ['mountain-range-back', 'mountain-range-mid', 'mountain-range-front'];
        ranges.forEach((id) => {
            const range = document.getElementById(id);
            if (range) range.style.filter = '';
        });

        const cloudContainer = document.querySelector('.mountain-clouds');
        if (cloudContainer) cloudContainer.style.filter = '';

        const starsContainer = document.getElementById('mountain-stars');
        if (starsContainer) starsContainer.style.filter = '';

        const theme = document.getElementById('mountain-theme');
        if (theme) theme.style.transform = '';

        super.stop();
    }
}
