import { TRANSITION_LAYERS } from './transition-layer-constants.js';

const ORB_PORTAL_COMPOSITOR_KEYFRAMES_ID = 'odyssey-orb-portal-compositor-keyframes';

function toCssColor(value, alpha = 1) {
    if (value && typeof value === 'object' && typeof value.getHexString === 'function') {
        const hex = value.getHexString();
        const int = parseInt(hex, 16);
        const r = (int >> 16) & 255;
        const g = (int >> 8) & 255;
        const b = int & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        const int = value >>> 0;
        const r = (int >> 16) & 255;
        const g = (int >> 8) & 255;
        const b = int & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    if (typeof value === 'string' && value.startsWith('#')) {
        const normalized = value.length === 4
            ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
            : value;
        const int = parseInt(normalized.slice(1), 16);
        if (Number.isFinite(int)) {
            const r = (int >> 16) & 255;
            const g = (int >> 8) & 255;
            const b = int & 255;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
    }

    return `rgba(255, 255, 255, ${alpha})`;
}

/**
 * Dedicated compositor for Odyssey orb-portal transitions.
 * Layer stack: boardSnapshot -> orbLockBridge -> warp -> arrivalFlash -> arrivalSilhouette -> revealMask
 */
export class OrbPortalCompositor {
    constructor() {
        this.root = null;
        this.snapshotLayer = null;
        this.orbLockLayer = null;
        this.arrivalFlash = null;
        this.arrivalSilhouette = null;
        this.revealMask = null;
        this.warpContainer = null;
        this.warpOriginalParent = null;
        this.hasSnapshot = false;
        this.coverageMode = 'live';
        this.arrivalHoldAnimationId = null;
        this.revealAnimationId = null;
        this.arrivalHoldBaseIntensity = 0;
        this.arrivalSilhouetteBaseIntensity = 0;
        this.arrivalPalette = {
            primary: '#dfefff',
            accent: '#8ec9ff',
            shadow: '#1d4f87',
        };
        this.portalAnchor = { x: 0.5, y: 0.5, radius: 0.18 };
    }

    init() {
        if (this.root) return;
        this.ensureKeyframes();

        const root = document.createElement('div');
        root.id = 'odyssey-orb-portal-compositor';
        root.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            opacity: 0;
            z-index: ${TRANSITION_LAYERS.COMPOSITOR_ROOT};
            transition: opacity 120ms linear;
            overflow: hidden;
        `;

        const snapshotLayer = document.createElement('div');
        snapshotLayer.style.cssText = `
            position: absolute;
            inset: 0;
            z-index: ${TRANSITION_LAYERS.BOARD_SNAPSHOT};
            background: #000;
            overflow: hidden;
        `;

        const orbLockLayer = document.createElement('div');
        orbLockLayer.style.cssText = `
            position: absolute;
            inset: 0;
            z-index: ${TRANSITION_LAYERS.ORB_LOCK_BRIDGE};
            opacity: 0;
            pointer-events: none;
            transition: opacity 120ms ease-out;
            background: radial-gradient(
                circle at var(--orb-portal-x) var(--orb-portal-y),
                rgba(255,255,255,0.00) 0%,
                rgba(200,235,255,0.16) calc(var(--orb-portal-radius) * 1.2),
                rgba(95,175,255,0.42) calc(var(--orb-portal-radius) * 2.0),
                rgba(20,45,92,0.72) calc(var(--orb-portal-radius) * 3.1),
                rgba(5,10,20,0.88) 100%
            );
            mix-blend-mode: screen;
            filter: saturate(125%);
        `;

        const arrivalFlash = document.createElement('div');
        arrivalFlash.style.cssText = `
            position: absolute;
            inset: 0;
            z-index: ${TRANSITION_LAYERS.ARRIVAL_FLASH};
            background: radial-gradient(
                circle at 50% 50%,
                rgba(255,255,255,1) 0%,
                rgba(255,255,255,0.98) 55%,
                rgba(245,245,255,0.96) 100%
            );
            opacity: 0;
            transition: opacity 180ms ease-out;
        `;

        const arrivalSilhouette = document.createElement('div');
        arrivalSilhouette.style.cssText = `
            position: absolute;
            inset: -6%;
            z-index: ${TRANSITION_LAYERS.ARRIVAL_SILHOUETTE};
            opacity: 0;
            mix-blend-mode: screen;
            filter: blur(18px) saturate(140%);
            transform: scale(1.04);
            transform-origin: center center;
            transition: opacity 180ms ease-out;
            pointer-events: none;
        `;

        const revealMask = document.createElement('div');
        revealMask.style.cssText = `
            position: absolute;
            inset: 0;
            z-index: ${TRANSITION_LAYERS.REVEAL_MASK};
            background: #fff;
            opacity: 0;
            transition: opacity 180ms ease-out;
            mix-blend-mode: screen;
        `;

        root.appendChild(snapshotLayer);
        root.appendChild(orbLockLayer);
        root.appendChild(arrivalFlash);
        root.appendChild(arrivalSilhouette);
        root.appendChild(revealMask);
        document.body.appendChild(root);

        this.root = root;
        this.snapshotLayer = snapshotLayer;
        this.orbLockLayer = orbLockLayer;
        this.arrivalFlash = arrivalFlash;
        this.arrivalSilhouette = arrivalSilhouette;
        this.revealMask = revealMask;

        this._applyPortalAnchor();
    }

    ensureKeyframes() {
        if (document.getElementById(ORB_PORTAL_COMPOSITOR_KEYFRAMES_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = ORB_PORTAL_COMPOSITOR_KEYFRAMES_ID;
        style.textContent = `
            @keyframes orb-lock-pulse {
                0% { opacity: 0.0; filter: blur(18px) saturate(120%); }
                20% { opacity: 1.0; filter: blur(2px) saturate(180%) brightness(1.3); }
                100% { opacity: 0.65; filter: blur(4px) saturate(140%); }
            }
            @keyframes orb-lock-ripple {
                0% { transform: scale(1.0); }
                25% { transform: scale(0.95); }
                50% { transform: scale(1.12); }
                100% { transform: scale(1.0); }
            }
        `;

        document.head.appendChild(style);
    }

    show(options = {}) {
        const { allowWithoutSnapshot = false } = options;
        this.init();

        if (!this.hasSnapshot && !allowWithoutSnapshot) {
            console.warn('[OrbPortalCompositor] show() called without snapshot; refusing to expose compositor');
            return false;
        }

        this.root.style.opacity = '1';
        return true;
    }

    /**
     * Atomically present compositor with a frozen board snapshot at the breach point.
     * @param {HTMLCanvasElement|null} snapshotCanvas
     * @param {{x:number,y:number,radius:number}} portalAnchor
     * @returns {boolean}
     */
    showWithSnapshot(snapshotCanvas, portalAnchor = null) {
        this.init();

        if (!snapshotCanvas || typeof snapshotCanvas.toDataURL !== 'function') {
            console.warn('[OrbPortalCompositor] Missing snapshot canvas at breach; compositor will stay hidden');
            return false;
        }

        if (portalAnchor) {
            this.setPortalAnchor(portalAnchor);
        }
        this.hideLiveOrbLock(80);
        this.setCoverageMode('frozen');
        this.setBoardSnapshot(snapshotCanvas);

        // Add a punchy flash to the snapshot on breach
        if (this.snapshotLayer) {
            this.snapshotLayer.style.filter = 'brightness(2.8) saturate(1.8) contrast(1.3)';
            this.snapshotLayer.style.transform = 'scale(1.03)';
            this.snapshotLayer.style.transition = 'none';

            // Fade it back to normal
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (this.snapshotLayer) {
                        this.snapshotLayer.style.transition = 'filter 500ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 500ms ease-out';
                        this.snapshotLayer.style.filter = 'brightness(1) saturate(1) contrast(1)';
                        this.snapshotLayer.style.transform = 'scale(1.0)';
                    }
                });
            });
        }

        this.root.style.opacity = '1';
        return true;
    }

    showLiveOrbLock(portalAnchor = null, durationMs = 800) {
        this.init();
        if (portalAnchor) {
            this.setPortalAnchor(portalAnchor);
        }
        this.setCoverageMode('live');
        this.setArrivalFlash(0);
        this.setRevealMask(0);
        this.show({ allowWithoutSnapshot: true });

        if (this.orbLockLayer) {
            this.orbLockLayer.style.animation = 'none';

            // Programmatic vignette sync perfectly with camera/squish duration
            const startTime = performance.now();
            const tick = (now) => {
                const t = Math.min(1, Math.max(0, (now - startTime) / durationMs));
                const ease = t * t * t; // deep cubic ease in
                this.orbLockLayer.style.opacity = String(ease);

                if (t < 1) {
                    requestAnimationFrame(tick);
                }
            };
            requestAnimationFrame(tick);
        }
    }

    hideLiveOrbLock(fadeMs = 120) {
        if (!this.orbLockLayer) return;
        this.orbLockLayer.style.transition = `opacity ${fadeMs}ms ease-out`;
        this.orbLockLayer.style.opacity = '0';
        setTimeout(() => {
            if (this.orbLockLayer) {
                this.orbLockLayer.style.animation = 'none';
                this.orbLockLayer.style.transition = 'opacity 120ms ease-out';
            }
        }, fadeMs + 20);
    }

    hide(durationMs = 200) {
        if (!this.root) return Promise.resolve();

        this.root.style.transition = `opacity ${durationMs}ms ease-out`;
        this.root.style.opacity = '0';

        return new Promise((resolve) => {
            setTimeout(() => {
                if (this.root) {
                    this.root.style.transition = 'opacity 120ms linear';
                }
                resolve();
            }, durationMs + 20);
        });
    }

    setBoardSnapshot(canvas) {
        if (!this.snapshotLayer) return;
        this.snapshotLayer.innerHTML = '';
        this.hasSnapshot = false;

        if (!canvas) {
            this.snapshotLayer.style.background = '#000';
            return;
        }

        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.alt = '';
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';
        this.snapshotLayer.appendChild(img);
        this.hasSnapshot = true;
    }

    /**
     * Select whether compositor coverage should use a frozen snapshot or live passthrough semantics.
     * Current implementation owns a frozen snapshot layer and keeps the API explicit for future expansion.
     * @param {'live'|'frozen'} mode
     */
    setCoverageMode(mode = 'frozen') {
        if (mode !== 'live' && mode !== 'frozen') {
            console.warn('[OrbPortalCompositor] Invalid coverage mode:', mode);
            return;
        }

        this.coverageMode = mode;

        if (this.snapshotLayer) {
            this.snapshotLayer.style.opacity = mode === 'frozen' ? '1' : '0';
        }
    }

    setArrivalFlash(intensity) {
        if (!this.arrivalFlash) return;
        const clamped = Math.max(0, Math.min(1, intensity));
        this.arrivalHoldBaseIntensity = clamped;
        this.arrivalFlash.style.opacity = String(clamped);
    }

    setArrivalSilhouette(intensity) {
        if (!this.arrivalSilhouette) return;
        const clamped = Math.max(0, Math.min(1, intensity));
        this.arrivalSilhouetteBaseIntensity = clamped;
        this.arrivalSilhouette.style.opacity = String(clamped);
    }

    setArrivalPalette(palette = {}) {
        this.arrivalPalette = {
            primary: palette.primary ?? palette.chapterColor ?? this.arrivalPalette.primary,
            accent: palette.accent ?? palette.accentColor ?? this.arrivalPalette.accent,
            shadow: palette.shadow ?? palette.shadowColor ?? this.arrivalPalette.shadow,
        };
        this._applyPortalAnchor();
    }

    setRevealMask(intensity) {
        if (!this.revealMask) return;
        const clamped = Math.max(0, Math.min(1, intensity));
        this.revealMask.style.opacity = String(clamped);
    }

    async playReveal(durationMs = 650) {
        if (!this.arrivalFlash || !this.revealMask) return;
        this.stopArrivalHoldAnimation();

        const startFlash = this.arrivalHoldBaseIntensity || Number(this.arrivalFlash.style.opacity || 0) || 0.82;
        const startSilhouette = this.arrivalSilhouetteBaseIntensity
            || Number(this.arrivalSilhouette?.style.opacity || 0)
            || 0.34;
        const baseHole = Math.max(this.portalAnchor.radius * 100 * 0.88, 5.4);

        await new Promise((resolve) => {
            const startTime = performance.now();
            const tick = (now) => {
                const t = Math.max(0, Math.min(1, (now - startTime) / durationMs));
                const eased = 1 - ((1 - t) ** 3);
                const flashOpacity = startFlash * Math.max(0, 1 - (eased ** 1.08));
                const silhouetteOpacity = startSilhouette * Math.max(0, 1 - (eased ** 0.92));
                const maskOpacity = Math.max(0, 0.24 * (1 - eased));
                const holeRadius = baseHole + ((eased ** 0.84) * 150);
                const feather = 7 + (eased * 26);

                this.arrivalFlash.style.opacity = String(flashOpacity);
                this.arrivalFlash.style.transform = `scale(${1.01 + (0.08 * eased)})`;
                if (this.arrivalSilhouette) {
                    this.arrivalSilhouette.style.opacity = String(silhouetteOpacity);
                    this.arrivalSilhouette.style.transform = `scale(${1.04 + (0.16 * eased)}) translate3d(0, 0, 0)`;
                }
                this._applyPortalRevealWindow({
                    holeRadiusPercent: holeRadius,
                    featherPercent: feather,
                    ringOpacity: maskOpacity,
                });

                if (t >= 1) {
                    this.revealAnimationId = null;
                    this.arrivalFlash.style.opacity = '0';
                    this.arrivalFlash.style.transform = '';
                    if (this.arrivalSilhouette) {
                        this.arrivalSilhouette.style.opacity = '0';
                        this.arrivalSilhouette.style.transform = '';
                    }
                    this.revealMask.style.opacity = '0';
                    this._clearPortalRevealWindow();
                    resolve();
                    return;
                }

                this.revealAnimationId = requestAnimationFrame(tick);
            };

            this.revealAnimationId = requestAnimationFrame(tick);
        });
    }

    startArrivalHoldAnimation() {
        if (!this.arrivalFlash || !this.revealMask || this.arrivalHoldAnimationId) return;

        const startTime = performance.now();
        const clamp255 = (value) => Math.max(0, Math.min(255, Math.round(value)));
        const tick = (now) => {
            if (!this.arrivalFlash || !this.revealMask) {
                this.arrivalHoldAnimationId = null;
                return;
            }

            const t = (now - startTime) / 1000;
            const breathe = 0.08 * Math.sin(t * 4.6);
            const shimmer = 0.045 * Math.sin(t * 11.7 + 0.7);
            const intensity = Math.max(0.68, Math.min(1, this.arrivalHoldBaseIntensity + breathe + shimmer));
            const mask = Math.max(0.09, Math.min(0.32, 0.2 + (0.06 * Math.sin(t * 3.7 + 1.3))));
            const silhouette = Math.max(
                0.18,
                Math.min(0.72, this.arrivalSilhouetteBaseIntensity + 0.08 + (0.11 * Math.sin(t * 2.8 + 0.9))),
            );
            const holeRadius = Math.max(4.6, (this.portalAnchor.radius * 100 * 0.76) + (Math.sin(t * 3.2 + 0.4) * 1.2));
            const feather = 7.5 + (Math.sin(t * 2.6 + 1.2) * 0.8);

            this.arrivalFlash.style.opacity = String(intensity);
            this.revealMask.style.opacity = String(mask);
            if (this.arrivalSilhouette) {
                this.arrivalSilhouette.style.opacity = String(silhouette);
            }

            const ringPulse = 1.0 + (0.03 * Math.sin(t * 4.4));
            this.arrivalFlash.style.transform = `scale(${ringPulse})`;
            const driftX = (this.portalAnchor.x * 100) + (Math.sin(t * 1.75) * 2.8);
            const driftY = (this.portalAnchor.y * 100) + (Math.cos(t * 1.35 + 0.8) * 2.1);
            const outerBlue = clamp255(190 + (Math.sin(t * 2.15 + 0.5) * 32));
            const midBlue = clamp255(220 + (Math.sin(t * 2.9 + 2.3) * 20));
            const midGreen = clamp255(235 + (Math.cos(t * 2.5 + 0.2) * 16));
            this.arrivalFlash.style.background = `radial-gradient(
                circle at ${driftX.toFixed(2)}% ${driftY.toFixed(2)}%,
                rgba(255,255,255,1) 0%,
                rgba(248,252,255,0.99) 22%,
                rgba(${midBlue},${midGreen},255,0.96) 55%,
                rgba(${outerBlue},218,255,0.86) 100%
            )`;
            if (this.arrivalSilhouette) {
                const silhouetteDriftX = (100 - driftX) + (Math.sin(t * 3.2) * 1.8);
                const silhouetteDriftY = (100 - driftY) + (Math.cos(t * 2.4) * 1.2);
                const primary = toCssColor(this.arrivalPalette.primary, 0.62);
                const accent = toCssColor(this.arrivalPalette.accent, 0.44);
                const rim = toCssColor(this.arrivalPalette.primary, 0.22);
                const shadow = toCssColor(this.arrivalPalette.shadow, 0.26);
                const beamAngle = 118 + (Math.sin(t * 1.4) * 18);
                this.arrivalSilhouette.style.transform = `scale(${1.04 + (0.03 * Math.sin(t * 2.1 + 0.2))}) translate3d(${(Math.sin(t * 1.2) * 0.8).toFixed(2)}%, ${(Math.cos(t * 1.5) * 0.6).toFixed(2)}%, 0)`;
                this.arrivalSilhouette.style.background = `
                    radial-gradient(circle at ${silhouetteDriftX.toFixed(2)}% ${silhouetteDriftY.toFixed(2)}%, ${primary} 0%, ${accent} 22%, rgba(255,255,255,0.04) 56%, rgba(0,0,0,0) 100%),
                    linear-gradient(${beamAngle.toFixed(2)}deg, rgba(255,255,255,0) 8%, ${accent} 36%, rgba(255,255,255,0) 70%),
                    radial-gradient(circle at ${driftX.toFixed(2)}% ${driftY.toFixed(2)}%, ${rim} 0%, rgba(255,255,255,0) 72%),
                    radial-gradient(circle at ${(100 - driftX).toFixed(2)}% ${(100 - driftY).toFixed(2)}%, ${shadow} 0%, rgba(0,0,0,0) 78%)
                `;
            }
            this.revealMask.style.background = `radial-gradient(
                circle at ${(100 - driftX).toFixed(2)}% ${(100 - driftY).toFixed(2)}%,
                rgba(255,255,255,0.95) 0%,
                rgba(226,238,255,0.88) 58%,
                rgba(174,206,250,0.76) 100%
            )`;
            this._applyPortalRevealWindow({
                holeRadiusPercent: holeRadius,
                featherPercent: feather,
                ringOpacity: mask,
            });

            this.arrivalHoldAnimationId = requestAnimationFrame(tick);
        };

        this.arrivalFlash.style.willChange = 'opacity, transform';
        if (this.arrivalSilhouette) {
            this.arrivalSilhouette.style.willChange = 'opacity, transform';
        }
        this.revealMask.style.willChange = 'opacity';
        this.arrivalHoldAnimationId = requestAnimationFrame(tick);
    }

    stopArrivalHoldAnimation() {
        if (this.arrivalHoldAnimationId) {
            cancelAnimationFrame(this.arrivalHoldAnimationId);
            this.arrivalHoldAnimationId = null;
        }
        if (this.revealAnimationId) {
            cancelAnimationFrame(this.revealAnimationId);
            this.revealAnimationId = null;
        }
        if (this.arrivalFlash) {
            this.arrivalFlash.style.willChange = '';
            this.arrivalFlash.style.transform = '';
            this.arrivalFlash.style.opacity = String(this.arrivalHoldBaseIntensity);
            this.arrivalFlash.style.background = '';
        }
        if (this.arrivalSilhouette) {
            this.arrivalSilhouette.style.willChange = '';
            this.arrivalSilhouette.style.transform = '';
            this.arrivalSilhouette.style.opacity = String(this.arrivalSilhouetteBaseIntensity);
            this.arrivalSilhouette.style.background = '';
        }
        if (this.revealMask) {
            this.revealMask.style.willChange = '';
            this.revealMask.style.background = '#fff';
        }
        this._clearPortalRevealWindow();
        this._applyPortalAnchor();
    }

    setPortalAnchor(anchor) {
        if (!anchor) return;

        const x = Number.isFinite(anchor.x) ? anchor.x : 0.5;
        const y = Number.isFinite(anchor.y) ? anchor.y : 0.5;
        const radius = Number.isFinite(anchor.radius) ? anchor.radius : 0.18;

        this.portalAnchor = {
            x: Math.max(0, Math.min(1, x)),
            y: Math.max(0, Math.min(1, y)),
            radius: Math.max(0.03, Math.min(0.8, radius)),
        };

        this._applyPortalAnchor();
    }

    attachWarpContainer(container) {
        if (!container) return;

        this.warpContainer = container;
        if (!this.warpOriginalParent && container.parentNode) {
            this.warpOriginalParent = container.parentNode;
        }

        if (this.root && container.parentNode !== this.root) {
            // Insert between snapshot and arrival flash layers.
            this.root.insertBefore(container, this.arrivalFlash || null);
        }

        container.style.position = 'absolute';
        container.style.inset = '0';
        container.style.pointerEvents = 'none';
        container.style.zIndex = String(TRANSITION_LAYERS.WARP_LAYER);
    }

    clear() {
        this.stopArrivalHoldAnimation();
        this.hideLiveOrbLock(80);
        this.setArrivalFlash(0);
        this.setArrivalSilhouette(0);
        this.setRevealMask(0);
        this.setCoverageMode('live');
        if (this.snapshotLayer) {
            this.snapshotLayer.innerHTML = '';
            this.snapshotLayer.style.background = '#000';
        }
        this.hasSnapshot = false;
    }

    dispose() {
        if (
            this.warpContainer
            && this.root
            && this.warpContainer.parentNode === this.root
            && this.warpOriginalParent
        ) {
            this.warpOriginalParent.appendChild(this.warpContainer);
        }

        if (this.root?.parentNode) {
            this.root.parentNode.removeChild(this.root);
        }
        this.root = null;
        this.snapshotLayer = null;
        this.orbLockLayer = null;
        this.arrivalFlash = null;
        this.arrivalSilhouette = null;
        this.revealMask = null;
        this.warpContainer = null;
        this.warpOriginalParent = null;
        this.hasSnapshot = false;
        this.coverageMode = 'live';
        this.arrivalHoldAnimationId = null;
        this.revealAnimationId = null;
        this.arrivalHoldBaseIntensity = 0;
        this.arrivalSilhouetteBaseIntensity = 0;
    }

    _applyPortalAnchor() {
        if (!this.root) return;

        this.root.style.setProperty('--orb-portal-x', `${this.portalAnchor.x * 100}%`);
        this.root.style.setProperty('--orb-portal-y', `${this.portalAnchor.y * 100}%`);
        this.root.style.setProperty('--orb-portal-radius', `${this.portalAnchor.radius * 100}%`);

        if (this.arrivalFlash) {
            this.arrivalFlash.style.background = `radial-gradient(
                circle at var(--orb-portal-x) var(--orb-portal-y),
                rgba(255,255,255,1) 0%,
                rgba(247,252,255,0.99) calc(var(--orb-portal-radius) * 1.35),
                rgba(228,242,255,0.95) calc(var(--orb-portal-radius) * 2.2),
                rgba(186,220,255,0.84) 100%
            )`;
        }
        if (this.arrivalSilhouette) {
            const primary = toCssColor(this.arrivalPalette.primary, 0.62);
            const accent = toCssColor(this.arrivalPalette.accent, 0.32);
            const shadow = toCssColor(this.arrivalPalette.shadow, 0.24);
            this.arrivalSilhouette.style.background = `
                radial-gradient(circle at var(--orb-portal-x) var(--orb-portal-y), ${primary} 0%, ${accent} calc(var(--orb-portal-radius) * 1.8), rgba(255,255,255,0.02) calc(var(--orb-portal-radius) * 3.4), rgba(0,0,0,0) 100%),
                linear-gradient(118deg, rgba(255,255,255,0) 14%, ${accent} 38%, rgba(255,255,255,0) 72%),
                radial-gradient(circle at calc(100% - var(--orb-portal-x)) calc(100% - var(--orb-portal-y)), ${shadow} 0%, rgba(0,0,0,0) 78%)
            `;
        }
        if (this.orbLockLayer) {
            this.orbLockLayer.style.setProperty(
                'background',
                `radial-gradient(
                    circle at var(--orb-portal-x) var(--orb-portal-y),
                    rgba(255,255,255,0.00) 0%,
                    rgba(200,235,255,0.16) calc(var(--orb-portal-radius) * 1.2),
                    rgba(95,175,255,0.42) calc(var(--orb-portal-radius) * 2.0),
                    rgba(20,45,92,0.72) calc(var(--orb-portal-radius) * 3.1),
                    rgba(5,10,20,0.88) 100%
                )`,
            );
        }
    }

    _applyPortalRevealWindow({
        holeRadiusPercent = 0,
        featherPercent = 8,
        ringOpacity = 0.18,
    } = {}) {
        const cX = parseFloat((this.portalAnchor.x * 100).toFixed(2));
        const cY = parseFloat((this.portalAnchor.y * 100).toFixed(2));
        const inner = Math.max(0, holeRadiusPercent);
        const outer = inner + Math.max(1, featherPercent);

        // Offset anchors for jagged plasma edges
        const j1x = cX + (Math.sin(inner * 0.15) * 3.5);
        const j1y = cY + (Math.cos(inner * 0.15) * 3.5);
        const j2x = cX + (Math.sin(inner * 0.22 + 2) * 2.8);
        const j2y = cY + (Math.cos(inner * 0.22 + 2) * 2.8);

        const maskImage = `
            radial-gradient(circle at ${cX.toFixed(2)}% ${cY.toFixed(2)}%, rgba(0,0,0,0) 0%, rgba(0,0,0,0) ${inner.toFixed(2)}%, rgba(0,0,0,0.4) ${(inner + featherPercent * 0.5).toFixed(2)}%, rgba(0,0,0,1) ${outer.toFixed(2)}%),
            radial-gradient(ellipse at ${j1x.toFixed(2)}% ${j1y.toFixed(2)}%, rgba(0,0,0,0) 0%, rgba(0,0,0,0) ${(inner * 0.92).toFixed(2)}%, rgba(0,0,0,0.5) ${(outer * 0.95).toFixed(2)}%, rgba(0,0,0,1) 100%),
            radial-gradient(ellipse at ${j2x.toFixed(2)}% ${j2y.toFixed(2)}%, rgba(0,0,0,0) 0%, rgba(0,0,0,0) ${(inner * 1.08).toFixed(2)}%, rgba(0,0,0,0.5) ${(outer * 1.05).toFixed(2)}%, rgba(0,0,0,1) 100%)
        `;

        [this.arrivalFlash, this.arrivalSilhouette].forEach((layer) => {
            if (!layer) return;
            layer.style.webkitMaskImage = maskImage;
            layer.style.maskImage = maskImage;
            layer.style.webkitMaskRepeat = 'no-repeat, no-repeat, no-repeat';
            layer.style.maskRepeat = 'no-repeat, no-repeat, no-repeat';
        });

        if (this.revealMask) {
            const primary = toCssColor(this.arrivalPalette.primary, Math.min(0.68, ringOpacity * 1.2));
            const accent = toCssColor(this.arrivalPalette.accent, Math.min(0.78, ringOpacity * 1.5));
            const rimInner = inner + (featherPercent * 0.25);
            this.revealMask.style.opacity = String(Math.max(0, ringOpacity));
            this.revealMask.style.background = `
                radial-gradient(circle at ${cX.toFixed(2)}% ${cY.toFixed(2)}%, rgba(255,255,255,0) 0%, rgba(255,255,255,0) ${inner.toFixed(2)}%, ${primary} ${rimInner.toFixed(2)}%, ${accent} ${outer.toFixed(2)}%, rgba(0,0,0,0) 100%),
                radial-gradient(ellipse at ${j1x.toFixed(2)}% ${j1y.toFixed(2)}%, rgba(255,255,255,0) ${(inner * 0.95).toFixed(2)}%, rgba(255,255,255,0.9) ${(rimInner * 0.98).toFixed(2)}%, ${accent} ${(outer * 0.95).toFixed(2)}%, rgba(0,0,0,0) 100%)
            `;
        }
    }

    _clearPortalRevealWindow() {
        [this.arrivalFlash, this.arrivalSilhouette].forEach((layer) => {
            if (!layer) return;
            layer.style.webkitMaskImage = '';
            layer.style.maskImage = '';
            layer.style.webkitMaskRepeat = '';
            layer.style.maskRepeat = '';
        });
    }
}

export default OrbPortalCompositor;
