import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { OCEAN_TETROMINOS } from './ocean-tetrominos.js';

export default class OceanTheme extends BaseTheme {
    constructor() {
        super('ocean');
        this.eventUnsubscribers = [];
        this.currentComboLevel = 0;
        this.godRays = [];
        this.kelpStrands = [];
        this.lastEffectTime = 0;
        this.comboCooldownMs = 220;
        this.lastFrameTime = 0;
        this.frameTimeAccumulator = 0;
        this.frameTimeCount = 0;
        this.averageFrameTime = 16.67;
        this.adaptiveScale = 1;
        this.effectCanvas = null;
        this.effectCtx = null;
        this.effectRafId = null;
        this.effectLastFrame = 0;
        this.shockwaveEffects = [];
        this.biolumParticles = [];
        this.bubbleBurstParticles = [];
        this.depthFog = [];
        this.marineCreatures = [];
        this.presets = {
            Minimal: { biolumLimit: 8, fishCount: 2, kelpCount: 15, sedimentCount: 60, bubbleCount: 100, planktonCount: 120, jellyCount: 5 },
            Low: { biolumLimit: 15, fishCount: 4, kelpCount: 25, sedimentCount: 100, bubbleCount: 150, planktonCount: 180, jellyCount: 8 },
            Medium: { biolumLimit: 30, fishCount: 8, kelpCount: 40, sedimentCount: 150, bubbleCount: 250, planktonCount: 280, jellyCount: 12 },
            High: { biolumLimit: 50, fishCount: 12, kelpCount: 60, sedimentCount: 220, bubbleCount: 400, planktonCount: 400, jellyCount: 18 },
            Ultra: { biolumLimit: 80, fishCount: 18, kelpCount: 80, sedimentCount: 320, bubbleCount: 600, planktonCount: 600, jellyCount: 24 },
            Extreme: { biolumLimit: 120, fishCount: 25, kelpCount: 100, sedimentCount: 450, bubbleCount: 900, planktonCount: 900, jellyCount: 32 },
        };
        this.currentPreset = this.presets.High;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyGraphicsPreset(quality) {
        this.currentPreset = this.presets[quality] || this.presets.High;
        this.comboCooldownMs = 200;
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;
        this.teardownQualityListener();
        this.qualityListener = (event) => {
            const next = event.detail?.effectQuality;
            if (next) this.applyGraphicsPreset(next);
        };
        window.addEventListener('settingsChanged', this.qualityListener);
    }

    teardownQualityListener() {
        if (this.qualityListener && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityListener);
            this.qualityListener = null;
        }
    }

    calculateAdaptiveScale() {
        const ft = this.averageFrameTime;
        if (ft <= 18) return 1;
        if (ft <= 22) return 0.85;
        if (ft <= 28) return 0.65;
        return 0.4;
    }

    startPerformanceMonitor() {
        if (this.perfMonitorId) return;
        const step = (ts) => {
            if (!this.isActive) { this.perfMonitorId = null; return; }
            if (this.lastFrameTime === 0) this.lastFrameTime = ts;
            const dt = ts - this.lastFrameTime;
            this.lastFrameTime = ts;
            this.frameTimeAccumulator += dt;
            this.frameTimeCount += 1;
            if (this.frameTimeCount >= 30) {
                this.averageFrameTime = this.frameTimeAccumulator / this.frameTimeCount;
                this.frameTimeAccumulator = 0;
                this.frameTimeCount = 0;
            }
            this.adaptiveScale = this.calculateAdaptiveScale();
            this.perfMonitorId = requestAnimationFrame(step);
        };
        this.perfMonitorId = requestAnimationFrame(step);
    }

    setupEffectCanvas() {
        const theme = document.getElementById('ocean-theme');
        if (!theme) return;
        this.effectCanvas = theme.querySelector('.ocean-effects-canvas');
        if (!this.effectCanvas) {
            this.effectCanvas = document.createElement('canvas');
            this.effectCanvas.className = 'ocean-effects-canvas';
            Object.assign(this.effectCanvas.style, {
                position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                pointerEvents: 'none', zIndex: '120',
            });
            theme.appendChild(this.effectCanvas);
        }
        this.resizeEffectCanvas();
        this.effectCtx = this.effectCanvas.getContext('2d', { alpha: true });
        window.addEventListener('resize', () => this.resizeEffectCanvas());
    }

    resizeEffectCanvas() {
        if (!this.effectCanvas) return;
        const theme = document.getElementById('ocean-theme');
        const rect = theme ? theme.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
        this.effectCanvas.width = rect.width;
        this.effectCanvas.height = rect.height;
    }

    startEffectLoop() {
        if (!this.effectCanvas) return;
        const loop = (ts) => {
            if (!this.isActive || !this.effectCanvas || !this.effectCtx) {
                this.effectRafId = null;
                return;
            }
            if (!this.effectLastFrame) this.effectLastFrame = ts;
            const dt = (ts - this.effectLastFrame) / 1000;
            this.effectLastFrame = ts;

            this.effectCtx.clearRect(0, 0, this.effectCanvas.width, this.effectCanvas.height);
            this.updateShockwaveEffects(dt);
            this.updateBiolumParticles(dt);
            this.updateBubbleParticles(dt);
            this.updateMarineCreatures(dt);

            this.effectRafId = requestAnimationFrame(loop);
        };
        this.effectRafId = requestAnimationFrame(loop);
    }

    updateShockwaveEffects(dt) {
        for (let i = this.shockwaveEffects.length - 1; i >= 0; i--) {
            const sw = this.shockwaveEffects[i];
            sw.life -= dt / sw.duration;
            if (sw.life <= 0) {
                this.shockwaveEffects.splice(i, 1);
                continue;
            }
            const progress = 1 - sw.life;
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const radius = sw.startRadius + (sw.maxRadius - sw.startRadius) * easeOut;
            const alpha = sw.life * 0.6;

            const ctx = this.effectCtx;
            ctx.save();
            ctx.globalAlpha = alpha;
            const gradient = ctx.createRadialGradient(sw.x, sw.y, radius * 0.5, sw.x, sw.y, radius);
            gradient.addColorStop(0, 'rgba(100, 220, 255, 0.6)');
            gradient.addColorStop(0.5, 'rgba(150, 240, 255, 0.4)');
            gradient.addColorStop(1, 'rgba(200, 250, 255, 0)');
            ctx.strokeStyle = gradient;
            ctx.lineWidth = Math.max(2, sw.width * (1 - easeOut));
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    updateBiolumParticles(dt) {
        for (let i = this.biolumParticles.length - 1; i >= 0; i--) {
            const p = this.biolumParticles[i];
            p.life -= dt / p.duration;
            if (p.life <= 0) {
                this.biolumParticles.splice(i, 1);
                continue;
            }
            p.x += p.vx * dt * 30;
            p.y += p.vy * dt * 30;
            const pulse = 0.5 + Math.sin(p.life * 12) * 0.5;
            const alpha = p.life * pulse * 0.9;
            const size = p.size * (0.8 + pulse * 0.4);

            const ctx = this.effectCtx;
            ctx.save();
            ctx.globalAlpha = alpha;
            const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 2);
            grad.addColorStop(0, p.color.replace('0.8)', '0.95)'));
            grad.addColorStop(0.4, p.color);
            grad.addColorStop(1, p.color.replace('0.8)', '0)'));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size * 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    updateBubbleParticles(dt) {
        for (let i = this.bubbleBurstParticles.length - 1; i >= 0; i--) {
            const b = this.bubbleBurstParticles[i];
            b.life -= dt / b.duration;
            if (b.life <= 0) {
                this.bubbleBurstParticles.splice(i, 1);
                continue;
            }
            b.driftTime = (b.driftTime || 0) + dt;
            const drift = Math.sin(b.driftTime * 4) * 1.2;
            b.y -= b.speed * dt * 70;
            b.x += drift;
            const alpha = b.life * 0.75;

            const ctx = this.effectCtx;
            ctx.save();
            ctx.globalAlpha = alpha;
            const grad = ctx.createRadialGradient(b.x - b.size * 0.35, b.y - b.size * 0.35, 0, b.x, b.y, b.size);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
            grad.addColorStop(0.3, 'rgba(220, 245, 255, 0.7)');
            grad.addColorStop(0.7, 'rgba(180, 230, 255, 0.3)');
            grad.addColorStop(1, 'rgba(150, 210, 255, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.beginPath();
            ctx.arc(b.x - b.size * 0.4, b.y - b.size * 0.4, b.size * 0.25, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    updateMarineCreatures(dt) {
        for (let i = this.marineCreatures.length - 1; i >= 0; i--) {
            const c = this.marineCreatures[i];
            c.life -= dt / c.duration;
            if (c.life <= 0) {
                this.marineCreatures.splice(i, 1);
                continue;
            }
            c.x += c.vx * dt * 50;
            c.y += Math.sin(c.life * 5) * 0.5;
            const alpha = Math.min(c.life * 2, 1) * 0.7;

            const ctx = this.effectCtx;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = c.color;
            ctx.shadowBlur = 20;
            ctx.shadowColor = c.color;
            ctx.beginPath();
            ctx.ellipse(c.x, c.y, c.size, c.size * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    async createScene() {
        this.applyGraphicsPreset(this.getGraphicsQuality());
        this.startPerformanceMonitor();

        const theme = document.getElementById('ocean-theme');
        if (!theme) return;

        // Deep vignette for mystery
        if (!theme.querySelector('.ocean-deep-vignette')) {
            const vignette = document.createElement('div');
            vignette.className = 'ocean-deep-vignette';
            Object.assign(vignette.style, {
                position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                background: 'radial-gradient(ellipse at center 30%, transparent 10%, rgba(0, 8, 20, 0.5) 50%, rgba(0, 5, 15, 0.95) 100%)',
                pointerEvents: 'none', zIndex: '15',
            });
            theme.appendChild(vignette);
        }

        // Volumetric god rays
        const godRayContainer = document.querySelector('.ocean-god-rays');
        if (godRayContainer && godRayContainer.children.length === 0) {
            this.godRays = [];
            for (let i = 0; i < 20; i++) {
                const ray = document.createElement('div');
                ray.className = 'ocean-god-ray';
                Object.assign(ray.style, {
                    position: 'absolute',
                    left: `${Math.random() * 120 - 10}%`,
                    top: '-10%',
                    width: `${Math.random() * 4 + 2}px`,
                    height: '130%',
                    background: `linear-gradient(180deg, rgba(120, 200, 255, ${Math.random() * 0.15 + 0.05}) 0%, rgba(80, 180, 240, ${Math.random() * 0.08}) 50%, transparent 100%)`,
                    transform: `rotate(${Math.random() * 25 - 12.5}deg) skewY(${Math.random() * 4 - 2}deg)`,
                    transformOrigin: 'top center',
                    opacity: Math.random() * 0.3 + 0.2,
                    animation: `godRayDrift ${15 + Math.random() * 10}s ease-in-out infinite`,
                    animationDelay: `-${Math.random() * 15}s`,
                    pointerEvents: 'none',
                    mixBlendMode: 'screen',
                });
                godRayContainer.appendChild(ray);
                this.godRays.push(ray);
            }
            this.registerContainer(godRayContainer);
        }

        // Enhanced caustics
        const causticsContainer = document.querySelector('#ocean-theme .caustics-container');
        if (causticsContainer && causticsContainer.children.length === 0) {
            const light = document.createElement('div');
            light.className = 'caustic-light';
            Object.assign(light.style, {
                position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                opacity: '0.25',
                mixBlendMode: 'screen',
                filter: 'blur(2px)',
            });
            causticsContainer.appendChild(light);
            this.registerContainer(causticsContainer);
        }

        // Kelp forest
        const kelpContainer = document.getElementById('ocean-floor-mid');
        if (kelpContainer) {
            const kelpCount = this.currentPreset.kelpCount || 40;
            for (let i = 0; i < kelpCount; i++) {
                const kelp = document.createElement('div');
                kelp.className = 'ocean-kelp';
                const height = 35 + Math.random() * 45;
                const xPos = Math.random() * 100;
                Object.assign(kelp.style, {
                    position: 'absolute',
                    bottom: '0',
                    left: `${xPos}%`,
                    width: `${2 + Math.random() * 3}px`,
                    height: `${height}%`,
                    background: `linear-gradient(180deg, transparent 0%, rgba(20, 80, 60, 0.6) 20%, rgba(30, 100, 70, 0.8) 100%)`,
                    transformOrigin: 'bottom center',
                    animation: `kelpSway ${4 + Math.random() * 3}s ease-in-out infinite`,
                    animationDelay: `-${Math.random() * 7}s`,
                    filter: 'blur(0.5px)',
                });
                kelpContainer.appendChild(kelp);
                this.kelpStrands.push(kelp);
            }
        }

        // Floating sediment
        const sedimentContainer = document.getElementById('ocean-sediment-layer');
        if (sedimentContainer) {
            sedimentContainer.innerHTML = '';
            const sedimentCount = this.currentPreset.sedimentCount || 200;
            for (let i = 0; i < sedimentCount; i++) {
                const particle = document.createElement('div');
                particle.className = 'ocean-sediment';
                const size = Math.random() * 2.5 + 0.5;
                Object.assign(particle.style, {
                    position: 'absolute',
                    width: `${size}px`,
                    height: `${size}px`,
                    background: `rgba(180, 200, 220, ${Math.random() * 0.4 + 0.2})`,
                    borderRadius: '50%',
                    boxShadow: `0 0 ${size * 2}px rgba(200, 220, 240, 0.3)`,
                    '--x-start': `${Math.random() * 100}vw`,
                    '--y-start': `${Math.random() * 100}vh`,
                    '--x-end': `${Math.random() * 100}vw`,
                    '--y-end': `${Math.random() * 100}vh`,
                    animation: `particleDrift ${30 + Math.random() * 25}s linear infinite`,
                    animationDelay: `-${Math.random() * 40}s`,
                });
                sedimentContainer.appendChild(particle);
            }
            this.registerContainer(sedimentContainer);
        }

        // Bubbles
        const bubblesContainer = document.getElementById('bubbles');
        if (bubblesContainer) {
            bubblesContainer.innerHTML = '';
            const bubbleCount = this.currentPreset.bubbleCount || 350;
            for (let i = 0; i < bubbleCount; i++) {
                const el = document.createElement('div');
                el.className = 'bubble';
                const size = Math.random() * 10 + 2;
                Object.assign(el.style, {
                    position: 'absolute',
                    bottom: '-20px',
                    left: `${Math.random() * 100}%`,
                    width: `${size}px`,
                    height: `${size}px`,
                    background: `radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.8), rgba(200, 235, 255, 0.3))`,
                    borderRadius: '50%',
                    opacity: Math.random() * 0.7 + 0.3,
                    animation: `bubbleRise ${10 + Math.random() * 12}s linear infinite`,
                    animationDelay: `-${Math.random() * 20}s`,
                    '--x-drift': `${Math.random() * 8 - 4}vw`,
                });
                bubblesContainer.appendChild(el);
            }
            this.registerContainer(bubblesContainer);
        }

        // Plankton
        const planktonContainer = document.getElementById('ocean-plankton-layer');
        if (planktonContainer) {
            planktonContainer.innerHTML = '';
            const planktonCount = this.currentPreset.planktonCount || 350;
            for (let i = 0; i < planktonCount; i++) {
                const particle = document.createElement('div');
                particle.className = 'ocean-plankton';
                const size = Math.random() * 1.5 + 0.3;
                const hue = 170 + Math.random() * 40;
                Object.assign(particle.style, {
                    position: 'absolute',
                    width: `${size}px`,
                    height: `${size}px`,
                    background: `hsl(${hue}, 80%, 70%)`,
                    borderRadius: '50%',
                    boxShadow: `0 0 ${size * 3}px hsla(${hue}, 90%, 60%, 0.6)`,
                    '--x-start': `${Math.random() * 100}vw`,
                    '--y-start': `${Math.random() * 100}vh`,
                    '--x-end': `${Math.random() * 100}vw`,
                    '--y-end': `${Math.random() * 100}vh`,
                    animation: `planktonFloat ${18 + Math.random() * 15}s linear infinite`,
                    animationDelay: `-${Math.random() * 25}s`,
                    opacity: Math.random() * 0.7 + 0.3,
                });
                planktonContainer.appendChild(particle);
            }
            this.registerContainer(planktonContainer);
        }

        // Jellyfish
        const jellyfishContainer = document.getElementById('jellyfish-layer');
        if (jellyfishContainer) {
            jellyfishContainer.innerHTML = '';
            const jellyCount = this.currentPreset.jellyCount || 16;
            for (let i = 0; i < jellyCount; i++) {
                const fish = document.createElement('div');
                fish.className = 'jellyfish';
                const bodySize = 15 + Math.random() * 25;
                const body = document.createElement('div');
                body.className = 'jelly-body';
                Object.assign(body.style, {
                    width: `${bodySize}px`,
                    height: `${bodySize}px`,
                    background: `radial-gradient(circle, rgba(150, 200, 255, 0.6), rgba(100, 180, 240, 0.3))`,
                    borderRadius: '50% 50% 40% 40%',
                    boxShadow: `0 0 ${bodySize}px rgba(120, 200, 255, 0.5), inset 0 0 ${bodySize * 0.5}px rgba(200, 230, 255, 0.4)`,
                    animation: `jellyPulse ${2 + Math.random() * 1.5}s ease-in-out infinite`,
                });

                const tentacles = document.createElement('div');
                tentacles.className = 'jelly-tentacles';
                for (let j = 0; j < 6; j++) {
                    const tentacle = document.createElement('div');
                    tentacle.className = 'tentacle';
                    const tHeight = 25 + Math.random() * 35;
                    Object.assign(tentacle.style, {
                        position: 'absolute',
                        top: `${bodySize}px`,
                        left: `${j * (bodySize / 6)}px`,
                        width: '1px',
                        height: `${tHeight}px`,
                        background: `linear-gradient(180deg, rgba(120, 180, 240, 0.5), transparent)`,
                        transformOrigin: 'top',
                        animation: `tentacleWave ${1.5 + Math.random() * 1}s ease-in-out infinite`,
                        animationDelay: `-${Math.random() * 3}s`,
                    });
                    tentacles.appendChild(tentacle);
                }

                fish.appendChild(body);
                fish.appendChild(tentacles);
                Object.assign(fish.style, {
                    position: 'absolute',
                    '--x-start': `${Math.random() * 120 - 10}vw`,
                    '--y-start': `${110}vh`,
                    '--x-end': `${Math.random() * 120 - 10}vw`,
                    '--y-end': `${-20}vh`,
                    animation: `jellyfishFloat ${18 + Math.random() * 15}s linear infinite`,
                    animationDelay: `-${Math.random() * 30}s`,
                });

                jellyfishContainer.appendChild(fish);
            }
            this.registerContainer(jellyfishContainer);
        }

        this.setupEventListeners();
        this.setupEffectCanvas();
        this.startEffectLoop();
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

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true && Math.random() < 0.3) {
                this.createSmallBubblePop();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
        this.setupQualityListener();
    }

    onLineClear(lineCount) {
        this.createBubbleBurst(lineCount * 8);
        this.intensifyCaustics(lineCount);
        this.brightenGodRays(lineCount);
    }

    onCombo(comboCount) {
        this.currentComboLevel = comboCount;
        const now = Date.now();
        if (now - this.lastEffectTime < this.comboCooldownMs) return;
        this.lastEffectTime = now;

        const scale = this.adaptiveScale;

        // Low combo (1-3): Shockwave + Bioluminescence
        if (comboCount <= 3) {
            this.createShockwave(comboCount);
            this.createBioluminescence(Math.floor(comboCount * 8 * scale), 'small');
        }

        // Medium combo (4-6): School of fish + More light
        else if (comboCount <= 6) {
            this.spawnSchoolOfFish(Math.min(comboCount * 2, 15));
            this.createBioluminescence(Math.floor(comboCount * 12 * scale), 'medium');
            this.intensifyOcean(comboCount);
        }

        // High combo (7-10): Whale encounter
        else if (comboCount <= 10) {
            this.spawnWhale();
            this.createBioluminescence(Math.floor(comboCount * 15 * scale), 'large');
            this.intensifyOcean(comboCount);
        }

        // Epic combo (11+): Bioluminescent bloom
        else {
            this.createBiolumBloom(comboCount);
            this.intensifyOcean(comboCount);
        }

        this.createBubbleBurst(Math.floor(comboCount * 3 * scale));
    }

    createBubbleBurst(count) {
        if (!this.effectCanvas) return;
        const cap = Math.min(count, 80);
        for (let i = 0; i < cap; i++) {
            setTimeout(() => {
                if (!this.effectCanvas) return;
                this.bubbleBurstParticles.push({
                    x: Math.random() * this.effectCanvas.width,
                    y: this.effectCanvas.height * (0.6 + Math.random() * 0.2),
                    size: Math.random() * 8 + 3,
                    life: 1,
                    duration: 1.5 + Math.random() * 1,
                    speed: Math.random() * 1.8 + 1,
                });
            }, i * 40);
        }
    }

    intensifyCaustics(intensity) {
        const causticsLight = document.querySelector('.caustic-light');
        if (causticsLight) {
            causticsLight.style.transition = 'opacity 0.4s ease-out, filter 0.4s ease-out';
            causticsLight.style.filter = `brightness(${1.5 + intensity * 0.4}) contrast(1.3)`;
            causticsLight.style.opacity = '0.6';
            setTimeout(() => {
                causticsLight.style.filter = '';
                causticsLight.style.opacity = '';
            }, 600);
        }
    }

    brightenGodRays(intensity) {
        const count = Math.min(intensity * 3, this.godRays.length);
        for (let i = 0; i < count; i++) {
            const ray = this.godRays[Math.floor(Math.random() * this.godRays.length)];
            if (ray) {
                const original = ray.style.opacity;
                ray.style.transition = 'opacity 0.3s ease-out';
                ray.style.opacity = '0.5';
                setTimeout(() => { ray.style.opacity = original; }, 500);
            }
        }
    }

    createShockwave(comboCount) {
        if (!this.effectCanvas) return;
        const rect = this.effectCanvas.getBoundingClientRect();
        this.shockwaveEffects.push({
            x: rect.width / 2,
            y: rect.height / 2,
            startRadius: Math.max(rect.width, rect.height) * 0.1,
            maxRadius: Math.max(rect.width, rect.height) * 0.7,
            life: 1,
            duration: 2.5,
            width: 25,
        });
    }

    intensifyOcean(comboCount) {
        const theme = document.getElementById('ocean-theme');
        if (!theme) return;
        const saturation = 100 + Math.min(comboCount * 15, 60);
        const brightness = 100 + Math.min(comboCount * 10, 35);
        theme.style.filter = `saturate(${saturation}%) brightness(${brightness}%)`;
        setTimeout(() => { theme.style.filter = ''; }, 800 + comboCount * 100);
    }

    createBioluminescence(count, size = 'medium') {
        if (!this.effectCanvas) return;
        const cap = Math.min(count, this.currentPreset.biolumLimit || 50);
        const sizes = { small: [6, 12], medium: [10, 18], large: [15, 28] };
        const [minSize, maxSize] = sizes[size] || sizes.medium;

        const colors = [
            'rgba(100, 255, 220, 0.8)',
            'rgba(120, 240, 255, 0.8)',
            'rgba(140, 200, 255, 0.8)',
            'rgba(80, 255, 200, 0.8)',
        ];

        for (let i = 0; i < cap; i++) {
            setTimeout(() => {
                if (!this.effectCanvas) return;
                this.biolumParticles.push({
                    x: Math.random() * this.effectCanvas.width,
                    y: Math.random() * this.effectCanvas.height * 0.85,
                    size: Math.random() * (maxSize - minSize) + minSize,
                    life: 1,
                    duration: 2 + Math.random() * 1.5,
                    vx: (Math.random() - 0.5) * 0.3,
                    vy: (Math.random() - 0.5) * 0.3,
                    color: colors[Math.floor(Math.random() * colors.length)],
                });
            }, i * 25);
        }
    }

    createBiolumBloom(comboCount) {
        // Epic effect: Massive bioluminescent explosion
        if (!this.effectCanvas) return;
        const centerX = this.effectCanvas.width / 2;
        const centerY = this.effectCanvas.height / 2;
        const particleCount = Math.min(comboCount * 15, 200);

        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount;
            const speed = 1 + Math.random() * 2;
            this.biolumParticles.push({
                x: centerX,
                y: centerY,
                size: 12 + Math.random() * 20,
                life: 1,
                duration: 3 + Math.random() * 2,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: `rgba(${80 + Math.random() * 80}, ${200 + Math.random() * 55}, ${220 + Math.random() * 35}, 0.8)`,
            });
        }
    }

    spawnSchoolOfFish(count) {
        const schoolSize = Math.min(count, 18);
        const startY = 15 + Math.random() * 70;
        const direction = Math.random() > 0.5 ? 1 : -1;

        for (let i = 0; i < schoolSize; i++) {
            setTimeout(() => {
                if (!this.effectCanvas) return;
                const offsetY = (Math.random() - 0.5) * 18;
                const size = 6 + Math.random() * 10;
                const hue = 180 + Math.random() * 60;

                this.marineCreatures.push({
                    x: direction > 0 ? -50 : this.effectCanvas.width + 50,
                    y: this.effectCanvas.height * (startY / 100 + offsetY / 100),
                    size,
                    vx: direction * (2 + Math.random() * 1.5),
                    life: 1,
                    duration: 6 + Math.random() * 2,
                    color: `hsla(${hue}, 70%, 60%, 0.7)`,
                });
            }, i * 120);
        }
    }

    spawnWhale() {
        // Majestic whale silhouette
        if (!this.effectCanvas) return;
        const direction = Math.random() > 0.5 ? 1 : -1;
        const startY = 30 + Math.random() * 40;

        this.marineCreatures.push({
            x: direction > 0 ? -100 : this.effectCanvas.width + 100,
            y: this.effectCanvas.height * (startY / 100),
            size: 50 + Math.random() * 40,
            vx: direction * 0.8,
            life: 1,
            duration: 15,
            color: 'rgba(40, 80, 120, 0.6)',
        });

        // Whale creates bioluminescent trails
        this.createBioluminescence(40, 'small');
    }

    createSmallBubblePop() {
        if (!this.effectCanvas) return;
        for (let i = 0; i < 2; i++) {
            this.bubbleBurstParticles.push({
                x: this.effectCanvas.width / 2 + (Math.random() - 0.5) * 100,
                y: this.effectCanvas.height * 0.7,
                size: Math.random() * 6 + 2,
                life: 1,
                duration: 0.8,
                speed: Math.random() * 1.2 + 0.8,
            });
        }
    }

    stop() {
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];
        this.teardownQualityListener();
        this.currentComboLevel = 0;
        const theme = document.getElementById('ocean-theme');
        if (theme) theme.style.filter = '';
        this.godRays = [];
        this.kelpStrands = [];
        this.lastEffectTime = 0;
        this.lastFrameTime = 0;
        this.frameTimeAccumulator = 0;
        this.frameTimeCount = 0;
        this.averageFrameTime = 16.67;
        this.adaptiveScale = 1;
        if (this.perfMonitorId) {
            cancelAnimationFrame(this.perfMonitorId);
            this.perfMonitorId = null;
        }
        if (this.effectRafId) {
            cancelAnimationFrame(this.effectRafId);
            this.effectRafId = null;
        }
        this.effectLastFrame = 0;
        this.shockwaveEffects = [];
        this.biolumParticles = [];
        this.bubbleBurstParticles = [];
        this.marineCreatures = [];
        if (this.effectCtx && this.effectCanvas) {
            this.effectCtx.clearRect(0, 0, this.effectCanvas.width, this.effectCanvas.height);
        }
        super.stop();
    }

    getTetrominoConfig() {
        return OCEAN_TETROMINOS;
    }
}
