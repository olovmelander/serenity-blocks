import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    showCinematicLoadingOverlay,
    dismissCinematicLoadingOverlay,
    setCinematicLoadingOverlayBuilding,
    waitForCinematicLoadingOverlayPresented,
    transitionCinematicLoadingOverlayToCountdown,
} from '../../src/ui/cinematic-loading-overlay.js';

function matchesSelector(element, selector) {
    if (selector === 'img') return element.tagName === 'IMG';
    if (selector.startsWith('#')) {
        return element.id === selector.slice(1);
    }

    const dataRoleMatch = selector.match(/^\[data-cinematic-role="([^"]+)"\]$/);
    if (dataRoleMatch) {
        return element.dataset.cinematicRole === dataRoleMatch[1];
    }

    return false;
}

function collectMatches(root, selector, results = []) {
    for (const child of root.children) {
        if (matchesSelector(child, selector)) {
            results.push(child);
        }

        collectMatches(child, selector, results);
    }

    return results;
}

function createDomHarness() {
    const elementsById = new Map();
    let documentRef = null;

    const registerTree = (node) => {
        if (node.id) {
            elementsById.set(node.id, node);
        }

        node.children.forEach((child) => registerTree(child));
    };

    const unregisterTree = (node) => {
        if (node.id) {
            elementsById.delete(node.id);
        }

        node.children.forEach((child) => unregisterTree(child));
    };

    const createElement = (tagName) => {
        const element = {
            tagName: tagName.toUpperCase(),
            ownerDocument: null,
            children: [],
            parentNode: null,
            style: {},
            dataset: {},
            className: '',
            id: '',
            textContent: '',
            appendChild(child) {
                if (child.parentNode) {
                    child.parentNode.removeChild(child);
                }

                child.parentNode = this;
                child.ownerDocument = documentRef;
                this.children.push(child);
                registerTree(child);
                return child;
            },
            insertBefore(child, referenceNode) {
                if (!referenceNode) {
                    return this.appendChild(child);
                }

                if (child.parentNode) {
                    child.parentNode.removeChild(child);
                }

                const index = this.children.indexOf(referenceNode);
                if (index === -1) {
                    return this.appendChild(child);
                }

                child.parentNode = this;
                child.ownerDocument = documentRef;
                this.children.splice(index, 0, child);
                registerTree(child);
                return child;
            },
            removeChild(child) {
                const index = this.children.indexOf(child);
                if (index >= 0) {
                    this.children.splice(index, 1);
                    unregisterTree(child);
                    child.parentNode = null;
                }
                return child;
            },
            remove() {
                this.parentNode?.removeChild?.(this);
            },
            querySelector(selector) {
                return collectMatches(this, selector)[0] || null;
            },
            querySelectorAll(selector) {
                return collectMatches(this, selector);
            },
        };

        Object.defineProperty(element, 'isConnected', {
            get() {
                return !!this.parentNode;
            },
        });

        return element;
    };

    const document = {
        createElement(tagName) {
            const element = createElement(tagName);
            element.ownerDocument = document;
            return element;
        },
        getElementById(id) {
            return elementsById.get(id) || null;
        },
        querySelector(selector) {
            return document.body.querySelector(selector) || document.head.querySelector(selector);
        },
        querySelectorAll(selector) {
            return [
                ...document.body.querySelectorAll(selector),
                ...document.head.querySelectorAll(selector),
            ];
        },
    };
    documentRef = document;

    document.body = createElement('body');
    document.body.ownerDocument = document;
    document.head = createElement('head');
    document.head.ownerDocument = document;

    const window = {
        document,
        setTimeout,
        clearTimeout,
    };

    return {
        document,
        window,
    };
}

function createAnimationFrameHarness() {
    const queue = [];

    return {
        raf: vi.fn((callback) => {
            queue.push(callback);
            return queue.length;
        }),
        flush(limit = 24) {
            let remaining = limit;

            while (queue.length > 0 && remaining > 0) {
                const callback = queue.shift();
                callback(0);
                remaining -= 1;
            }

            if (queue.length > 0) {
                throw new Error('Animation frame queue did not settle');
            }
        },
    };
}

function getCountdownNodes() {
    const overlay = document.getElementById('cinematic-loading-overlay');

    return {
        overlay,
        backdrop: overlay?.querySelector('[data-cinematic-role="backdrop"]') || null,
        layer: overlay?.querySelector('[data-cinematic-role="countdown-layer"]') || null,
        plate: overlay?.querySelector('[data-cinematic-role="countdown-plate"]') || null,
        text: overlay?.querySelector('[data-cinematic-role="countdown-text"]') || null,
    };
}

describe('cinematic loading overlay countdown', () => {
    let dom = null;
    let animationFrames = null;

    beforeEach(() => {
        vi.useFakeTimers();
        dom = createDomHarness();
        animationFrames = createAnimationFrameHarness();

        dom.window.requestAnimationFrame = animationFrames.raf;

        vi.stubGlobal('window', dom.window);
        vi.stubGlobal('document', dom.document);
        vi.stubGlobal('requestAnimationFrame', animationFrames.raf);
    });

    afterEach(() => {
        dom = null;
        animationFrames = null;
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('presents an opaque cover before allowing heavy mode setup to proceed', async () => {
        showCinematicLoadingOverlay('INFINITY');
        const overlay = document.getElementById('cinematic-loading-overlay');
        expect(overlay.style.opacity).toBe('1');
        expect(overlay.ariaLabel).toBe('Loading INFINITY');
        const ready = vi.fn();
        const presented = waitForCinematicLoadingOverlayPresented().then(ready);
        await vi.advanceTimersByTimeAsync(0);
        animationFrames.flush();
        expect(ready).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await presented;
        expect(ready).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('decodes new mode lettering before presenting its animation and allowing mode setup', async () => {
        showCinematicLoadingOverlay('SINGLE PLAYER');
        const lettering = document.querySelector('[data-cinematic-role="title"]').children[0];
        let finishDecode;
        lettering.decode = vi.fn(() => new Promise((resolve) => { finishDecode = resolve; }));
        const ready = vi.fn();
        const presented = waitForCinematicLoadingOverlayPresented().then(ready);
        await vi.advanceTimersByTimeAsync(100);
        expect(ready).not.toHaveBeenCalled();
        expect(animationFrames.raf).not.toHaveBeenCalled();
        finishDecode();
        await vi.advanceTimersByTimeAsync(0);
        animationFrames.flush();
        await vi.advanceTimersByTimeAsync(1);
        await presented;
        expect(ready).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds an unavailable image decode so loading can still finish', async () => {
        showCinematicLoadingOverlay('INFINITY');
        const lettering = document.querySelector('[data-cinematic-role="title"]').children[0];
        lettering.decode = vi.fn(() => new Promise(() => {}));
        const presented = waitForCinematicLoadingOverlayPresented();
        await vi.advanceTimersByTimeAsync(1000);
        await expect(presented).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('still presents the cover if an artwork resource fails to decode', async () => {
        showCinematicLoadingOverlay('INFINITY');
        const lettering = document.querySelector('[data-cinematic-role="title"]').children[0];
        lettering.decode = vi.fn(() => Promise.reject(new Error('missing image')));
        const presented = waitForCinematicLoadingOverlayPresented();
        await vi.advanceTimersByTimeAsync(0);
        animationFrames.flush();
        await vi.advanceTimersByTimeAsync(1);
        await expect(presented).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps loading feedback visible and running during a cold build', () => {
        showCinematicLoadingOverlay('SINGLE PLAYER');
        setCinematicLoadingOverlayBuilding(true);
        const overlay = document.getElementById('cinematic-loading-overlay');
        const dots = overlay.querySelector('[data-cinematic-role="dots"]');
        const title = overlay.querySelector('[data-cinematic-role="title"]');
        expect(overlay.dataset.building).toBe('true');
        expect(dots.style.opacity).not.toBe('0');
        expect(title.style.animationPlayState).not.toBe('paused');
        expect(dots.children[0].children).toHaveLength(5);
        setCinematicLoadingOverlayBuilding(false);
        expect(overlay.dataset.building).toBe('false');
    });

    it.each([
        ['SINGLE PLAYER', 'single-player', 'SINGLE PLAYER'],
        ['ONLINE MULTIPLAYER', 'multiplayer', 'MULTIPLAYER'],
        ['FREE-FOR-ALL', 'multiplayer', 'MULTIPLAYER'],
        ['INFINITY', 'infinity', 'INFINITY'],
        ['ODYSSEY', 'odyssey', 'ODYSSEY'],
        ['SERENITY', 'serenity', 'SERENITY'],
    ])('uses the mode name as the hero wordmark for %s', (title, asset, label) => {
        showCinematicLoadingOverlay(title);
        const heading = document.querySelector('[data-cinematic-role="title"]');
        expect(heading.children[0].src).toBe(`./assets/branding/modes/${asset}.svg`);
        expect(heading.children[0].alt).toBe(label);
    });

    it('does not hang when a backgrounded page stops presenting frames', async () => {
        showCinematicLoadingOverlay('ODYSSEY');
        const presented = waitForCinematicLoadingOverlayPresented();
        await vi.advanceTimersByTimeAsync(250);
        await expect(presented).resolves.toBeUndefined();
    });

    it('does not remove a newer cover when an older dismissal finishes', async () => {
        showCinematicLoadingOverlay('INFINITY');
        const dismiss = dismissCinematicLoadingOverlay({ minVisibleMs: 100, fadeOutMs: 20 });
        showCinematicLoadingOverlay('MULTIPLAYER');
        const replacement = document.getElementById('cinematic-loading-overlay');
        await vi.advanceTimersByTimeAsync(200);
        await dismiss;
        expect(document.getElementById('cinematic-loading-overlay')).toBe(replacement);
    });

    it('stops countdown callbacks when another loading screen replaces it', async () => {
        const onGo = vi.fn();
        const countdown = transitionCinematicLoadingOverlayToCountdown({
            startCount: 3, countIntervalMs: 100, onGo,
        });
        animationFrames.flush();
        showCinematicLoadingOverlay('SINGLE PLAYER');
        await vi.advanceTimersByTimeAsync(400);
        await countdown;
        expect(onGo).not.toHaveBeenCalled();
        expect(document.getElementById('cinematic-loading-overlay').ariaLabel).toBe('Loading SINGLE PLAYER');
    });

    it('creates a dedicated countdown plate and keeps the layer visible while active', async () => {
        const onCount = vi.fn();
        const onFirstCountVisible = vi.fn();

        const transitionPromise = transitionCinematicLoadingOverlayToCountdown({
            startCount: 5,
            countIntervalMs: 100,
            goHoldMs: 30,
            overlayFadeMs: 20,
            onCount,
            onFirstCountVisible,
        });

        animationFrames.flush();

        const {
            overlay,
            backdrop,
            layer,
            plate,
            text,
        } = getCountdownNodes();

        expect(overlay).toBeTruthy();
        expect(layer).toBeTruthy();
        expect(plate).toBeTruthy();
        expect(text).toBeTruthy();
        expect(layer.style.opacity).toBe('1');
        expect(text.textContent).toBe('5');
        expect(text.style.color).toBe('#ef4444');
        expect(text.style.webkitTextStroke).toContain('2.5px');
        expect(plate.style.backdropFilter).toContain('blur');
        expect(backdrop.style.opacity).toBe('0.84');
        expect(onFirstCountVisible).toHaveBeenCalledOnce();
        expect(onCount).toHaveBeenCalledWith(5);

        vi.advanceTimersByTime(100);

        expect(text.textContent).toBe('4');
        expect(layer.style.opacity).toBe('1');
        expect(overlay.isConnected).toBe(true);

        await vi.advanceTimersByTimeAsync(520);
        await transitionPromise;
    });

    it('applies per-count colors and transitions to GO before removing the overlay', async () => {
        const onGo = vi.fn();

        const transitionPromise = transitionCinematicLoadingOverlayToCountdown({
            startCount: 3,
            countIntervalMs: 100,
            goHoldMs: 40,
            overlayFadeMs: 20,
            onGo,
        });

        animationFrames.flush();

        const { text, plate } = getCountdownNodes();
        expect(text.textContent).toBe('3');
        expect(text.style.color).toBe('#ef4444');

        vi.advanceTimersByTime(100);
        expect(text.textContent).toBe('2');
        expect(text.style.color).toBe('#f59e0b');

        vi.advanceTimersByTime(100);
        expect(text.textContent).toBe('1');
        expect(text.style.color).toBe('#10b981');

        vi.advanceTimersByTime(100);
        expect(text.textContent).toBe('GO!');
        expect(text.style.color).toBe('#fbbf24');
        expect(plate.style.border).toContain('rgba(251, 191, 36');
        expect(onGo).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(120);
        await transitionPromise;

        expect(document.getElementById('cinematic-loading-overlay')).toBeNull();
    });
});
