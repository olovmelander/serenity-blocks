/**
 * @fileoverview Effects on an opponent's mini-board (online versus), drawn on a 2D
 * overlay canvas over the tile — the same language as the Phaser boards
 * (src/rendering/phaser/shared-effects.js, docs/MENU_UI_OVERHAUL_2026-10.md §5.8):
 * light, never paint.
 *
 * - Light is added ('lighter') from soft gradients in the event's tone: no flat
 *   fill over the tile, ever (a lock or a garbage line used to wash the whole tile).
 * - A clear turns its rows to light (one slab per run of rows, a blade across it),
 *   a quad blooms gold, a few embers drift up.
 * - A cascade's waves count in the chain's tone (aqua, gold, coral, a hot pink),
 *   in Keystone type with a soft ring; a clean canvas is a gold dawn.
 * - Garbage heaves coral light up from the floor; a hard drop lights where it lands.
 * - Out: the tile drains to grey under the Out card (opponent-watch-manager.js).
 * - The match won: light rises in the winner's colour, a halo breathes, shells of
 *   motes open over the well (the Phaser boards' victory, as light).
 *
 * Never touches the opponent grid, so it cannot fight the snapshot interpolator.
 */
import { particlePool } from '../../utils/object-pool.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../core/constants.js';
import { clamp } from '../../utils/helpers.js';
import { TONE, mixColor, toneCss } from '../../rendering/phaser/fx/fx-kit.js';

const MAX_PARTICLES_FOCUSED = 90;
const MAX_PARTICLES_UNFOCUSED = 48;
const TWO_PI = Math.PI * 2;
/** One clean canvas per move: the host hears it twice (the emptying wave, then physics). */
const CLEAN_CANVAS_ONCE_MS = 1500;

/** The match won: where the shells open (x, y as fractions of the tile), when, how big. */
const VICTORY_SHELLS = Object.freeze([
    [0.3, 0.3, 0, 1], [0.72, 0.22, 300, 1.05], [0.5, 0.14, 650, 1.15], [0.26, 0.5, 980, 0.85], [0.76, 0.44, 1250, 0.9],
]);

const reducedMotion = () => {
    try {
        return Boolean(window.settingsManager?.get?.().reducedMotion
            || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
        return false;
    }
};

const rgbOf = (int) => ({ r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 });
const rgba = ({ r, g, b }, a) => `rgba(${r}, ${g}, ${b}, ${clamp(a, 0, 1)})`;

function parseColorInt(color, fallback = TONE.CREAM) {
    if (typeof color === 'number' && Number.isFinite(color)) return color;
    const hex = /^#?([a-f\d]{6})$/i.exec(String(color || '').trim());
    if (hex) return parseInt(hex[1], 16);
    const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(String(color || ''));
    if (rgb) return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]);
    return fallback;
}

/** A chain's tone, as on the Phaser boards. */
const chainTone = (count) => {
    if (count >= 10) return TONE.DANGER;
    if (count >= 7) return TONE.CORAL;
    if (count >= 4) return TONE.GOLD;
    return TONE.AQUA;
};

/** A clear's tone: cream, warming to gold for a quad. */
const clearTone = (lines) => {
    if (lines >= 4) return TONE.GOLD;
    if (lines === 3) return mixColor(TONE.CREAM, TONE.GOLD, 0.45);
    return TONE.CREAM;
};

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

        // Light primitives in flight; the move in progress (its waves and lines, as
        // Quadra counts a combo) tints the clears and names the clean canvas.
        this.lights = [];
        this.comboEnergy = 0;
        this.chainCount = 0;
        this.moveLines = 0;
        this._cleanAt = -Infinity;
        this._timers = new Set();

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

        this.isDead = false;

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

    /**
     * Adds a light. kind: slab (a band across the tile), blade (a thin bright cut),
     * bloom (a soft disc), rise (light up from the floor), ring (a soft circle).
     */
    _light(kind, opts) {
        this.lights.push({
            kind,
            x: this.width / 2,
            y: this.height / 2,
            w: this.width,
            h: this.blockSize,
            r0: this.blockSize,
            r1: this.blockSize * 6,
            peak: 0.6,
            hold: 0,
            fade: 0.3,
            delay: 0,
            grow: 0,
            elapsed: 0,
            ...opts,
            rgb: rgbOf(opts.color ?? TONE.CREAM),
        });
        this.ensureLoop();
    }

    /** One light at its current strength (0..1 of its life), drawn additively. */
    _drawLight(ctx, l) {
        const life = l.hold + l.fade;
        const t = clamp(l.elapsed / Math.max(life, 0.001), 0, 1);
        const fadeT = l.elapsed <= l.hold ? 0 : clamp((l.elapsed - l.hold) / Math.max(l.fade, 0.001), 0, 1);
        const a = l.peak * (1 - fadeT) * (l.kind === 'ring' ? 1 : (1 - fadeT * 0.2));
        if (a <= 0.004) return;
        const { rgb } = l;
        if (l.kind === 'slab') {
            const h = l.h * (1 + l.grow * fadeT);
            const top = l.y - h / 2;
            const g = ctx.createLinearGradient(0, top, 0, top + h);
            g.addColorStop(0, rgba(rgb, 0));
            g.addColorStop(0.16, rgba(rgb, a * 0.85));
            g.addColorStop(0.5, rgba(rgb, a));
            g.addColorStop(0.84, rgba(rgb, a * 0.85));
            g.addColorStop(1, rgba(rgb, 0));
            ctx.fillStyle = g;
            ctx.fillRect(0, top, this.width, h);
        } else if (l.kind === 'blade') {
            const w = l.w * (1 + l.grow * fadeT);
            const g = ctx.createLinearGradient(l.x - w / 2, 0, l.x + w / 2, 0);
            g.addColorStop(0, rgba(rgb, 0));
            g.addColorStop(0.5, rgba(rgb, a));
            g.addColorStop(1, rgba(rgb, 0));
            ctx.fillStyle = g;
            const h = Math.max(1.5, l.h * (1 - fadeT * 0.5));
            ctx.fillRect(l.x - w / 2, l.y - h / 2, w, h);
        } else if (l.kind === 'bloom') {
            const r = l.r0 * (1 + l.grow * t);
            const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
            g.addColorStop(0, rgba(rgb, a));
            g.addColorStop(0.4, rgba(rgb, a * 0.38));
            g.addColorStop(1, rgba(rgb, 0));
            ctx.fillStyle = g;
            ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
        } else if (l.kind === 'rise') {
            const h = l.h * (0.4 + 0.6 * Math.min(1, l.elapsed / 0.25));
            const g = ctx.createLinearGradient(0, this.height, 0, this.height - h);
            g.addColorStop(0, rgba(rgb, a));
            g.addColorStop(0.35, rgba(rgb, a * 0.35));
            g.addColorStop(1, rgba(rgb, 0));
            ctx.fillStyle = g;
            ctx.fillRect(0, this.height - h, this.width, h);
        } else if (l.kind === 'ring') {
            // A soft band of light opening outwards, brightest on its radius: no stroke.
            const eased = 1 - ((1 - t) ** 3);
            const r = l.r0 + (l.r1 - l.r0) * eased;
            const band = Math.max(2, this.blockSize * 0.9);
            const inner = Math.max(0, r - band);
            const outer = r + band;
            const mid = (r - inner) / (outer - inner);
            const ra = a * (1 - t) * Math.min(1, t / 0.06); // dark until it has opened out
            const g = ctx.createRadialGradient(l.x, l.y, inner, l.x, l.y, outer);
            g.addColorStop(0, rgba(rgb, 0));
            g.addColorStop(mid * 0.55, rgba(rgb, ra * 0.28));
            g.addColorStop(mid, rgba(rgb, ra));
            g.addColorStop(mid + (1 - mid) * 0.45, rgba(rgb, ra * 0.28));
            g.addColorStop(1, rgba(rgb, 0));
            ctx.fillStyle = g;
            ctx.fillRect(l.x - outer, l.y - outer, outer * 2, outer * 2);
        }
    }

    tick(timestamp) {
        const dt = timestamp - this.lastTimestamp;
        this.lastTimestamp = timestamp;
        const dtSeconds = Math.min(dt / 1000, 0.1);

        const { ctx } = this;
        ctx.clearRect(0, 0, this.width, this.height);
        let active = false;

        if (this.comboEnergy > 0) {
            this.comboEnergy = Math.max(0, this.comboEnergy - dtSeconds * 0.8);
        }

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        if (this.lights.length > 0) {
            const remaining = [];
            for (let i = 0; i < this.lights.length; i += 1) {
                const l = this.lights[i];
                if (l.delay > 0) {
                    l.delay -= dtSeconds;
                    remaining.push(l);
                    active = true;
                    continue;
                }
                l.elapsed += dtSeconds;
                if (l.elapsed >= l.hold + l.fade) continue;
                this._drawLight(ctx, l);
                remaining.push(l);
                active = true;
            }
            this.lights = remaining;
        }

        // Embers and sparks: soft motes of light, never confetti.
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
                particle.alpha = clamp(particle.life / particle.maxLife, 0, 1);
                if (particle.x < -16 || particle.x > this.width + 16 || particle.y > this.height + 16) {
                    particlePool.release(particle);
                    continue;
                }
                ctx.beginPath();
                ctx.fillStyle = rgba(particle.colorRGB, particle.alpha * 0.9);
                ctx.arc(particle.x, particle.y, particle.size, 0, TWO_PI);
                ctx.fill();
                remaining.push(particle);
                active = true;
            }
            this.particles = remaining;
        }
        ctx.restore();

        if (active) {
            this.animationFrame = requestAnimationFrame(this.tick);
        } else {
            this.animationFrame = null;
            ctx.clearRect(0, 0, this.width, this.height);
        }
    }

    /**
     * A soft bloom from the middle (the old API's full-tile flash, as light).
     * @param {string} [color]
     * @param {number} [strength]
     * @param {number} [duration] ms
     */
    triggerFlash(color = '#ffffff', strength = 1, duration = 220) {
        this._light('bloom', {
            color: mixColor(parseColorInt(color), TONE.CREAM, 0.3),
            r0: Math.max(this.width, this.height) * 0.55,
            peak: clamp(0.12 + strength * 0.14, 0.08, 0.4),
            hold: 0.02,
            fade: duration / 1000,
        });
    }

    /**
     * The rows turn to light: one slab per run of rows (a quad is one block, not four
     * stripes), a blade across it, a gold bloom for a quad, embers drifting up.
     * @param {number[]} rows absolute board rows (hidden rows included)
     * @param {number} [linesCleared]
     * @param {string} [color] ignored: the tone follows the clear and the chain
     * @param {number|null} [depth] the wave's depth in its cascade (1: a lock's own
     *   clear, which starts a new move); unknown leaves the move as it is
     */
    triggerLineClearFlash(rows = [], linesCleared = rows.length || 1, color = '#ffffff', depth = null) { // eslint-disable-line no-unused-vars
        const wave = Number(depth);
        if (depth !== null && Number.isFinite(wave) && wave >= 1) {
            if (wave === 1) {
                this.chainCount = 0;
                this.moveLines = 0;
            } else {
                this.chainCount = wave;
            }
            this.moveLines += Math.max(0, Number(linesCleared) || 0);
        }
        const bs = this.blockSize;
        const visible = [...rows]
            .map((r) => r - this.hiddenRows)
            .filter((r) => r >= 0 && r < ROWS + 2)
            .sort((a, b) => a - b);
        const chainMix = Math.min(0.4 + 0.05 * (this.chainCount - 2), 0.65);
        const tone = this.chainCount >= 2
            ? mixColor(clearTone(linesCleared), chainTone(this.chainCount), chainMix)
            : clearTone(linesCleared);
        const blocks = [];
        visible.forEach((row) => {
            const block = blocks[blocks.length - 1];
            if (block && block.bottom === row - 1) block.bottom = row;
            else blocks.push({ top: row, bottom: row });
        });
        const peak = Math.min(0.92, 0.76 + 0.05 * Math.min(linesCleared, 4));
        blocks.forEach(({ top, bottom }, i) => {
            const n = bottom - top + 1;
            const y = top * bs + (n * bs) / 2;
            this._light('slab', {
                y, h: (n * bs) / 0.7, color: tone, peak, hold: 0.12 + i * 0.03, fade: 0.3, grow: 0.5 / n,
            });
            this._light('blade', {
                x: this.width / 2,
                y,
                w: this.width * 1.2,
                h: Math.max(2, bs * (0.3 + 0.1 * Math.min(n, 4))),
                color: mixColor(tone, TONE.CREAM, 0.6),
                peak: 1,
                hold: 0.06,
                fade: 0.24,
                grow: 0.12,
            });
            if (linesCleared >= 4) {
                this._light('bloom', {
                    x: this.width / 2, y, color: TONE.GOLD, r0: this.width * 0.95, peak: 0.34, hold: 0.04, fade: 0.46,
                });
            }
        });
        this.spawnRowParticles(rows, Math.min(linesCleared, 4) / 2);
    }

    /** The clear's weight is the light itself; nothing more on a tile this small. */
    triggerLineClearImpact() {}

    /**
     * A cascade wave's count: the number in the chain's tone over a soft ring.
     * @param {number} comboCount the wave's depth
     */
    triggerCombo(comboCount = 2, color = '#ffd166') { // eslint-disable-line no-unused-vars
        const count = Math.max(1, Number(comboCount) || 1);
        this.chainCount = count;
        this.comboEnergy = Math.min(4, count * 0.65);
        const tone = chainTone(count);
        this._callout({
            lead: String(count), title: 'Combo', tone, y: 0.3, hold: 420,
        });
        this.triggerCascadeWave(count, tone);
    }

    /**
     * A soft ring in the chain's tone opening from the middle.
     * @param {number} [count]
     */
    triggerCascadeWave(count = 2, color = null) {
        const tone = color === null || typeof color === 'string' ? chainTone(count) : color;
        this._light('ring', {
            x: this.width / 2,
            y: this.height * 0.5,
            r0: this.blockSize * 1.2,
            r1: Math.hypot(this.width, this.height) * 0.5,
            color: tone,
            peak: clamp(0.35 + count * 0.03, 0.3, 0.6),
            hold: 0,
            fade: 0.55,
        });
    }

    /**
     * Clean canvas: a gold dawn up the empty tile, a bloom, two rings and the callout,
     * named by the move that made it (as the Phaser boards do). Once per move.
     * @param {number} [depth] lines in the move (physics' depth), when known
     * @param {string} [color] ignored: a clean canvas is gold
     * @param {number} [delayMs] lands this much later (the emptying wave's rows go first)
     */
    triggerPerfectClear(depth = 0, color = '#ffffff', delayMs = 0) { // eslint-disable-line no-unused-vars
        const now = performance.now();
        if (now - this._cleanAt < CLEAN_CANVAS_ONCE_MS) return;
        this._cleanAt = now;
        const lines = Math.max(0, Number(depth) || 0, this.moveLines);
        const waves = this.chainCount;
        this.chainCount = 0;
        this.moveLines = 0;
        if (delayMs > 0) this._later(delayMs, () => this._cleanCanvas(waves, lines));
        else this._cleanCanvas(waves, lines);
    }

    /** @private */
    _cleanCanvas(waves, lines) {
        this._light('rise', {
            color: TONE.GOLD, h: this.height * 0.95, peak: 0.42, hold: 0.5, fade: 0.8,
        });
        this._light('bloom', {
            x: this.width / 2,
            y: this.height / 2,
            color: TONE.GOLD,
            r0: Math.max(this.width, this.height) * 0.6,
            peak: 0.4,
            hold: 0.06,
            fade: 0.6,
        });
        [TONE.GOLD, TONE.CREAM].forEach((tone, i) => this._light('ring', {
            x: this.width / 2,
            y: this.height / 2,
            r0: this.blockSize * (1 + i),
            r1: Math.hypot(this.width, this.height) * 0.6,
            color: tone,
            peak: 0.5,
            hold: 0,
            fade: 0.7,
            delay: i * 0.08,
        }));
        this.spawnBurstParticles(this.width / 2, this.height * 0.75, this.isFocused ? 28 : 18, 80, TONE.GOLD);
        const kicker = waves >= 2 ? `Combo \u00d7${waves} \u00b7 ${lines} lines` : 'Perfect clear';
        this._callout({
            kicker, title: 'Clean canvas', tone: TONE.GOLD, y: 0.48, hold: 760,
        });
    }

    /** A lock settles quietly: the board itself shows it (no full-tile pulse). */
    triggerPieceLockPulse() {}

    /**
     * A hard drop lands: light pools where it struck.
     * @param {number} x left of the contact edge (px)
     * @param {number} y contact edge (px)
     * @param {number} w its width (px)
     * @param {string|number} [color] the player's colour
     */
    triggerLanding(x, y, w, color = TONE.CREAM) {
        const tint = mixColor(parseColorInt(color), TONE.CREAM, 0.45);
        const cx = x + w / 2;
        this._light('bloom', {
            x: cx, y, color: tint, r0: w * 0.8 + this.blockSize, peak: 0.38, hold: 0.02, fade: 0.3, grow: 0.2,
        });
        this._light('blade', {
            x: cx,
            y,
            w: w + this.blockSize * 1.4,
            h: Math.max(2, this.blockSize * 0.35),
            color: tint,
            peak: 0.95,
            hold: 0.02,
            fade: 0.26,
            grow: 0.3,
        });
    }

    /**
     * The match won on this tile: light rises in gold and the winner's colour, a halo
     * breathes behind the well until the results, and shells of motes open over it.
     * Reduced motion keeps the light alone.
     * @param {string|number} [color] the winner's colour
     */
    triggerVictory(color = TONE.GOLD) {
        const seat = parseColorInt(color, TONE.GOLD);
        this._light('rise', {
            color: mixColor(TONE.GOLD, seat, 0.2), h: this.height, peak: 0.42, hold: 1.3, fade: 0.9,
        });
        this._light('bloom', {
            x: this.width / 2,
            y: this.height * 0.42,
            color: mixColor(TONE.GOLD, seat, 0.3),
            r0: Math.max(this.width, this.height) * 0.62,
            peak: 0.26,
            hold: 1.4,
            fade: 0.7,
            delay: 0.12,
        });
        if (reducedMotion()) return;
        VICTORY_SHELLS.forEach(([fx, fy, delay, scale], i) => this._later(delay, () => this._shell(
            this.width * fx,
            this.height * fy,
            i % 2 ? TONE.GOLD : seat,
            scale,
        )));
    }

    /** A shell: a bloom, a ring opening from it and a sphere of motes drifting down. */
    _shell(x, y, tone, scale = 1) {
        const bs = this.blockSize;
        this._light('bloom', {
            x, y, color: mixColor(tone, TONE.CREAM, 0.3), r0: bs * 2.4 * scale, peak: 0.5, hold: 0.03, fade: 0.42,
        });
        this._light('ring', {
            x, y, r0: bs * 0.6, r1: bs * 3.4 * scale, color: tone, peak: 0.55, hold: 0, fade: 0.62,
        });
        const count = Math.round((this.isFocused ? 16 : 12) * scale);
        for (let i = 0; i < count && this.particles.length < this.maxParticles; i += 1) {
            const angle = (i / count) * TWO_PI + Math.random() * 0.3;
            const v = bs * (2.6 + Math.random() * 1.6) * scale;
            this._mote(x, y, Math.cos(angle) * v, Math.sin(angle) * v, bs * 3, i % 3 ? tone : TONE.CREAM, 0.7 + Math.random() * 0.35);
        }
    }

    /** Garbage heaves the stack: coral light up from the floor, dust from it. */
    triggerGarbageFlash(color = '#f87171') { // eslint-disable-line no-unused-vars
        this._light('rise', {
            color: mixColor(TONE.CORAL, TONE.SLATE, 0.25), h: this.height * 0.3, peak: 0.5, hold: 0.08, fade: 0.36,
        });
        this._light('blade', {
            x: this.width / 2,
            y: this.height - this.blockSize * 0.4,
            w: this.width * 1.2,
            h: Math.max(2, this.blockSize * 0.3),
            color: mixColor(TONE.CORAL, TONE.CREAM, 0.35),
            peak: 0.8,
            hold: 0.04,
            fade: 0.3,
        });
        const count = this.isFocused ? 10 : 6;
        for (let i = 0; i < count && this.particles.length < this.maxParticles; i += 1) {
            const vx = (Math.random() - 0.5) * 60;
            const vy = -60 - Math.random() * 110;
            const life = 0.45 + Math.random() * 0.3;
            this._mote(Math.random() * this.width, this.height - 2, vx, vy, 420, TONE.CORAL, life);
        }
    }

    _mote(x, y, vx, vy, gravity, toneInt, life, size = this.isFocused ? 2.2 : 1.7) {
        const particle = particlePool.acquire();
        particle.x = x;
        particle.y = y;
        particle.vx = vx;
        particle.vy = vy;
        particle.gravity = gravity;
        particle.life = life;
        particle.maxLife = life;
        particle.size = size;
        particle.alpha = 1;
        particle.colorRGB = rgbOf(toneInt);
        this.particles.push(particle);
        this.ensureLoop();
    }

    /** Embers lift off the cleared rows and drift: a few soft motes per row. */
    spawnRowParticles(rows = [], intensity = 1) {
        if (!rows || rows.length === 0) return;
        const perRow = Math.max(2, Math.round((this.isFocused ? 6 : 4) * (0.6 + intensity)));
        const tones = [TONE.CREAM, TONE.GOLD, mixColor(TONE.CREAM, TONE.GOLD, 0.5)];
        rows.forEach((rowIndex) => {
            const rowY = (clamp(rowIndex, 0, this.hiddenRows + ROWS) - this.hiddenRows) * this.blockSize;
            const spawnY = clamp(rowY, 0, this.height - this.blockSize);
            for (let i = 0; i < perRow && this.particles.length < this.maxParticles; i += 1) {
                this._mote(
                    Math.random() * this.width,
                    spawnY + Math.random() * this.blockSize * 0.3,
                    (Math.random() - 0.5) * 40,
                    -40 - Math.random() * 70,
                    -20,
                    tones[i % tones.length],
                    0.5 + Math.random() * 0.4,
                );
            }
        });
    }

    /** A small burst of sparks (a hard drop's landing, a clean canvas's motes). */
    spawnBurstParticles(centerX, centerY, count, speed, color = '#fde68a') {
        const available = this.maxParticles - this.particles.length;
        const emitCount = Math.min(Math.round(count * 0.6), Math.max(0, available));
        if (emitCount <= 0) return;
        const toneInt = mixColor(parseColorInt(color), TONE.CREAM, 0.4);
        for (let i = 0; i < emitCount; i += 1) {
            // Mostly sideways and up: a landing kicks sparks out, it does not explode.
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
            const v = speed * (0.35 + Math.random() * 0.45);
            const life = 0.3 + Math.random() * 0.3;
            this._mote(centerX, centerY, Math.cos(angle) * v, Math.sin(angle) * v, 520, toneInt, life);
        }
    }

    /**
     * A callout in Keystone type over the tile: a small kicker, then the word or the
     * number, cream with a glow in the tone. Words, never emoji; no pill.
     */
    _callout({
        kicker = null, lead = null, title = null, tone = TONE.CREAM, y = 0.4, hold = 500,
    }) {
        if (!this.textLayer) return;
        this.textLayer.querySelectorAll('.sb-tile-callout').forEach((old) => old.remove());
        const el = document.createElement('div');
        el.className = 'sb-tile-callout';
        el.style.setProperty('--tone', toneCss(tone));
        el.style.top = `${Math.round(y * 100)}%`;
        const span = (cls, text) => {
            if (!text) return;
            const s = document.createElement('span');
            s.className = cls;
            s.textContent = text;
            el.appendChild(s);
        };
        span('sb-tile-callout__kicker', kicker);
        span('sb-tile-callout__lead', lead);
        span('sb-tile-callout__title', title);
        this.textLayer.appendChild(el); // rises in by itself (CSS animation)
        this._later(hold, () => {
            el.classList.add('is-leaving');
            this._later(200, () => el.remove());
        });
    }

    /** A timeout the tile cancels when it resets or goes away. */
    _later(ms, fn) {
        const timer = setTimeout(() => {
            this._timers.delete(timer);
            fn();
        }, ms);
        this._timers.add(timer);
    }

    /**
     * Out: the tile drains to grey and dims under the Out card (the card itself is
     * the watch manager's); back in colour when the round resets.
     */
    setDeadState(isDead = true) {
        this.isDead = Boolean(isDead);
        const filter = this.isDead ? 'grayscale(100%) brightness(0.5)' : '';
        this.overlayCanvas.style.filter = filter;
        if (this.baseCanvas) {
            this.baseCanvas.style.transition = 'filter 640ms ease, opacity 640ms ease';
            this.baseCanvas.style.filter = this.isDead ? filter : 'none';
            this.baseCanvas.style.opacity = this.isDead ? '0.75' : '1';
        }
        if (this.isDead) this.chainCount = 0;
    }

    clearDeaths() {
        this.setDeadState(false);
    }

    clearAll() {
        this.stopLoop();
        this._clearTimers();
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.textLayer.innerHTML = '';
        this.lights = [];
        this.comboEnergy = 0;
        this.chainCount = 0;
        this.moveLines = 0;
        this._cleanAt = -Infinity;
        this.releaseParticles();
    }

    _clearTimers() {
        this._timers.forEach((timer) => clearTimeout(timer));
        this._timers.clear();
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
        this._clearTimers();
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
    }
}
