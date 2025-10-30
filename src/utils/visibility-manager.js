/**
 * @fileoverview Visibility Manager - Efficient visibility detection using Intersection Observer
 * 
 * Use this instead of scroll event listeners for visibility detection.
 * Much more efficient than manually checking element.getBoundingClientRect().
 */

/**
 * Visibility Manager - Manages Intersection Observers for efficient visibility tracking
 * 
 * @example
 * const visibilityManager = new VisibilityManager();
 * 
 * // Watch when element becomes visible
 * visibilityManager.observe(element, (isVisible) => {
 *   if (isVisible) {
 *     console.log('Element is now visible!');
 *     // Start animations, load images, etc.
 *   } else {
 *     console.log('Element is hidden');
 *     // Pause animations, etc.
 *   }
 * });
 * 
 * // Cleanup when done
 * visibilityManager.cleanup();
 */
export class VisibilityManager {
    constructor(options = {}) {
        this.observers = [];
        this.defaultOptions = {
            threshold: options.threshold || 0.1, // 10% visible by default
            rootMargin: options.rootMargin || '0px',
            ...options
        };
    }

    /**
     * Observe an element's visibility
     * @param {HTMLElement} element - Element to observe
     * @param {Function} callback - Callback(isVisible, entry)
     * @param {Object} options - Optional IntersectionObserver options
     * @returns {IntersectionObserver} The observer instance
     */
    observe(element, callback, options = {}) {
        const observerOptions = {
            ...this.defaultOptions,
            ...options
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                callback(entry.isIntersecting, entry);
            });
        }, observerOptions);

        observer.observe(element);
        this.observers.push(observer);

        return observer;
    }

    /**
     * Observe multiple elements with the same callback
     * @param {HTMLElement[]} elements - Elements to observe
     * @param {Function} callback - Callback(element, isVisible, entry)
     * @param {Object} options - Optional IntersectionObserver options
     * @returns {IntersectionObserver} The observer instance
     */
    observeMany(elements, callback, options = {}) {
        const observerOptions = {
            ...this.defaultOptions,
            ...options
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                callback(entry.target, entry.isIntersecting, entry);
            });
        }, observerOptions);

        elements.forEach(element => observer.observe(element));
        this.observers.push(observer);

        return observer;
    }

    /**
     * Observe when element enters viewport (lazy loading use case)
     * Automatically stops observing after first intersection
     * @param {HTMLElement} element - Element to observe
     * @param {Function} callback - Callback called once when visible
     * @param {Object} options - Optional IntersectionObserver options
     */
    observeOnce(element, callback, options = {}) {
        const observerOptions = {
            ...this.defaultOptions,
            ...options
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    callback(entry);
                    observer.unobserve(element);
                    
                    // Remove from tracked observers
                    const index = this.observers.indexOf(observer);
                    if (index > -1) {
                        this.observers.splice(index, 1);
                    }
                    
                    observer.disconnect();
                }
            });
        }, observerOptions);

        observer.observe(element);
        this.observers.push(observer);

        return observer;
    }

    /**
     * Observe element with percentage visibility
     * Provides more granular visibility information
     * @param {HTMLElement} element - Element to observe
     * @param {Function} callback - Callback(percentVisible, entry)
     * @param {Object} options - Optional options
     * @returns {IntersectionObserver} The observer instance
     */
    observePercentage(element, callback, options = {}) {
        // Create multiple thresholds for granular tracking
        const thresholds = options.thresholds || [0, 0.25, 0.5, 0.75, 1.0];
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const percentVisible = Math.round(entry.intersectionRatio * 100);
                callback(percentVisible, entry);
            });
        }, {
            threshold: thresholds,
            rootMargin: options.rootMargin || '0px'
        });

        observer.observe(element);
        this.observers.push(observer);

        return observer;
    }

    /**
     * Cleanup - disconnect all observers
     */
    cleanup() {
        console.log(`[VisibilityManager] Disconnecting ${this.observers.length} observers`);
        
        this.observers.forEach(observer => {
            observer.disconnect();
        });
        
        this.observers = [];
        console.log('✅ [VisibilityManager] All observers disconnected');
    }

    /**
     * Get count of active observers
     * @returns {number} Number of active observers
     */
    getActiveCount() {
        return this.observers.length;
    }
}

/**
 * Lazy Load Manager - Specialized visibility manager for lazy loading images/content
 * 
 * @example
 * const lazyLoader = new LazyLoadManager();
 * 
 * // Lazy load images
 * document.querySelectorAll('img[data-src]').forEach(img => {
 *   lazyLoader.lazyLoadImage(img);
 * });
 */
export class LazyLoadManager extends VisibilityManager {
    constructor(options = {}) {
        super({
            threshold: 0,
            rootMargin: options.rootMargin || '50px', // Start loading 50px before visible
            ...options
        });
    }

    /**
     * Lazy load an image when it becomes visible
     * @param {HTMLImageElement} img - Image element with data-src attribute
     */
    lazyLoadImage(img) {
        if (!img.dataset.src) {
            console.warn('[LazyLoadManager] Image missing data-src attribute');
            return;
        }

        this.observeOnce(img, () => {
            console.log('[LazyLoadManager] Loading image:', img.dataset.src);
            
            img.src = img.dataset.src;
            
            if (img.dataset.srcset) {
                img.srcset = img.dataset.srcset;
            }
            
            img.classList.add('lazy-loaded');
            
            // Remove data attributes after loading
            delete img.dataset.src;
            delete img.dataset.srcset;
        });
    }

    /**
     * Lazy load multiple images
     * @param {NodeList|HTMLImageElement[]} images - Images to lazy load
     */
    lazyLoadImages(images) {
        images.forEach(img => this.lazyLoadImage(img));
    }

    /**
     * Lazy load element content (useful for heavy components)
     * @param {HTMLElement} element - Element with data-lazy-content attribute
     * @param {Function} loadCallback - Function to load content
     */
    lazyLoadElement(element, loadCallback) {
        this.observeOnce(element, () => {
            console.log('[LazyLoadManager] Loading element content');
            loadCallback(element);
            element.classList.add('lazy-loaded');
        });
    }
}

/**
 * Animation Trigger - Trigger animations when elements become visible
 * 
 * @example
 * const animTrigger = new AnimationTrigger();
 * 
 * // Trigger animation class when visible
 * animTrigger.triggerOnVisible(element, 'fade-in-animation');
 */
export class AnimationTrigger extends VisibilityManager {
    constructor(options = {}) {
        super({
            threshold: options.threshold || 0.2, // 20% visible to trigger
            ...options
        });
    }

    /**
     * Add class to element when it becomes visible
     * @param {HTMLElement} element - Element to animate
     * @param {string|string[]} classNames - Class(es) to add
     * @param {boolean} once - Only trigger once (default: true)
     */
    triggerOnVisible(element, classNames, once = true) {
        const classes = Array.isArray(classNames) ? classNames : [classNames];
        
        const observeMethod = once ? 'observeOnce' : 'observe';
        
        this[observeMethod](element, (isVisibleOrEntry) => {
            const isVisible = typeof isVisibleOrEntry === 'boolean' 
                ? isVisibleOrEntry 
                : isVisibleOrEntry.isIntersecting;
            
            if (isVisible) {
                classes.forEach(className => {
                    element.classList.add(className);
                });
                
                console.log(`[AnimationTrigger] Triggered animation: ${classes.join(', ')}`);
            } else if (!once) {
                // Remove classes when not visible (for repeating animations)
                classes.forEach(className => {
                    element.classList.remove(className);
                });
            }
        });
    }

    /**
     * Trigger animations for multiple elements
     * @param {NodeList|HTMLElement[]} elements - Elements to animate
     * @param {string|string[]} classNames - Class(es) to add
     * @param {boolean} once - Only trigger once per element
     */
    triggerManyOnVisible(elements, classNames, once = true) {
        elements.forEach(element => {
            this.triggerOnVisible(element, classNames, once);
        });
    }
}

/**
 * Global singleton instances for common use
 */
export const globalVisibilityManager = new VisibilityManager();
export const globalLazyLoader = new LazyLoadManager();
export const globalAnimationTrigger = new AnimationTrigger();

