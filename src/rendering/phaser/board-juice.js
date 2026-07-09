/**
 * @fileoverview BoardJuice - Reactive board motion system (Screen Juice)
 *
 * Applies Tetris Effect-style micro-animations to the game board canvas:
 * nudges, tilts, dips, bounces, and pulses triggered by game events.
 *
 * Uses spring physics for smooth, natural settle-back.
 * All motion is applied via CSS transforms on the canvas element for
 * GPU-accelerated rendering without affecting the game coordinate space.
 */

import { clamp } from '@utils/helpers.js';

/**
 * Spring-damped value with velocity.
 * Simulates a spring that settles back to 0.
 */
class SpringValue {
    constructor(stiffness = 180, damping = 12) {
        this.value = 0;
        this.velocity = 0;
        this.stiffness = stiffness;
        this.damping = damping;
    }

    /** Apply an instantaneous impulse (adds to velocity) */
    impulse(amount) {
        this.velocity += amount;
    }

    /** Set value directly (immediate displacement) */
    set(amount) {
        this.value += amount;
    }

    /** Step the spring simulation forward by dt seconds */
    step(dt) {
        // Spring force: F = -kx - cv
        const springForce = -this.stiffness * this.value;
        const dampingForce = -this.damping * this.velocity;
        const acceleration = springForce + dampingForce;

        this.velocity += acceleration * dt;
        this.value += this.velocity * dt;

        // Kill tiny residual motion
        if (Math.abs(this.value) < 0.0005 && Math.abs(this.velocity) < 0.005) {
            this.value = 0;
            this.velocity = 0;
        }
    }

    /** Check if at rest */
    isAtRest() {
        return this.value === 0 && this.velocity === 0;
    }

    /** Reset to rest */
    reset() {
        this.value = 0;
        this.velocity = 0;
    }
}

/**
 * BoardJuice - Manages reactive board motion via CSS transforms.
 *
 * Usage:
 *   const juice = new BoardJuice(canvasElement);
 *   juice.nudge(1.5, 0);   // on move right
 *   juice.tilt(0.4);        // on move right
 *   juice.dip(3);           // on hard drop
 *   juice.bounce();         // on hard drop landing
 *   juice.pulse(1.01);      // on line clear
 *   juice.destroy();        // cleanup
 */
export class BoardJuice {
    /**
     * @param {HTMLElement} element - The DOM element to apply transforms to
     * @param {Object} [options] - Configuration overrides
     */
    constructor(element, options = {}) {
        this.element = element;
        if (!element) {
            console.warn('[BoardJuice] No element provided, effects disabled');
            this.disabled = true;
            return;
        }

        this.disabled = false;

        // Spring parameters — tuned for subtle, fast settle-back
        const stiffness = options.stiffness ?? 280;
        const damping = options.damping ?? 18;

        // Position springs
        this.x = new SpringValue(stiffness, damping);
        this.y = new SpringValue(stiffness, damping);

        // Rotation spring (slightly softer for elegant sway)
        this.rotation = new SpringValue(stiffness * 0.7, damping * 0.85);

        // Scale springs (stiffer for tight pulses)
        this.scaleX = new SpringValue(stiffness * 1.5, damping * 1.2);
        this.scaleY = new SpringValue(stiffness * 1.5, damping * 1.2);

        // Clamping limits — tight for subtle motion
        this.maxTranslate = options.maxTranslate ?? 3; // px
        this.maxRotation = options.maxRotation ?? 0.6; // degrees
        this.maxScale = options.maxScale ?? 0.015; // ±1.5% from 1.0

        // Animation loop
        this._rafId = null;
        this._lastTime = 0;
        this._running = false;
        this._boundTick = this._tick.bind(this);

        // Enable GPU acceleration
        this.element.style.willChange = 'transform';
        this.element.style.transformOrigin = 'center bottom';

        console.log('[BoardJuice] Initialized on element:', element.id || element.tagName);
    }

    // ─── Impulse API ──────────────────────────────────────────

    /**
     * Horizontal/vertical nudge (e.g., piece move left/right)
     * @param {number} dx - Horizontal impulse in pixels
     * @param {number} dy - Vertical impulse in pixels
     */
    nudge(dx, dy = 0) {
        if (this.disabled) return;
        this.x.set(dx * 0.5);
        this.x.impulse(dx * 15);
        if (dy) {
            this.y.set(dy * 0.5);
            this.y.impulse(dy * 15);
        }
        this._ensureRunning();
    }

    /**
     * Downward dip (e.g., hard drop slam)
     * @param {number} amount - Dip distance in pixels (positive = down)
     */
    dip(amount) {
        if (this.disabled) return;
        this.y.set(amount * 0.6);
        this.y.impulse(amount * 10);
        this._ensureRunning();
    }

    /**
     * Upward bounce rebound (call after dip for hard drop feel)
     */
    bounce() {
        if (this.disabled) return;
        this.y.impulse(-40);
        this._ensureRunning();
    }

    /**
     * Rotational tilt (e.g., piece move or rotate)
     * @param {number} degrees - Tilt in degrees (positive = clockwise)
     */
    tilt(degrees) {
        if (this.disabled) return;
        this.rotation.set(degrees * 0.5);
        this.rotation.impulse(degrees * 12);
        this._ensureRunning();
    }

    /**
     * Uniform scale pulse (e.g., line clear)
     * @param {number} targetScale - Target scale (e.g., 1.01 for 1% expansion)
     */
    pulse(targetScale) {
        if (this.disabled) return;
        const delta = targetScale - 1.0;
        this.scaleX.set(delta);
        this.scaleY.set(delta);
        this._ensureRunning();
    }

    // ─── Animation Loop ───────────────────────────────────────

    _ensureRunning() {
        if (!this._running && !this.disabled) {
            this._running = true;
            this._lastTime = performance.now();
            this._rafId = requestAnimationFrame(this._boundTick);
        }
    }

    _tick(now) {
        if (this.disabled || !this._running) return;

        const dt = Math.min((now - this._lastTime) / 1000, 0.05);
        this._lastTime = now;

        // Step all springs
        this.x.step(dt);
        this.y.step(dt);
        this.rotation.step(dt);
        this.scaleX.step(dt);
        this.scaleY.step(dt);

        // Check if all springs are at rest
        const atRest = this.x.isAtRest()
            && this.y.isAtRest()
            && this.rotation.isAtRest()
            && this.scaleX.isAtRest()
            && this.scaleY.isAtRest();

        if (atRest) {
            this.element.style.transform = '';
            this._running = false;
            return;
        }

        // Clamp values
        const tx = clamp(this.x.value, -this.maxTranslate, this.maxTranslate);
        const ty = clamp(this.y.value, -this.maxTranslate, this.maxTranslate);
        const rot = clamp(this.rotation.value, -this.maxRotation, this.maxRotation);
        const sx = 1 + clamp(this.scaleX.value, -this.maxScale, this.maxScale);
        const sy = 1 + clamp(this.scaleY.value, -this.maxScale, this.maxScale);

        // Apply CSS transform
        this.element.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) `
            + `rotate(${rot.toFixed(3)}deg) `
            + `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;

        this._rafId = requestAnimationFrame(this._boundTick);
    }

    // ─── Lifecycle ────────────────────────────────────────────

    /** Reset all springs to rest immediately */
    reset() {
        this.x?.reset();
        this.y?.reset();
        this.rotation?.reset();
        this.scaleX?.reset();
        this.scaleY?.reset();
        if (this.element) {
            this.element.style.transform = '';
        }
    }

    /** Cleanup: stop animation loop and remove CSS */
    destroy() {
        this.disabled = true;
        this._running = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        if (this.element) {
            this.element.style.transform = '';
            this.element.style.willChange = '';
            this.element.style.transformOrigin = '';
        }
        this.element = null;
        console.log('[BoardJuice] Destroyed');
    }
}
