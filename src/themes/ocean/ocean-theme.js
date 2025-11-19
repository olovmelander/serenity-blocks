import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { OCEAN_TETROMINOS } from './ocean-tetrominos.js';

// Cache buster v2024-10-12-23:30
export default class OceanTheme extends BaseTheme {
    constructor() {
        super('ocean');
        console.log('[Ocean] Constructor called!');
        this.eventUnsubscribers = [];
        this.currentComboLevel = 0;
        this.godRays = [];
        this.lastEffectTime = 0;
        this.comboCooldownMs = 220;
        this.lastFrameTime = 0;
        this.frameTimeAccumulator = 0;
        this.frameTimeCount = 0;
        this.averageFrameTime = 16.67;
        this.adaptiveScale = 1;
        this.severeScaleThreshold = 0.6;
        this.activeShockwaves = 0;
        this.maxShockwaves = 1;
        this.activeBiolumGlows = 0;
        this.maxBiolumGlows = 12;
        this.effectCanvas = null;
        this.effectCtx = null;
        this.effectRafId = null;
        this.effectLastFrame = 0;
        this.shockwaveEffects = [];
        this.glowParticles = [];
        this.bubbleBurstParticles = [];
        this.presets = {
            Minimal: {
                burstMultiplier: 0.3,
                shockwaveScale: 0.5,
                bioluminescenceLimit: 3,
                fishCount: 0,
                bubbleBurstCap: 6,
                brightDurationMs: 350,
                comboCooldownMs: 300,
                sedimentCount: 40,
                bubbleCount: 60,
                planktonCount: 80,
                jellyCount: 4,
            },
            Low: {
                burstMultiplier: 0.5,
                shockwaveScale: 0.7,
                bioluminescenceLimit: 6,
                fishCount: 1,
                bubbleBurstCap: 12,
                brightDurationMs: 450,
                comboCooldownMs: 260,
                sedimentCount: 60,
                bubbleCount: 90,
                planktonCount: 120,
                jellyCount: 6,
            },
            Medium: {
                burstMultiplier: 0.75,
                shockwaveScale: 0.85,
                bioluminescenceLimit: 10,
                fishCount: 2,
                bubbleBurstCap: 18,
                brightDurationMs: 550,
                comboCooldownMs: 230,
                sedimentCount: 80,
                bubbleCount: 120,
                planktonCount: 160,
                jellyCount: 8,
            },
            High: {
                burstMultiplier: 1,
                shockwaveScale: 1,
                bioluminescenceLimit: 14,
                fishCount: 3,
                bubbleBurstCap: 24,
                brightDurationMs: 650,
                comboCooldownMs: 210,
                sedimentCount: 100,
                bubbleCount: 150,
                planktonCount: 200,
                jellyCount: 10,
            },
            Ultra: {
                burstMultiplier: 1.15,
                shockwaveScale: 1.1,
                bioluminescenceLimit: 18,
                fishCount: 3,
                bubbleBurstCap: 30,
                brightDurationMs: 750,
                comboCooldownMs: 200,
                sedimentCount: 120,
                bubbleCount: 180,
                planktonCount: 240,
                jellyCount: 12,
            },
            Extreme: {
                burstMultiplier: 1.4,
                shockwaveScale: 1.3,
                bioluminescenceLimit: 24,
                fishCount: 4,
                bubbleBurstCap: 40,
                brightDurationMs: 850,
                comboCooldownMs: 180,
                sedimentCount: 150,
                bubbleCount: 220,
                planktonCount: 300,
                jellyCount: 16,
            },
        };
        this.currentPreset = this.presets.High;
        console.log('[Ocean] Constructor complete!');
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyGraphicsPreset(quality) {
        const preset = this.presets[quality] || this.presets.High;
        this.currentPreset = preset;
        this.comboCooldownMs = preset.comboCooldownMs ?? 220;
        this.maxShockwaves = 1;
        this.maxBiolumGlows = preset.bioluminescenceLimit ?? 12;
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;
        this.teardownQualityListener();

        this.qualityListener = (event) => {
            const next = event.detail?.effectQuality;
            if (!next) return;
            this.applyGraphicsPreset(next);
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
        if (ft <= 20) return 0.92;
        if (ft <= 23) return 0.8;
        if (ft <= 26) return 0.68;
        if (ft <= 30) return 0.55;
        return 0.4;
    }

    isSeverelyStressed() {
        return this.adaptiveScale <= this.severeScaleThreshold || this.averageFrameTime > 26;
    }

    startPerformanceMonitor() {
        if (this.perfMonitorId) return;
        const step = (ts) => {
            if (!this.isActive) {
                this.perfMonitorId = null;
                return;
            }
            if (this.lastFrameTime === 0) {
                this.lastFrameTime = ts;
            }
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
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: '120',
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
            this.updateGlowParticles(dt);
            this.updateBubbleParticles(dt);

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
                this.activeShockwaves = Math.max(0, this.activeShockwaves - 1);
                continue;
            }
            const progress = 1 - sw.life;
            const radius = sw.startRadius + (sw.maxRadius - sw.startRadius) * progress;
            const alpha = sw.life * 0.6;
            const ctx = this.effectCtx;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = 'rgba(170, 230, 255, 0.7)';
            ctx.lineWidth = Math.max(2, sw.width * (1 - progress));
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    updateGlowParticles(dt) {
        for (let i = this.glowParticles.length - 1; i >= 0; i--) {
            const p = this.glowParticles[i];
            p.life -= dt / p.duration;
            if (p.life <= 0) {
                this.glowParticles.splice(i, 1);
                this.activeBiolumGlows = Math.max(0, this.activeBiolumGlows - 1);
                continue;
            }
            const alpha = p.life * 0.9;
            const size = p.size * (1 + (1 - p.life) * 0.5);
            const ctx = this.effectCtx;
            ctx.save();
            ctx.globalAlpha = alpha;
            const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
            grad.addColorStop(0, 'rgba(120, 255, 220, 0.8)');
            grad.addColorStop(1, 'rgba(120, 255, 220, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
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
            b.y -= b.speed * dt * 60;
            const alpha = b.life * 0.7;
            const ctx = this.effectCtx;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = 'rgba(200, 230, 255, 0.8)';
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    async createScene() {
        console.log('[Ocean] createScene() called!');
        this.applyGraphicsPreset(this.getGraphicsQuality());
        this.startPerformanceMonitor();
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
            this.godRays = [];
            const rayFragment = document.createDocumentFragment();
            for (let i = 0; i < 15; i++) {
                const ray = document.createElement('div');
                ray.className = 'ocean-god-ray';
                ray.style.left = `${Math.random() * 120 - 10}%`;
                ray.style.top = '0px';
                ray.style.width = `${Math.random() * 3 + 1}px`;
                ray.style.height = '120%';
                ray.style.transform = `rotate(${Math.random() * 20 - 10}deg)`;
                ray.style.opacity = `${Math.random() * 0.1 + 0.05}`;
                rayFragment.appendChild(ray);
                this.godRays.push(ray); // Store reference for reactive effects
            }
            godRayContainer.appendChild(rayFragment);
            this.registerContainer(godRayContainer);
        }

        // Floating Sediment - Adds underwater depth and movement
        const sedimentContainer = document.getElementById('ocean-sediment-layer');
        if (sedimentContainer) {
            sedimentContainer.innerHTML = ''; // Clear old sediment
            const sedimentFragment = document.createDocumentFragment();
            const sedimentCount = this.currentPreset?.sedimentCount ?? 100;
            for (let i = 0; i < sedimentCount; i++) {
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
                sedimentFragment.appendChild(particle);
            }
            sedimentContainer.appendChild(sedimentFragment);
            this.registerContainer(sedimentContainer);
        }

        // Bubbles - More bubbles for underwater feel
        const bubblesContainer = document.getElementById('bubbles');
        if (bubblesContainer) {
            bubblesContainer.innerHTML = ''; // Clear old bubbles
            const bubbleFragment = document.createDocumentFragment();
            const bubbleCount = this.currentPreset?.bubbleCount ?? 150;
            for (let i = 0; i < bubbleCount; i++) {
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
                bubbleFragment.appendChild(el);
            }
            bubblesContainer.appendChild(bubbleFragment);
            this.registerContainer(bubblesContainer);
        }

        // Plankton - More particles for immersive underwater feel
        const planktonContainer = document.getElementById('ocean-plankton-layer');
        if (planktonContainer) {
            planktonContainer.innerHTML = ''; // Clear old plankton
            const planktonFragment = document.createDocumentFragment();
            const planktonCount = this.currentPreset?.planktonCount ?? 200;
            for (let i = 0; i < planktonCount; i++) {
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
                planktonFragment.appendChild(particle);
            }
            planktonContainer.appendChild(planktonFragment);
            this.registerContainer(planktonContainer);
        }

        // Jellyfish - More jellyfish for life
        const jellyfishContainer = document.getElementById('jellyfish-layer');
        if (jellyfishContainer) {
            jellyfishContainer.innerHTML = ''; // Clear old jellyfish
            const jellyfishFragment = document.createDocumentFragment();
            const jellyCount = this.currentPreset?.jellyCount ?? 12;
            for (let i = 0; i < jellyCount; i++) {
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

                jellyfishFragment.appendChild(fish);
            }
            jellyfishContainer.appendChild(jellyfishFragment);
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

        layers.forEach((layer) => {
            const { el } = layer;
            if (el && el.children.length === 0) {
                const C_WIDTH = 250;
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(layer.count * C_WIDTH);
                canvas.height = layer.height;
                const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
                if (!ctx) {
                    return;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);

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

                const colorComponents = this.parseRgbaColor(layer.color);
                const seaweedColor = this.formatRgba(
                    this.clamp(colorComponents.r + 10, 0, 255),
                    this.clamp(colorComponents.g + 10, 0, 255),
                    this.clamp(colorComponents.b + 10, 0, 255),
                    this.clamp(colorComponents.a * 1.2, 0, 1),
                );
                const coralColor = this.formatRgba(
                    this.clamp(colorComponents.r - 5, 0, 255),
                    this.clamp(colorComponents.g + 5, 0, 255),
                    this.clamp(colorComponents.b + 5, 0, 255),
                    this.clamp(colorComponents.a, 0, 1),
                );

                const groundHeights = this.computeGroundHeights(ctx, canvas.width, canvas.height);

                for (let i = 0; i < layer.count * 1.5; i++) {
                    const x = Math.random() * canvas.width;
                    const groundIndex = groundHeights[Math.max(0, Math.min(canvas.width - 1, Math.floor(x)))];
                    if (groundIndex === undefined) {
                        continue;
                    }
                    const groundY = groundIndex;

                    if (Math.random() > 0.3) {
                        ctx.strokeStyle = seaweedColor;
                        const h = (Math.random() * 0.8 + 0.2) * layer.height;
                        ctx.beginPath();
                        ctx.moveTo(x, groundY);
                        ctx.bezierCurveTo(
                            x + (Math.random() - 0.5) * 50,
                            groundY - h * 0.3,
                            x + (Math.random() - 0.5) * 50,
                            groundY - h * 0.7,
                            x + (Math.random() - 0.5) * 30,
                            groundY - h,
                        );
                        ctx.lineWidth = Math.random() * 3 + 1;
                        ctx.stroke();
                    } else {
                        ctx.fillStyle = coralColor;
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
                el.appendChild(canvas);
                this.registerContainer(el);
            }
        });
        
        // Setup event listeners for reactive effects
        console.log('[Ocean] About to setup event listeners...');
        this.setupEventListeners();
        console.log('[Ocean] Event listeners setup complete!');
        this.setupEffectCanvas();
        this.startEffectLoop();
        this.startPerformanceMonitor();
        console.log('[Ocean] createScene() completed successfully!');
    }
    
    setupEventListeners() {
        console.log('[Ocean] Setting up event listeners');
        
        // Listen for line clear events
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            console.log('[Ocean] LINE_CLEAR event received:', data, 'isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });
        
        // Listen for combo events
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            console.log('[Ocean] COMBO event received:', data, 'isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });
        
        // Listen for piece lock events
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            console.log('[Ocean] PIECE_LOCK event received, isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data.piece);
            }
        });
        
        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
        console.log('[Ocean] Event listeners set up successfully');

        this.setupQualityListener();
    }
    
    /**
     * React to line clears with underwater effects
     */
    onLineClear(lineCount) {
        // Create bubble bursts
        this.createBubbleBurst(lineCount);
        
        // Intensify caustics
        this.intensifyCaustics(lineCount);
        
        // Brighten god rays
        this.brightenGodRays(lineCount);
        
        // Spawn fish
        if (lineCount >= 2) {
            this.spawnFish(lineCount);
        }
    }
    
    /**
     * React to combos with intense ocean effects
     */
    onCombo(comboCount) {
        this.currentComboLevel = comboCount;
        const now = Date.now();
        const timeSinceLast = now - this.lastEffectTime;
        const performanceDrop = this.averageFrameTime > 24;
        const throttled = performanceDrop || timeSinceLast < this.comboCooldownMs;
        const severelyStressed = this.isSeverelyStressed();
        this.lastEffectTime = now;
        this.adaptiveScale = this.calculateAdaptiveScale();
        const scale = this.adaptiveScale;
        const preset = this.currentPreset;
        
        // Create underwater shockwave (canvas-based)
        if (!severelyStressed && this.activeShockwaves < this.maxShockwaves) {
            this.createShockwave(Math.max(1, Math.floor(comboCount * (preset.shockwaveScale ?? 1) * scale)));
        }
        
        // Intensify ocean colors
        this.intensifyOcean(comboCount);
        
        // Create bioluminescence for big combos (canvas-based)
        if (comboCount >= 3 && this.activeBiolumGlows < this.maxBiolumGlows && !severelyStressed) {
            const cap = preset.bioluminescenceLimit ?? 12;
            const count = Math.min(Math.floor(comboCount * 2 * scale), cap);
            this.createBioluminescence(count);
        }

        // Light bubble burst to keep feedback when throttled
        if (throttled || severelyStressed) {
            this.createBubbleBurst(Math.max(1, Math.floor(comboCount * 0.5 * scale)), true);
        }
    }
    
    /**
     * React to piece locks with subtle bubbles
     */
    onPieceLock(piece) {
        // Small bubble pop on piece lock (40% chance)
        if (Math.random() < 0.4) {
            this.createSmallBubblePop();
        }
    }
    
    /**
     * Create bubble burst effects
     */
    createBubbleBurst(intensity, throttled = false) {
        const bubblesContainer = document.getElementById('bubbles');
        if (!bubblesContainer) {
            console.warn('[Ocean] Bubbles container not found!');
            return;
        }
        const presetCap = this.currentPreset?.bubbleBurstCap ?? 24;
        const adaptiveCap = Math.max(8, Math.floor(presetCap * this.adaptiveScale));
        const burstCount = Math.min(Math.max(1, intensity * 5), adaptiveCap);

        const spacing = throttled ? 110 : 55;
        const durationBase = throttled ? 1.15 : 0.85;

        for (let i = 0; i < burstCount; i++) {
            setTimeout(() => {
                if (!this.effectCanvas) return;
                const size = Math.random() * 10 + 4;
                const baseX = Math.random() * this.effectCanvas.width;
                const baseY = this.effectCanvas.height * 0.7 + Math.random() * this.effectCanvas.height * 0.1;
                this.bubbleBurstParticles.push({
                    x: baseX,
                    y: baseY,
                    size,
                    life: 1,
                    duration: Math.max(0.7, Math.random() * 1 + durationBase),
                    speed: Math.random() * 1.5 + 1,
                });
            }, i * spacing);
        }
    }
    
    /**
     * Intensify caustics on line clears
     */
    intensifyCaustics(intensity) {
        const causticsLight = document.querySelector('.caustic-light');
        if (causticsLight) {
            const originalFilter = causticsLight.style.filter || '';
            causticsLight.style.transition = 'filter 0.5s ease-out, opacity 0.5s ease-out';
            causticsLight.style.filter = `brightness(${1.5 + intensity * 0.3}) contrast(${1.2 + intensity * 0.1})`;
            causticsLight.style.opacity = '0.5';
            
            setTimeout(() => {
                causticsLight.style.filter = originalFilter;
                causticsLight.style.opacity = '';
            }, 500);
        }
    }
    
    /**
     * Brighten god rays
     */
    brightenGodRays(intensity) {
        const raysToBrighten = Math.min(Math.floor(intensity * 2), this.godRays.length);
        const duration = (this.currentPreset?.brightDurationMs ?? 600) * this.adaptiveScale;

        for (let i = 0; i < raysToBrighten; i++) {
            const ray = this.godRays[Math.floor(Math.random() * this.godRays.length)];
            if (ray) {
                const originalOpacity = ray.style.opacity;
                ray.style.transition = 'opacity 0.35s ease-out';
                ray.style.opacity = `${Math.min(parseFloat(originalOpacity) * 2.6, 0.28)}`;
                
                setTimeout(() => {
                    ray.style.opacity = originalOpacity;
                }, duration);
            }
        }
    }
    
    /**
     * Spawn swimming fish
     */
    spawnFish(intensity) {
        const theme = document.getElementById('ocean-theme');
        if (!theme) return;
        const presetFish = this.currentPreset?.fishCount ?? 2;
        const fishCount = Math.min(intensity, presetFish);
        
        for (let i = 0; i < fishCount; i++) {
            setTimeout(() => {
                const fish = document.createElement('div');
                fish.className = 'swimming-fish';
                
                const startY = 20 + Math.random() * 50;
                const direction = Math.random() > 0.5 ? 1 : -1;
                
                fish.style.top = `${startY}%`;
                fish.style.left = direction > 0 ? '-5%' : '105%';
                fish.style.setProperty('--fish-direction', direction > 0 ? '1' : '-1');
                fish.style.animationDuration = `${3 + Math.random() * 2}s`;
                
                theme.appendChild(fish);
                
                setTimeout(() => {
                    if (fish.parentNode) {
                        fish.parentNode.removeChild(fish);
                    }
                }, 5000);
            }, i * 500);
        }
    }
    
    /**
     * Create underwater shockwave
     */
    createShockwave(comboCount) {
        const theme = document.getElementById('ocean-theme');
        if (!theme) return;
        const scale = this.adaptiveScale;
        const baseScale = 2 + comboCount * 0.5;
        const radius = (80 + comboCount * 30) * Math.max(0.6, scale);
        const duration = (1.5 + comboCount * 0.2) * Math.max(0.6, scale);
        const rect = theme.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;

        this.shockwaveEffects.push({
            x: cx,
            y: cy,
            startRadius: radius * 0.4,
            maxRadius: radius,
            life: 1,
            duration,
            width: 12 * Math.max(0.6, scale),
        });
        this.activeShockwaves += 1;
    }
    
    /**
     * Intensify ocean colors
     */
    intensifyOcean(comboCount) {
        const theme = document.getElementById('ocean-theme');
        if (!theme) return;
        const scale = this.adaptiveScale;
        const saturation = 100 + Math.min(comboCount * 18 * scale, 70);
        const brightness = 100 + Math.min(comboCount * 12 * scale, 40);
        
        theme.style.filter = `saturate(${saturation}%) brightness(${brightness}%)`;
        
        setTimeout(() => {
            theme.style.filter = '';
        }, (this.currentPreset?.brightDurationMs ?? 600) + comboCount * 120);
    }
    
    /**
     * Create bioluminescent glow
     */
    createBioluminescence(comboCount) {
        if (!this.effectCanvas) return;
        const cap = this.currentPreset?.bioluminescenceLimit ?? 12;
        const glowCount = Math.min(comboCount, cap, Math.max(0, this.maxBiolumGlows - this.activeBiolumGlows));
        const scale = this.adaptiveScale;
        for (let i = 0; i < glowCount; i++) {
            const size = (Math.random() * 12 + 8) * Math.max(0.6, scale);
            this.glowParticles.push({
                x: Math.random() * this.effectCanvas.width,
                y: Math.random() * this.effectCanvas.height * 0.8,
                size,
                life: 1,
                duration: 1 + Math.random() * 0.6,
            });
            this.activeBiolumGlows += 1;
        }
    }
    
    /**
     * Create small bubble pop
     */
    createSmallBubblePop() {
        const bubblesContainer = document.getElementById('bubbles');
        if (!bubblesContainer) return;
        
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                const bubble = document.createElement('div');
                bubble.className = 'small-bubble-pop';
                
                const size = Math.random() * 8 + 3;
                bubble.style.width = `${size}px`;
                bubble.style.height = `${size}px`;
                bubble.style.left = `${45 + Math.random() * 10}%`;
                bubble.style.bottom = `${40 + Math.random() * 20}%`;
                
                bubblesContainer.appendChild(bubble);
                
                setTimeout(() => {
                    if (bubble.parentNode) {
                        bubble.parentNode.removeChild(bubble);
                    }
                }, 800);
            }, i * 80);
        }
    }

    parseRgbaColor(color) {
        if (!color) {
            return { r: 0, g: 0, b: 0, a: 1 };
        }
        const match = color.match(/rgba?\(([^)]+)\)/i);
        if (!match) {
            return { r: 0, g: 0, b: 0, a: 1 };
        }
        const parts = match[1].split(',').map(part => parseFloat(part.trim()));
        const [r = 0, g = 0, b = 0, a = 1] = parts;
        return { r, g, b, a };
    }

    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    formatRgba(r, g, b, a) {
        return `rgba(${Math.round(this.clamp(r, 0, 255))}, ${Math.round(this.clamp(g, 0, 255))}, ${Math.round(this.clamp(b, 0, 255))}, ${this.clamp(a, 0, 1)})`;
    }

    computeGroundHeights(ctx, width, height) {
        try {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            const heights = new Array(width);
            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    const alphaIndex = (y * width + x) * 4 + 3;
                    if (data[alphaIndex] > 0) {
                        heights[x] = y;
                        break;
                    }
                }
            }
            return heights;
        } catch (error) {
            console.warn('[Ocean] Failed to compute ground heights:', error);
            return [];
        }
    }
    
    stop() {
        // Unsubscribe from all events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];
        this.teardownQualityListener();

        // Reset combo level
        this.currentComboLevel = 0;

        // Clear any active effects
        const theme = document.getElementById('ocean-theme');
        if (theme) {
            theme.style.filter = '';
        }
        this.godRays = [];
        this.lastEffectTime = 0;
        this.lastFrameTime = 0;
        this.frameTimeAccumulator = 0;
        this.frameTimeCount = 0;
        this.averageFrameTime = 16.67;
        this.adaptiveScale = 1;
        this.activeShockwaves = 0;
        this.activeBiolumGlows = 0;
        this.maxShockwaves = 1;
        this.maxBiolumGlows = 12;
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
        this.glowParticles = [];
        this.bubbleBurstParticles = [];
        if (this.effectCtx && this.effectCanvas) {
            this.effectCtx.clearRect(0, 0, this.effectCanvas.width, this.effectCanvas.height);
        }

        super.stop();
    }

    /**
     * Provide Ocean themed tetromino styling (vibrant underwater bioluminescence)
     * @returns {Object} Ocean tetromino configuration
     */
    getTetrominoConfig() {
        return OCEAN_TETROMINOS;
    }
}
