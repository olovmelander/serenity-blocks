import { particlePool } from '../../utils/object-pool.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../core/constants.js';

const MAX_PARTICLES_FOCUSED = 120;
const MAX_PARTICLES_UNFOCUSED = 60;
const TWO_PI = Math.PI * 2;

function parseColor(color) {
    if (!color) {
        return { r: 255, g: 255, b: 255 };
    }

    const hexMatch = /^#?([a-f\d]{6})$/i.exec(color.trim());
    if (hexMatch) {
        const intVal = parseInt(hexMatch[1], 16);
        return {
            r: (intVal >> 16) & 0xff,
            g: (intVal >> 8) & 0xff,
            b: intVal & 0xff,
        };
    }

    const rgbMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
    if (rgbMatch) {
        return {
            r: Number(rgbMatch[1]),
            g: Number(rgbMatch[2]),
            b: Number(rgbMatch[3]),
        };
    }

    return { r: 255, g: 255, b: 255 };
}

function toRGBA({ r, g, b }, alpha) {
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export class CanvasBoardEffects {
    constructor(container, {
        width,
        height,
        blockSize = Math.floor(width / COLS),
        focused = false,
        baseCanvas = null,
    }) {
        this.container = container;
        this.width = width;
        this.height = height;
        this.blockSize = blockSize;
        this.isFocused = focused;
        this.hiddenRows = HIDDEN_ROWS;
        this.baseCanvas = baseCanvas;

        this.flash = {
            color: { r: 255, g: 255, b: 255 },
            alpha: 0,
            duration: 0,
            elapsed: 0,
        };
        this.fadeOverlayAlpha = 0;
        this.rowFlashes = [];
        this.comboEnergy = 0;

        this.particles = [];
        this.maxParticles = this.isFocused ? MAX_PARTICLES_FOCUSED : MAX_PARTICLES_UNFOCUSED;

        this.animationFrame = null;
        this.lastTimestamp = 0;

        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.className = 'board-effects-overlay';
        this.overlayCanvas.width = width;
        this.overlayCanvas.height = height;
        this.overlayCanvas.style.position = 'absolute';
        this.overlayCanvas.style.top = '0';
        this.overlayCanvas.style.left = '0';
        this.overlayCanvas.style.width = '100%';
        this.overlayCanvas.style.height = '100%';
        this.overlayCanvas.style.pointerEvents = 'none';
        this.overlayCanvas.style.zIndex = '12';

        this.ctx = this.overlayCanvas.getContext('2d');

        this.textLayer = document.createElement('div');
        this.textLayer.className = 'board-effects-text-layer';
        this.textLayer.style.position = 'absolute';
        this.textLayer.style.top = '0';
        this.textLayer.style.left = '0';
        this.textLayer.style.width = '100%';
        this.textLayer.style.height = '100%';
        this.textLayer.style.pointerEvents = 'none';
        this.textLayer.style.zIndex = '13';

        this.deadOverlay = null;

        if (getComputedStyle(this.container).position === 'static') {
            this.container.style.position = 'relative';
        }
        this.container.appendChild(this.overlayCanvas);
        this.container.appendChild(this.textLayer);

        this.tick = this.tick.bind(this);
    }

    setFocused(focused) {
        if (this.isFocused === focused) return;
        this.isFocused = focused;
        this.maxParticles = this.isFocused ? MAX_PARTICLES_FOCUSED : MAX_PARTICLES_UNFOCUSED;
    }

    resize(width, height, blockSize = this.blockSize) {
        if (width === this.width && height === this.height && blockSize === this.blockSize) return;
        this.width = width;
        this.height = height;
        this.blockSize = blockSize;

        this.overlayCanvas.width = width;
        this.overlayCanvas.height = height;
    }

    ensureLoop() {
        if (this.animationFrame !== null) return;
        this.lastTimestamp = performance.now();
        this.animationFrame = requestAnimationFrame(this.tick);
    }

    stopLoop() {
        if (this.animationFrame !== null) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    tick(timestamp) {
        const dt = timestamp - this.lastTimestamp;
        this.lastTimestamp = timestamp;
        const dtSeconds = dt / 1000;

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        let active = false;

        if (this.comboEnergy > 0) {
            this.comboEnergy = Math.max(0, this.comboEnergy - dtSeconds * 0.8);
        }

        // Flash overlay
        if (this.flash.alpha > 0) {
            this.flash.elapsed += dt;
            const progress = clamp(this.flash.elapsed / this.flash.duration, 0, 1);
            const eased = 1 - Math.pow(progress, 2);
            const alpha = this.flash.alpha * eased;
            if (alpha > 0.01) {
                ctx.fillStyle = toRGBA(this.flash.color, alpha);
                ctx.fillRect(0, 0, this.width, this.height);
                active = true;
            } else {
                this.flash.alpha = 0;
            }
        }

        if (this.rowFlashes.length > 0) {
            const remaining = [];
            for (let i = 0; i < this.rowFlashes.length; i += 1) {
                const flash = this.rowFlashes[i];
                if (flash.delay > 0) {
                    flash.delay -= dtSeconds;
                    remaining.push(flash);
                    active = true;
                    continue;
                }

                flash.elapsed += dtSeconds;
                const progress = flash.elapsed / flash.duration;
                if (progress >= 1) {
                    continue;
                }

                const eased = Math.sin(progress * Math.PI);
                const alpha = clamp(eased * flash.strength, 0, 1);
                const offsetY = flash.baseY + flash.slideSpeed * flash.elapsed;

                if (offsetY > -this.blockSize && offsetY < this.height + this.blockSize) {
                    ctx.fillStyle = toRGBA(flash.colorRGB, alpha);
                    ctx.fillRect(0, offsetY, this.width, this.blockSize);

                    ctx.fillStyle = toRGBA({ r: 255, g: 255, b: 255 }, alpha * 0.35);
                    ctx.fillRect(0, offsetY, this.width, Math.min(6, this.blockSize * 0.25));
                }

                remaining.push(flash);
                active = true;
            }
            this.rowFlashes = remaining;
        }

        // Particles update
        if (this.particles.length > 0) {
            const remaining = [];

            for (let i = 0; i < this.particles.length; i += 1) {
                const particle = this.particles[i];
                particle.life -= dtSeconds;

                if (particle.life <= 0) {
                    particlePool.release(particle);
                    continue;
                }

                particle.x += particle.vx * dtSeconds;
                particle.y += particle.vy * dtSeconds;
                particle.vy += particle.gravity * dtSeconds;

                const lifeRatio = clamp(particle.life / particle.maxLife, 0, 1);
                particle.alpha = lifeRatio;

                if (particle.x < -16 || particle.x > this.width + 16 || particle.y > this.height + 16) {
                    particlePool.release(particle);
                    continue;
                }

                ctx.beginPath();
                ctx.fillStyle = toRGBA(particle.colorRGB, particle.alpha);
                ctx.arc(particle.x, particle.y, particle.size, 0, TWO_PI);
                ctx.fill();

                remaining.push(particle);
                active = true;
            }

            this.particles = remaining;
        }

        if (active) {
            this.animationFrame = requestAnimationFrame(this.tick);
        } else {
            this.animationFrame = null;
            ctx.clearRect(0, 0, this.width, this.height);
        }
    }

    triggerFlash(color = '#ffffff', strength = 1, duration = 220) {
        this.flash.color = parseColor(color);
        this.flash.alpha = clamp(0.35 + strength * 0.15, 0.15, 0.85);
        this.flash.duration = duration;
        this.flash.elapsed = 0;
        this.ensureLoop();
    }

    triggerLineClearFlash(rows = [], linesCleared = rows.length || 1, color = '#ffffff') {
        const flashStrength = 0.45 + (linesCleared * 0.18) + (this.comboEnergy * 0.12);
        const flashDuration = 220 + linesCleared * 35;
        this.triggerFlash(color, flashStrength, flashDuration);

        if (rows && rows.length > 0) {
            const sortedRows = [...rows].sort((a, b) => a - b);
            const colorRGB = parseColor(color);
            const comboBoost = 0.6 + this.comboEnergy * 0.2;

            sortedRows.forEach((rowIndex, waveIndex) => {
                const baseY = (rowIndex - this.hiddenRows) * this.blockSize;
                if (baseY < -this.blockSize || baseY > this.height + this.blockSize) {
                    return;
                }

                this.rowFlashes.push({
                    baseY,
                    elapsed: 0,
                    duration: 0.35 + waveIndex * 0.05,
                    delay: waveIndex * 0.05,
                    colorRGB,
                    slideSpeed: 14 + this.comboEnergy * 8,
                    strength: comboBoost,
                });
            });
        }

        this.spawnRowParticles(rows, linesCleared);
        this.ensureLoop();
    }

    triggerLineClearImpact(linesCleared = 1) {
        const baseCount = this.isFocused ? 24 : 12;
        const comboBoost = 1 + (this.comboEnergy * 0.35);
        const speed = 180 + (this.comboEnergy * 40);
        const tint = linesCleared >= 4 ? '#f97316' : '#ffd166';

        this.spawnBurstParticles(
            this.width / 2,
            this.height * 0.3,
            baseCount * clamp(linesCleared, 1, 5) * comboBoost,
            speed,
            tint,
        );
    }

    triggerCombo(comboCount = 2, color = '#ffd166') {
        this.comboEnergy = Math.min(4, comboCount * 0.65);
        this.ensureLoop();

        const badge = document.createElement('div');
        badge.className = 'combo-badge';
        badge.textContent = `${comboCount}x Combo!`;
        badge.style.position = 'absolute';
        badge.style.left = '50%';
        badge.style.top = '50%';
        badge.style.transform = 'translate(-50%, -50%) scale(0.75)';
        badge.style.padding = '6px 12px';
        badge.style.borderRadius = '12px';
        badge.style.fontSize = `${14 + comboCount * 2}px`;
        badge.style.fontWeight = '700';
        badge.style.color = '#1f2937';
        badge.style.background = toRGBA(parseColor(color), 0.85);
        badge.style.boxShadow = `0 8px 18px ${toRGBA(parseColor(color), 0.35)}`;
        badge.style.opacity = '0';
        badge.style.transition = 'transform 260ms cubic-bezier(0.39, 0.575, 0.565, 1), opacity 260ms ease-out';

        this.textLayer.appendChild(badge);

        requestAnimationFrame(() => {
            badge.style.opacity = '1';
            badge.style.transform = 'translate(-50%, -120%) scale(1.05)';
            setTimeout(() => {
                badge.style.opacity = '0';
                badge.style.transform = 'translate(-50%, -160%) scale(0.92)';
                setTimeout(() => {
                    badge.remove();
                }, 240);
            }, 520);
        });

        const burstSpeed = 210 + comboCount * 25;
        const particleCount = clamp(comboCount * 22, 24, 120);
        this.spawnBurstParticles(this.width / 2, this.height / 2, particleCount, burstSpeed, color);
    }

    triggerPieceLockPulse(color = '#6ee7b7') {
        this.triggerFlash(color, 0.6, 180);
    }

    triggerGarbageFlash(color = '#f87171') {
        this.triggerFlash(color, 0.8, 320);
    }

    spawnRowParticles(rows = [], intensity = 1) {
        if (!rows || rows.length === 0) return;
        const rowsClamped = rows.map((row) => clamp(row, 0, this.hiddenRows + ROWS));
        const baseCount = this.isFocused ? 18 : 10;
        const comboBoost = 1 + (this.comboEnergy * 0.4);
        const perRow = clamp(Math.round(baseCount * intensity * comboBoost), 6, this.maxParticles);

        rowsClamped.forEach((rowIndex) => {
            const rowY = (rowIndex - this.hiddenRows) * this.blockSize;
            const spawnY = clamp(rowY, 0, this.height - this.blockSize);
            for (let i = 0; i < perRow; i += 1) {
                if (this.particles.length >= this.maxParticles) break;
                const particle = particlePool.acquire();
                particle.x = Math.random() * this.width;
                particle.y = spawnY + Math.random() * this.blockSize;
                const lateral = this.isFocused ? 120 : 80;
                particle.vx = (Math.random() - 0.5) * (lateral + this.comboEnergy * 25);
                particle.vy = -90 - Math.random() * (120 + this.comboEnergy * 40);
                particle.gravity = 220;
                particle.life = 0.6 + Math.random() * 0.4;
                particle.maxLife = particle.life;
                particle.size = this.isFocused ? 3.0 : 2.3;
                particle.alpha = 1;
                const tintOptions = ['#fef3c7', '#fde68a', '#facc15', '#fbbf24'];
                particle.colorRGB = parseColor(tintOptions[Math.floor(Math.random() * tintOptions.length)]);
                this.particles.push(particle);
            }
        });

        if (this.particles.length > 0) {
            this.ensureLoop();
        }
    }

    spawnBurstParticles(centerX, centerY, count, speed, color = '#fde68a') {
        const available = this.maxParticles - this.particles.length;
        const emitCount = Math.min(count, Math.max(0, available));
        if (emitCount === 0) return;

        const colorRGB = parseColor(color);
        for (let i = 0; i < emitCount; i += 1) {
            const angle = Math.random() * TWO_PI;
            const particle = particlePool.acquire();
            particle.x = centerX;
            particle.y = centerY;
            particle.vx = Math.cos(angle) * (speed * (0.6 + Math.random() * 0.6));
            particle.vy = Math.sin(angle) * (speed * (0.6 + Math.random() * 0.6));
            particle.gravity = 150;
            particle.life = 0.8 + Math.random() * 0.4;
            particle.maxLife = particle.life;
            particle.size = this.isFocused ? 3.5 : 2.5;
            particle.alpha = 1;
            particle.colorRGB = colorRGB;
            this.particles.push(particle);
        }

        this.ensureLoop();
    }

    setDeadState(isDead = true) {
        if (isDead) {
            if (!this.deadOverlay) {
                this.deadOverlay = document.createElement('div');
                this.deadOverlay.style.position = 'absolute';
                this.deadOverlay.style.top = '0';
                this.deadOverlay.style.left = '0';
                this.deadOverlay.style.width = '100%';
                this.deadOverlay.style.height = '100%';
                this.deadOverlay.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.55), rgba(153, 27, 27, 0.65))';
                this.deadOverlay.style.mixBlendMode = 'multiply';
                this.deadOverlay.style.opacity = '0';
                this.deadOverlay.style.transition = 'opacity 220ms ease-in';
                this.deadOverlay.style.zIndex = '14';
                this.deadOverlay.style.pointerEvents = 'none';
                this.container.appendChild(this.deadOverlay);

                requestAnimationFrame(() => {
                    this.deadOverlay.style.opacity = '1';
                });
            }
            this.overlayCanvas.style.filter = 'grayscale(100%) brightness(0.6)';
            if (this.baseCanvas) {
                this.baseCanvas.style.filter = 'grayscale(100%) brightness(0.55)';
                this.baseCanvas.style.opacity = '0.65';
            }
        } else {
            if (this.deadOverlay) {
                this.deadOverlay.remove();
                this.deadOverlay = null;
            }
            this.overlayCanvas.style.filter = '';
            if (this.baseCanvas) {
                this.baseCanvas.style.filter = 'none';
                this.baseCanvas.style.opacity = '1';
            }
        }
    }

    clearDeaths() {
        this.setDeadState(false);
    }

    clearAll() {
        this.stopLoop();
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.textLayer.innerHTML = '';
        this.flash.alpha = 0;
        this.rowFlashes = [];
        this.comboEnergy = 0;
        this.releaseParticles();
    }

    releaseParticles() {
        while (this.particles.length > 0) {
            const particle = this.particles.pop();
            if (particle) {
                particlePool.release(particle);
            }
        }
    }

    destroy() {
        this.stopLoop();
        this.releaseParticles();
        if (this.baseCanvas) {
            this.baseCanvas.style.filter = 'none';
            this.baseCanvas.style.opacity = '1';
        }
        if (this.overlayCanvas?.parentElement) {
            this.overlayCanvas.remove();
        }
        if (this.textLayer?.parentElement) {
            this.textLayer.remove();
        }
        if (this.deadOverlay?.parentElement) {
            this.deadOverlay.remove();
        }
        this.deadOverlay = null;
    }
}
