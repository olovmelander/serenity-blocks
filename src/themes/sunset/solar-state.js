const CLAMP = (value, min, max) => Math.min(max, Math.max(min, value));

const STAGE_PRESETS = {
    night: {
        intensityMultiplier: 0.6,
        intensityOffset: 0.08,
        maxIntensity: 0.65,
        flareCap: 0.55,
        starAlpha: 1,
        starTwinkle: 1.35,
        nightVeil: 0.85,
        cirrus: 0.25,
        sunCoreAlpha: 0.35,
        skyDesaturate: 0.85,
        cloudHighlight: 0.18,
    },
    dawn: {
        intensityMultiplier: 0.8,
        intensityOffset: 0.05,
        maxIntensity: 0.75,
        flareCap: 0.7,
        starAlpha: 0.35,
        starTwinkle: 1.15,
        nightVeil: 0.5,
        cirrus: 0.28,
        sunCoreAlpha: 0.98, // Opaque to block stars
        skyDesaturate: 0.92,
        cloudHighlight: 0.28,
    },
    day: {
        intensityMultiplier: 0.95,
        intensityOffset: 0,
        maxIntensity: 0.82,
        flareCap: 0.78,
        starAlpha: 0.02,
        starTwinkle: 1,
        nightVeil: 0,
        cirrus: 0.22,
        sunCoreAlpha: 1.0, // Fully opaque
        skyDesaturate: 1,
        cloudHighlight: 0.34,
    },
    'golden-hour': {
        intensityMultiplier: 1,
        intensityOffset: 0.05,
        maxIntensity: 0.9,
        flareCap: 0.95,
        starAlpha: 0.25,
        starTwinkle: 1.05,
        nightVeil: 0.55,
        cirrus: 0.3,
        sunCoreAlpha: 0.98, // Opaque to block stars
        skyDesaturate: 0.96,
        cloudHighlight: 0.45,
    },
};

/**
 * Tracks the animated DOM sun and exposes normalized solar data for the Sunset theme.
 * Samples layout at ~30 FPS to keep the cost negligible while still reacting smoothly.
 */
export class SunsetSolarState {
    /**
     * @param {HTMLElement} sunElement
     * @param {HTMLElement} themeContainer
     */
    constructor({ sunElement, themeContainer, sampleInterval }) {
        this.sunElement = sunElement;
        this.themeContainer = themeContainer;
        this.listeners = new Set();
        this._rafId = null;
        this._active = false;
        this._lastSample = 0;
        // EXTREME PERFORMANCE: Absolute minimum update frequency for maximum FPS gain
        // Was: 33ms (30 FPS) → 100ms (10 FPS) → 150ms (~6-7 FPS) → 250ms (~4 FPS) → Now: 500ms (~2 FPS)
        const interval = Number.isFinite(sampleInterval) ? sampleInterval : 500;
        this._interval = Math.max(500, interval); // Minimum 2 FPS - dramatic reduction!
        this._state = {
            normalizedX: 0.5,
            normalizedY: 0.5,
            altitude: 0.5,
            intensity: 0.65,
            stage: 'day',
        };
        this._updateBound = this._update.bind(this);

        // Cache container dimensions to avoid repeated getBoundingClientRect calls
        this._cachedContainerRect = null;
        this._lastResizeCheck = 0;
        this._resizeCheckInterval = 1000; // Check for resize every 1000ms (was 500ms)

        // Track previous CSS values to avoid redundant updates
        this._previousCssState = {};

        // Add threshold for value changes to skip micro-updates
        this._updateThreshold = 0.005; // Skip updates smaller than 0.5%

        // Setup resize observer to invalidate cache
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => {
                this._cachedContainerRect = null;
            });
            this._resizeObserver.observe(this.themeContainer);
        }
    }

    /**
     * Start sampling the DOM sun position.
     */
    start() {
        if (this._active || !this.sunElement || !this.themeContainer) {
            return;
        }
        this._active = true;
        this._rafId = requestAnimationFrame(this._updateBound);
    }

    /**
     * Stop sampling and release RAF handle.
     */
    stop() {
        this._active = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    }

    /**
     * Register a listener that receives the solar state.
     * @param {(state: object) => void} callback
     * @returns {() => void} unsubscribe function
     */
    onUpdate(callback) {
        if (typeof callback !== 'function') return () => { };
        this.listeners.add(callback);
        // Immediately inform with current state for deterministic behavior
        callback({ ...this._state });
        return () => {
            this.listeners.delete(callback);
        };
    }

    /**
     * Compute derived solar stage based on altitude.
     * @param {number} altitude
     * @param {number} opacity
     * @returns {'night'|'dawn'|'day'|'golden-hour'}
     */
    resolveStage(altitude, opacity) {
        if (altitude < 0.15 || opacity < 0.05) return 'night';
        if (altitude < 0.35) return 'dawn';
        if (altitude < 0.7) return 'day';

        return 'golden-hour';
    }

    _update(now) {
        if (!this._active) return;
        if (now - this._lastSample < this._interval) {
            this._rafId = requestAnimationFrame(this._updateBound);
            return;
        }

        this._lastSample = now;

        if (!this.themeContainer.classList.contains('active')) {
            this._rafId = requestAnimationFrame(this._updateBound);
            return;
        }

        // Cache container rect to avoid repeated getBoundingClientRect calls
        if (!this._cachedContainerRect || now - this._lastResizeCheck > this._resizeCheckInterval) {
            this._cachedContainerRect = this.themeContainer.getBoundingClientRect();
            this._lastResizeCheck = now;
        }

        const themeRect = this._cachedContainerRect;

        if (themeRect.width === 0 || themeRect.height === 0) {
            this._rafId = requestAnimationFrame(this._updateBound);
            return;
        }

        // Only read sun position once per frame
        const sunRect = this.sunElement.getBoundingClientRect();

        const centerX = sunRect.left + sunRect.width / 2 - themeRect.left;
        const centerY = sunRect.top + sunRect.height / 2 - themeRect.top;
        const normalizedX = CLAMP(centerX / themeRect.width, 0, 1);
        const normalizedY = CLAMP(centerY / themeRect.height, 0, 1);
        const altitude = CLAMP(1 - normalizedY, 0, 1);

        // Skip update if values haven't changed significantly
        const altitudeChanged = Math.abs(altitude - this._state.altitude) > this._updateThreshold;
        const positionChanged = Math.abs(normalizedX - this._state.normalizedX) > this._updateThreshold
            || Math.abs(normalizedY - this._state.normalizedY) > this._updateThreshold;

        if (!altitudeChanged && !positionChanged && this._state.stage) {
            // No significant change, skip this update cycle
            this._rafId = requestAnimationFrame(this._updateBound);
            return;
        }

        const sunStyle = window.getComputedStyle(this.sunElement);
        const opacity = Number.parseFloat(sunStyle.opacity) || 0;
        const stage = this.resolveStage(altitude, opacity);
        const stagePreset = STAGE_PRESETS[stage] || STAGE_PRESETS.day;
        const baseIntensity = 0.25 + altitude * 0.5 + opacity * 0.25;
        const intensity = CLAMP(
            baseIntensity * stagePreset.intensityMultiplier + stagePreset.intensityOffset,
            0,
            stagePreset.maxIntensity,
        );

        const hueBase = stage === 'golden-hour'
            ? 32
            : stage === 'dawn'
                ? 18
                : stage === 'day'
                    ? 48
                    : 260;
        const hue = hueBase + (1 - altitude) * (stage === 'night' ? 40 : 22);

        this._state = {
            normalizedX,
            normalizedY,
            altitude,
            intensity,
            stage,
            hue,
        };

        this._applyCssVariables(this._state);

        this.listeners.forEach((listener) => {
            listener({ ...this._state });
        });

        this._rafId = requestAnimationFrame(this._updateBound);
    }

    _applyCssVariables(state) {
        const {
            normalizedX, normalizedY, altitude, intensity, hue, stage,
        } = state;
        const container = this.themeContainer;
        const stagePreset = STAGE_PRESETS[stage] || STAGE_PRESETS.day;
        const starAlpha = CLAMP(stagePreset.starAlpha * (1 - altitude * 0.5), 0, 1);
        const nightVeil = CLAMP(stagePreset.nightVeil * (1 - altitude * 0.4), 0, 1);
        const cirrus = CLAMP(stagePreset.cirrus, 0, 1);

        // ULTRA PERFORMANCE: Batch CSS updates - reduced to only essential variables
        const updates = {
            '--sunset-solar-x': `${(normalizedX * 100).toFixed(2)}%`,
            '--sunset-solar-y': `${(normalizedY * 100).toFixed(2)}%`,
            '--sunset-solar-altitude': altitude.toFixed(3),
            '--sunset-solar-intensity': intensity.toFixed(3),
            '--sunset-solar-hue': `${hue.toFixed(1)}deg`,
            '--sunset-god-ray-center-x': `${(normalizedX * 100).toFixed(2)}%`,
            '--sunset-god-ray-center-y': `${(normalizedY * 100).toFixed(2)}%`,
            '--sunset-ray-scale': (0.8 + altitude * 0.4).toFixed(3),
            '--sunset-ray-opacity': (intensity * 0.8).toFixed(3),
            '--sunset-cloud-warmth': `${(hue - 40).toFixed(1)}deg`,
            '--sunset-cloud-brightness': (0.8 + intensity * 0.4).toFixed(3),
            '--sunset-cloud-highlight': stagePreset.cloudHighlight.toFixed(3),
            '--sunset-heat-haze-strength': (altitude * 0.8).toFixed(3),
            '--sunset-noise-alpha': (0.1 + (1 - intensity) * 0.1).toFixed(3),
            '--sunset-star-alpha': starAlpha.toFixed(3),
            '--sunset-star-twinkle-speed': stagePreset.starTwinkle.toFixed(2),
            '--sunset-night-veil-alpha': nightVeil.toFixed(3),
            '--sunset-cirrus-opacity': cirrus.toFixed(3),
            '--sunset-sun-core-alpha': stagePreset.sunCoreAlpha.toFixed(3),
            '--sunset-sky-desaturate': stagePreset.skyDesaturate.toFixed(3),
            '--sunset-flare-cap': stagePreset.flareCap.toFixed(3),
        };

        // Only update changed values to minimize repaints
        for (const [property, value] of Object.entries(updates)) {
            if (this._previousCssState[property] !== value) {
                container.style.setProperty(property, value);
                this._previousCssState[property] = value;
            }
        }

        // Update dataset only if changed
        if (container.dataset.solarStage !== stage) {
            container.dataset.solarStage = stage;
        }
    }
}
