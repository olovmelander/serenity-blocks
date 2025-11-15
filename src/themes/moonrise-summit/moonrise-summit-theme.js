import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class MoonriseSummitTheme extends BaseTheme {
    constructor() {
        super('moonrise-summit');
        this.eventUnsubscribers = [];
        this.stars = [];
        this.clouds = [];
        this.shootingStars = [];
        this.animationFrame = null;
    }

    async createScene() {
        console.log('[MoonriseSummit] Creating scene...');

        try {
            // Create background stars
            this.createStars();

            // Create mountains
            this.createMountains();

            // Create clouds
            this.createClouds();

            // Create shooting stars periodically
            this.startShootingStars();

            // Setup event listeners
            this.setupEventListeners();

            console.log('[MoonriseSummit] Scene created successfully!');
        } catch (error) {
            console.error('[MoonriseSummit] Error in createScene():', error);
            throw error;
        }
    }

    /**
     * Create background stars
     */
    createStars() {
        const starsContainer = document.getElementById('moonrise-stars');
        if (!starsContainer || starsContainer.children.length > 0) return;

        const fragment = document.createDocumentFragment();
        const starCount = 80;

        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'moonrise-star';
            const size = this.random(0.5, 1.8);
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${this.random(0, 100)}%`;
            star.style.top = `${this.random(0, 70)}%`; // Keep stars in upper portion
            star.style.opacity = `${this.random(0.4, 0.9).toFixed(2)}`;
            star.style.animationDelay = `${this.random(0, 6)}s`;
            fragment.appendChild(star);
            this.stars.push(star);
        }

        starsContainer.appendChild(fragment);
        this.registerContainer(starsContainer);
    }

    /**
     * Create mountain layers
     */
    createMountains() {
        // Mountains are created via CSS/HTML, but we can add dynamic elements
        const peaksContainer = document.getElementById('moonrise-peak-glow');
        if (!peaksContainer) return;

        // Add subtle glow points on mountain peaks
        const glowCount = 8;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < glowCount; i++) {
            const glow = document.createElement('div');
            glow.className = 'moonrise-peak-highlight';
            const leftPos = this.random(10, 90);
            glow.style.left = `${leftPos}%`;
            glow.style.animationDelay = `${this.random(0, 3)}s`;
            fragment.appendChild(glow);
        }

        peaksContainer.appendChild(fragment);
    }

    /**
     * Create clouds
     */
    createClouds() {
        const cloudsContainer = document.getElementById('moonrise-clouds');
        if (!cloudsContainer || cloudsContainer.children.length > 0) return;

        const cloudCount = 3;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < cloudCount; i++) {
            const cloud = document.createElement('div');
            cloud.className = 'moonrise-cloud';

            const width = this.random(80, 150);
            const height = this.random(30, 50);
            const topPos = this.random(20, 50);
            const leftPos = this.random(0, 80);
            const duration = this.random(60, 100);
            const delay = this.random(0, 20);

            cloud.style.width = `${width}px`;
            cloud.style.height = `${height}px`;
            cloud.style.top = `${topPos}%`;
            cloud.style.left = `${leftPos}%`;
            cloud.style.setProperty('--drift-duration', `${duration}s`);
            cloud.style.animationDelay = `${delay}s`;

            fragment.appendChild(cloud);
            this.clouds.push(cloud);
        }

        cloudsContainer.appendChild(fragment);
        this.registerContainer(cloudsContainer);
    }

    /**
     * Start periodic shooting stars
     */
    startShootingStars() {
        if (!this.isActive) return;

        const createShootingStar = () => {
            if (!this.isActive) return;

            const container = document.getElementById('moonrise-shooting-stars');
            if (!container) return;

            const star = document.createElement('div');
            star.className = 'moonrise-shooting-star';

            const startX = this.random(20, 80);
            const startY = this.random(10, 40);
            const angle = this.random(-50, -30);
            const duration = this.random(1.5, 2.5);

            star.style.left = `${startX}%`;
            star.style.top = `${startY}%`;
            star.style.setProperty('--shooting-angle', `${angle}deg`);
            star.style.animationDuration = `${duration}s`;

            container.appendChild(star);

            setTimeout(() => {
                if (star.parentNode) {
                    star.parentNode.removeChild(star);
                }
            }, duration * 1000);

            // Schedule next shooting star
            const nextDelay = this.random(8000, 20000);
            setTimeout(createShootingStar, nextDelay);
        };

        // Start first shooting star
        setTimeout(createShootingStar, this.random(3000, 8000));
    }

    /**
     * Setup event listeners
     */
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

    /**
     * React to line clears
     */
    onLineClear(lineCount) {
        console.log('[MoonriseSummit] Line clear:', lineCount);

        // Brighten moon
        this.brightenMoon(lineCount);

        // Create shooting stars
        this.createMultipleShootingStars(lineCount);

        // Brighten stars
        this.brightenStars(lineCount);

        // Pulse mountain glow
        this.pulseMountainGlow(lineCount);
    }

    /**
     * React to combos
     */
    onCombo(comboCount) {
        console.log('[MoonriseSummit] Combo:', comboCount);

        // Intensify moonlight
        this.intensifyMoonlight(comboCount);

        // Aurora effect for big combos
        if (comboCount >= 3) {
            this.createMoonAura(comboCount);
        }

        // Shift sky colors
        this.shiftSkyColors(comboCount);

        // Glow mountain outlines
        this.glowMountainOutlines(comboCount);
    }

    /**
     * React to piece locks
     */
    onPieceLock(piece) {
        // Subtle star twinkle
        if (Math.random() < 0.25) {
            this.twinkleStar();
        }
    }

    /**
     * Brighten moon
     */
    brightenMoon(intensity) {
        const moon = document.querySelector('.moonrise-moon');
        if (!moon) return;

        const originalFilter = moon.style.filter;
        moon.style.transition = 'filter 0.4s ease-out, transform 0.4s ease-out';
        moon.style.filter = `brightness(${1 + intensity * 0.15}) saturate(${100 + intensity * 10}%)`;
        moon.style.transform = `scale(${1 + intensity * 0.02})`;

        setTimeout(() => {
            moon.style.filter = originalFilter;
            moon.style.transform = '';
        }, 400);
    }

    /**
     * Create multiple shooting stars
     */
    createMultipleShootingStars(count) {
        const container = document.getElementById('moonrise-shooting-stars');
        if (!container) return;

        const starCount = Math.min(count, 3);

        for (let i = 0; i < starCount; i++) {
            setTimeout(() => {
                const star = document.createElement('div');
                star.className = 'moonrise-shooting-star';

                const startX = this.random(20, 80);
                const startY = this.random(10, 40);
                const angle = this.random(-50, -30);
                const duration = this.random(1.2, 2);

                star.style.left = `${startX}%`;
                star.style.top = `${startY}%`;
                star.style.setProperty('--shooting-angle', `${angle}deg`);
                star.style.animationDuration = `${duration}s`;

                container.appendChild(star);

                setTimeout(() => {
                    if (star.parentNode) {
                        star.parentNode.removeChild(star);
                    }
                }, duration * 1000);
            }, i * 200);
        }
    }

    /**
     * Brighten stars
     */
    brightenStars(intensity) {
        const starsToBrighten = Math.min(Math.floor(intensity * 6), this.stars.length);

        for (let i = 0; i < starsToBrighten; i++) {
            const star = this.stars[Math.floor(Math.random() * this.stars.length)];
            if (star) {
                const originalOpacity = star.style.opacity;
                star.style.transition = 'opacity 0.3s ease-out';
                star.style.opacity = '1';

                setTimeout(() => {
                    star.style.opacity = originalOpacity;
                }, 300 + Math.random() * 200);
            }
        }
    }

    /**
     * Pulse mountain glow
     */
    pulseMountainGlow(intensity) {
        const peaks = document.querySelectorAll('.moonrise-mountain-layer');
        peaks.forEach((peak, index) => {
            setTimeout(() => {
                peak.style.transition = 'filter 0.5s ease-out';
                peak.style.filter = `brightness(${1 + intensity * 0.2}) saturate(${100 + intensity * 15}%)`;

                setTimeout(() => {
                    peak.style.filter = '';
                }, 500);
            }, index * 100);
        });
    }

    /**
     * Intensify moonlight
     */
    intensifyMoonlight(comboCount) {
        const theme = document.getElementById('moonrise-summit-theme');
        if (!theme) return;

        const brightness = 100 + Math.min(comboCount * 10, 40);
        const saturation = 100 + Math.min(comboCount * 15, 50);

        theme.style.filter = `brightness(${brightness}%) saturate(${saturation}%)`;

        setTimeout(() => {
            theme.style.filter = '';
        }, 1000 + comboCount * 100);
    }

    /**
     * Create moon aura effect
     */
    createMoonAura(comboCount) {
        const auraContainer = document.getElementById('moonrise-moon-aura');
        if (!auraContainer) return;

        const aura = document.createElement('div');
        aura.className = 'moonrise-aura-pulse';

        // Reduced intensity for more subtle effect
        const intensity = Math.min((comboCount - 2) * 0.5, 1.5);
        aura.style.setProperty('--aura-intensity', intensity);

        auraContainer.appendChild(aura);

        setTimeout(() => {
            if (aura.parentNode) {
                aura.parentNode.removeChild(aura);
            }
        }, 2000);
    }

    /**
     * Shift sky colors
     */
    shiftSkyColors(comboCount) {
        const sky = document.getElementById('moonrise-sky');
        if (!sky) return;

        const hueShift = Math.min(comboCount * 5, 20);

        sky.style.transition = 'filter 0.8s ease-out';
        sky.style.filter = `hue-rotate(${hueShift}deg) saturate(110%)`;

        setTimeout(() => {
            sky.style.filter = '';
        }, 800 + comboCount * 100);
    }

    /**
     * Twinkle a random star
     */
    twinkleStar() {
        if (this.stars.length === 0) return;

        const star = this.stars[Math.floor(Math.random() * this.stars.length)];
        if (star) {
            const originalOpacity = star.style.opacity;
            star.style.transition = 'opacity 0.2s ease-in-out';
            star.style.opacity = '1';

            setTimeout(() => {
                star.style.opacity = originalOpacity;
            }, 200);
        }
    }

    /**
     * Glow mountain outlines during combos
     */
    glowMountainOutlines(comboCount) {
        console.log('[MoonriseSummit] Glowing mountain outlines for combo:', comboCount);

        const mountains = document.querySelectorAll('.moonrise-mountain-layer');
        if (!mountains.length) {
            console.warn('[MoonriseSummit] No mountains found!');
            return;
        }

        console.log('[MoonriseSummit] Found', mountains.length, 'mountains');

        // Calculate glow intensity based on combo count
        const glowOpacity = Math.min(0.15 + (comboCount * 0.02), 0.35);
        const blurAmount = 2 + (comboCount * 0.5);
        const strokeWidth = 0.2 + (comboCount * 0.08); // In viewBox units (0-100)

        mountains.forEach((mountain, index) => {
            setTimeout(() => {
                // Get the clip-path from the ::before pseudo-element
                const beforeStyle = window.getComputedStyle(mountain, '::before');
                const clipPath = beforeStyle.clipPath;

                // Parse the polygon points from clip-path
                const polygonMatch = clipPath.match(/polygon\(([^)]+)\)/);
                if (!polygonMatch) {
                    console.warn('[MoonriseSummit] Could not parse clip-path for mountain', index);
                    return;
                }

                // Create SVG for the outline
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('class', 'moonrise-mountain-outline-glow');
                svg.setAttribute('viewBox', '0 0 100 100');
                svg.setAttribute('preserveAspectRatio', 'none');
                svg.style.cssText = `
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.5s ease-out;
                    overflow: visible;
                `;

                // Parse polygon points and convert to SVG path
                const points = polygonMatch[1].trim();
                const coords = points.split(',').map(pair => {
                    const [x, y] = pair.trim().split(/\s+/);
                    return {
                        x: parseFloat(x),
                        y: parseFloat(y)
                    };
                });

                // Create path for the complete mountain outline (excluding only the bottom edge)
                let pathData = '';
                const bottomY = 100;

                // Filter out only the bottom edge points
                const outlinePoints = coords.filter(coord => coord.y !== bottomY);

                // Draw the complete mountain outline
                if (outlinePoints.length > 0) {
                    pathData = `M ${outlinePoints[0].x} ${outlinePoints[0].y} `;
                    for (let i = 1; i < outlinePoints.length; i++) {
                        pathData += `L ${outlinePoints[i].x} ${outlinePoints[i].y} `;
                    }
                }

                console.log('[MoonriseSummit] Path data:', pathData);

                // Create the path element with glow
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', pathData);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', `rgba(255, 200, 120, ${glowOpacity})`);
                path.setAttribute('stroke-width', strokeWidth);
                path.setAttribute('stroke-linecap', 'round');
                path.setAttribute('stroke-linejoin', 'round');

                // Create filter for glow effect
                const filterId = `mountain-glow-filter-${index}-${Date.now()}`;
                const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
                filter.setAttribute('id', filterId);
                filter.setAttribute('x', '-50%');
                filter.setAttribute('y', '-50%');
                filter.setAttribute('width', '200%');
                filter.setAttribute('height', '200%');

                // Multiple blur layers for intense glow
                const blur1 = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
                blur1.setAttribute('in', 'SourceGraphic');
                blur1.setAttribute('stdDeviation', blurAmount);
                blur1.setAttribute('result', 'blur1');

                const colorMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
                colorMatrix.setAttribute('in', 'blur1');
                colorMatrix.setAttribute('type', 'matrix');
                colorMatrix.setAttribute('values', `1 0 0 0 0  0 0.8 0 0 0  0 0 0.6 0 0  0 0 0 ${glowOpacity * 0.8} 0`);
                colorMatrix.setAttribute('result', 'coloredBlur');

                const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
                const mergeNode1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
                mergeNode1.setAttribute('in', 'coloredBlur');
                const mergeNode2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
                mergeNode2.setAttribute('in', 'coloredBlur');
                const mergeNode3 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
                mergeNode3.setAttribute('in', 'SourceGraphic');

                merge.appendChild(mergeNode1);
                merge.appendChild(mergeNode2);
                merge.appendChild(mergeNode3);

                filter.appendChild(blur1);
                filter.appendChild(colorMatrix);
                filter.appendChild(merge);

                svg.appendChild(filter);
                path.setAttribute('filter', `url(#${filterId})`);
                svg.appendChild(path);

                mountain.appendChild(svg);

                console.log('[MoonriseSummit] Created outline SVG for mountain', index);

                // Animate in
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        svg.style.opacity = '1';
                        console.log('[MoonriseSummit] Outline glow faded in for mountain', index);
                    });
                });

                // Reset after duration based on combo count
                const duration = 1000 + (comboCount * 200);
                setTimeout(() => {
                    svg.style.opacity = '0';

                    // Remove SVG after fade out
                    setTimeout(() => {
                        if (svg.parentNode) {
                            svg.parentNode.removeChild(svg);
                        }
                    }, 600);
                }, duration);
            }, index * 120); // Stagger the effect across mountains
        });
    }

    stop() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Clear arrays
        this.stars = [];
        this.clouds = [];
        this.shootingStars = [];

        // Clear any active effects
        const theme = document.getElementById('moonrise-summit-theme');
        if (theme) {
            theme.style.filter = '';
        }

        super.stop();
    }
}
