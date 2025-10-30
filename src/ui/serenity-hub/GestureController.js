/**
 * @fileoverview Gesture Controller for Serenity Hub
 * Handles touch gestures for music control (swipe left/right to skip tracks)
 */

export class GestureController {
    constructor(targetElement, callbacks = {}) {
        this.element = targetElement;
        this.callbacks = callbacks;

        // Touch tracking
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchEndX = 0;
        this.touchEndY = 0;
        this.isSwiping = false;

        // Gesture thresholds
        this.minSwipeDistance = 50; // Minimum distance for swipe
        this.maxVerticalMovement = 100; // Max vertical movement for horizontal swipe
        this.swipeVelocityThreshold = 0.3; // Minimum velocity

        // Visual feedback
        this.swipeIndicator = null;

        this.init();
    }

    /**
     * Initialize gesture listeners
     */
    init() {
        if (!this.element) {
            console.warn('[GestureController] No target element provided');
            return;
        }

        this.createSwipeIndicator();
        this.attachEventListeners();
        console.log('[GestureController] Initialized');
    }

    /**
     * Create visual swipe indicator
     */
    createSwipeIndicator() {
        this.swipeIndicator = document.createElement('div');
        this.swipeIndicator.className = 'swipe-indicator';
        this.swipeIndicator.innerHTML = `
            <div class="swipe-icon left">
                <span class="swipe-arrow">←</span>
                <span class="swipe-text">Previous</span>
            </div>
            <div class="swipe-icon right">
                <span class="swipe-text">Next</span>
                <span class="swipe-arrow">→</span>
            </div>
        `;
        this.element.appendChild(this.swipeIndicator);
    }

    /**
     * Attach touch event listeners
     */
    attachEventListeners() {
        // Touch events
        this.element.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
        this.element.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.element.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: true });

        // Mouse events for desktop testing (optional)
        this.element.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.element.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.element.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    }

    /**
     * Handle touch start
     */
    handleTouchStart(e) {
        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.touchStartTime = Date.now();
        this.isSwiping = false;
    }

    /**
     * Handle touch move
     */
    handleTouchMove(e) {
        if (!this.touchStartX) return;

        const touch = e.touches[0];
        this.touchEndX = touch.clientX;
        this.touchEndY = touch.clientY;

        const deltaX = this.touchEndX - this.touchStartX;
        const deltaY = Math.abs(this.touchEndY - this.touchStartY);

        // Check if this is a horizontal swipe (not vertical scroll)
        if (Math.abs(deltaX) > 30 && deltaY < this.maxVerticalMovement) {
            this.isSwiping = true;
            this.updateSwipeIndicator(deltaX);

            // Prevent vertical scrolling during horizontal swipe
            e.preventDefault();
        }
    }

    /**
     * Handle touch end
     */
    handleTouchEnd(e) {
        if (!this.isSwiping) {
            this.hideSwipeIndicator();
            return;
        }

        const deltaX = this.touchEndX - this.touchStartX;
        const deltaY = Math.abs(this.touchEndY - this.touchStartY);
        const deltaTime = Date.now() - this.touchStartTime;
        const velocity = Math.abs(deltaX) / deltaTime;

        // Check if swipe meets criteria
        if (
            Math.abs(deltaX) > this.minSwipeDistance &&
            deltaY < this.maxVerticalMovement &&
            velocity > this.swipeVelocityThreshold
        ) {
            this.handleSwipe(deltaX);
        }

        // Reset
        this.resetSwipe();
    }

    /**
     * Handle mouse down (desktop testing)
     */
    handleMouseDown(e) {
        this.touchStartX = e.clientX;
        this.touchStartY = e.clientY;
        this.touchStartTime = Date.now();
        this.isMouseDown = true;
        this.isSwiping = false;
    }

    /**
     * Handle mouse move (desktop testing)
     */
    handleMouseMove(e) {
        if (!this.isMouseDown) return;

        this.touchEndX = e.clientX;
        this.touchEndY = e.clientY;

        const deltaX = this.touchEndX - this.touchStartX;
        const deltaY = Math.abs(this.touchEndY - this.touchStartY);

        if (Math.abs(deltaX) > 30 && deltaY < this.maxVerticalMovement) {
            this.isSwiping = true;
            this.updateSwipeIndicator(deltaX);
        }
    }

    /**
     * Handle mouse up (desktop testing)
     */
    handleMouseUp(e) {
        if (!this.isMouseDown) return;

        if (this.isSwiping) {
            const deltaX = this.touchEndX - this.touchStartX;
            const deltaY = Math.abs(this.touchEndY - this.touchStartY);
            const deltaTime = Date.now() - this.touchStartTime;
            const velocity = Math.abs(deltaX) / deltaTime;

            if (
                Math.abs(deltaX) > this.minSwipeDistance &&
                deltaY < this.maxVerticalMovement &&
                velocity > this.swipeVelocityThreshold
            ) {
                this.handleSwipe(deltaX);
            }
        }

        this.isMouseDown = false;
        this.resetSwipe();
    }

    /**
     * Handle swipe gesture
     */
    handleSwipe(deltaX) {
        if (deltaX > 0) {
            // Swipe right - previous track
            console.log('[GestureController] Swipe right - previous track');
            this.triggerCallback('onSwipeRight');
            this.showSwipeSuccess('left');
        } else {
            // Swipe left - next track
            console.log('[GestureController] Swipe left - next track');
            this.triggerCallback('onSwipeLeft');
            this.showSwipeSuccess('right');
        }
    }

    /**
     * Update swipe indicator position
     */
    updateSwipeIndicator(deltaX) {
        if (!this.swipeIndicator) return;

        const opacity = Math.min(Math.abs(deltaX) / this.minSwipeDistance, 1);

        if (deltaX > 0) {
            // Swiping right - show left icon (previous)
            this.swipeIndicator.classList.add('visible', 'left-active');
            this.swipeIndicator.classList.remove('right-active');
        } else {
            // Swiping left - show right icon (next)
            this.swipeIndicator.classList.add('visible', 'right-active');
            this.swipeIndicator.classList.remove('left-active');
        }

        this.swipeIndicator.style.opacity = opacity;
    }

    /**
     * Show swipe success animation
     */
    showSwipeSuccess(direction) {
        if (!this.swipeIndicator) return;

        this.swipeIndicator.classList.add('success', `${direction}-success`);

        setTimeout(() => {
            this.hideSwipeIndicator();
            this.swipeIndicator.classList.remove('success', `${direction}-success`);
        }, 300);
    }

    /**
     * Hide swipe indicator
     */
    hideSwipeIndicator() {
        if (!this.swipeIndicator) return;

        this.swipeIndicator.classList.remove('visible', 'left-active', 'right-active');
        this.swipeIndicator.style.opacity = '0';
    }

    /**
     * Reset swipe state
     */
    resetSwipe() {
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchEndX = 0;
        this.touchEndY = 0;
        this.isSwiping = false;
        this.hideSwipeIndicator();
    }

    /**
     * Trigger callback
     */
    triggerCallback(name) {
        if (this.callbacks[name] && typeof this.callbacks[name] === 'function') {
            this.callbacks[name]();
        }
    }

    /**
     * Update callbacks
     */
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Destroy gesture controller
     */
    destroy() {
        if (this.element) {
            // Remove event listeners
            this.element.removeEventListener('touchstart', this.handleTouchStart);
            this.element.removeEventListener('touchmove', this.handleTouchMove);
            this.element.removeEventListener('touchend', this.handleTouchEnd);
            this.element.removeEventListener('mousedown', this.handleMouseDown);
            this.element.removeEventListener('mousemove', this.handleMouseMove);
            this.element.removeEventListener('mouseup', this.handleMouseUp);
        }

        // Remove indicator
        if (this.swipeIndicator && this.swipeIndicator.parentNode) {
            this.swipeIndicator.parentNode.removeChild(this.swipeIndicator);
        }

        console.log('[GestureController] Destroyed');
    }
}
