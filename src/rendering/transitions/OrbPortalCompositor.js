import { TRANSITION_LAYERS } from './transition-layer-constants.js';

const ORB_PORTAL_COMPOSITOR_KEYFRAMES_ID = 'odyssey-orb-portal-compositor-keyframes';

/**
 * Dedicated compositor for Odyssey orb-portal transitions.
 * Layer stack: boardSnapshot -> warp -> arrivalFlash -> revealMask
 */
export class OrbPortalCompositor {
    constructor() {
        this.root = null;
        this.snapshotLayer = null;
        this.orbLockLayer = null;
        this.arrivalFlash = null;
        this.revealMask = null;
        this.warpContainer = null;
        this.warpOriginalParent = null;
        this.hasSnapshot = false;
        this.coverageMode = 'live';
        this.arrivalHoldAnimationId = null;
        this.arrivalHoldBaseIntensity = 0;
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
            z-index: ${TRANSITION_LAYERS.BOARD_SNAPSHOT};
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
        root.appendChild(revealMask);
        document.body.appendChild(root);

        this.root = root;
        this.snapshotLayer = snapshotLayer;
        this.orbLockLayer = orbLockLayer;
        this.arrivalFlash = arrivalFlash;
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
                0% { opacity: 0.0; filter: blur(10px) saturate(120%); }
                18% { opacity: 0.92; filter: blur(1.2px) saturate(150%); }
                100% { opacity: 0.48; filter: blur(0px) saturate(130%); }
            }
            @keyframes orb-lock-ripple {
                0% { transform: scale(1.12); }
                55% { transform: scale(1.00); }
                100% { transform: scale(1.04); }
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
        this.root.style.opacity = '1';
        return true;
    }

    showLiveOrbLock(portalAnchor = null) {
        this.init();
        if (portalAnchor) {
            this.setPortalAnchor(portalAnchor);
        }
        this.setCoverageMode('live');
        this.setArrivalFlash(0);
        this.setRevealMask(0);
        this.show({ allowWithoutSnapshot: true });
        if (this.orbLockLayer) {
            this.orbLockLayer.style.opacity = '1';
            this.orbLockLayer.style.animation = 'none';
            this.orbLockLayer.offsetHeight; // reflow restart
            this.orbLockLayer.style.animation = 'orb-lock-pulse 520ms cubic-bezier(0.2, 0.65, 0.16, 1), orb-lock-ripple 680ms ease-out infinite';
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

    setRevealMask(intensity) {
        if (!this.revealMask) return;
        const clamped = Math.max(0, Math.min(1, intensity));
        this.revealMask.style.opacity = String(clamped);
    }

    async playReveal(durationMs = 650) {
        if (!this.arrivalFlash || !this.revealMask) return;
        this.stopArrivalHoldAnimation();

        this.arrivalFlash.style.transition = `opacity ${durationMs}ms ease-out`;
        this.revealMask.style.transition = `opacity ${durationMs}ms ease-out`;

        this.arrivalFlash.style.opacity = '0';
        this.revealMask.style.opacity = '0';

        await new Promise((resolve) => {
            setTimeout(resolve, durationMs + 20);
        });

        this.arrivalFlash.style.transition = 'opacity 180ms ease-out';
        this.revealMask.style.transition = 'opacity 180ms ease-out';
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

            this.arrivalFlash.style.opacity = String(intensity);
            this.revealMask.style.opacity = String(mask);

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
            this.revealMask.style.background = `radial-gradient(
                circle at ${(100 - driftX).toFixed(2)}% ${(100 - driftY).toFixed(2)}%,
                rgba(255,255,255,0.95) 0%,
                rgba(226,238,255,0.88) 58%,
                rgba(174,206,250,0.76) 100%
            )`;

            this.arrivalHoldAnimationId = requestAnimationFrame(tick);
        };

        this.arrivalFlash.style.willChange = 'opacity, transform';
        this.revealMask.style.willChange = 'opacity';
        this.arrivalHoldAnimationId = requestAnimationFrame(tick);
    }

    stopArrivalHoldAnimation() {
        if (this.arrivalHoldAnimationId) {
            cancelAnimationFrame(this.arrivalHoldAnimationId);
            this.arrivalHoldAnimationId = null;
        }
        if (this.arrivalFlash) {
            this.arrivalFlash.style.willChange = '';
            this.arrivalFlash.style.transform = '';
            this.arrivalFlash.style.opacity = String(this.arrivalHoldBaseIntensity);
            this.arrivalFlash.style.background = '';
        }
        if (this.revealMask) {
            this.revealMask.style.willChange = '';
            this.revealMask.style.background = '#fff';
        }
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
        this.revealMask = null;
        this.warpContainer = null;
        this.warpOriginalParent = null;
        this.hasSnapshot = false;
        this.coverageMode = 'live';
        this.arrivalHoldAnimationId = null;
        this.arrivalHoldBaseIntensity = 0;
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
}

export default OrbPortalCompositor;
