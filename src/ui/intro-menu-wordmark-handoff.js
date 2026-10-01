const FLIGHT_MS = 1150;
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

// Remove only the image's own pulse; keep its visual center and any ancestor pose.
function artworkBounds(image) {
    const rect = image.getBoundingClientRect();
    const transform = new DOMMatrixReadOnly(getComputedStyle(image).transform);
    const width = rect.width / (Math.hypot(transform.a, transform.b) || 1);
    const height = rect.height / (Math.hypot(transform.c, transform.d) || 1);
    return {
        left: rect.left + (rect.width - width) / 2,
        top: rect.top + (rect.height - height) / 2,
        width,
        height,
    };
}

function syncPulse(source, destination) {
    const pulse = source.getAnimations().find((animation) => animation.animationName === 'sb-wordmark-pulse');
    const target = destination.getAnimations().find((animation) => animation.animationName === 'sb-wordmark-pulse');
    if (!pulse || !target) return;
    const { duration, delay } = pulse.effect.getTiming();
    const phase = Math.max(0, Number(pulse.currentTime) - Number(delay)) % Number(duration);
    target.currentTime = Number(target.effect.getTiming().delay) + phase;
}

/**
 * Keep one visible wordmark while the menu lays out underneath it. Move only a
 * compositor transform, then hand the unchanged pulse phase to the real menu logo.
 * The target can be the desktop intro title or the compact/Electron DOM logo.
 */
export function beginIntroMenuWordmarkHandoff(titleContainer, { getTarget, onGeometryChange } = {}) {
    const source = titleContainer?.querySelector('.intro-wordmark');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!source?.animate || reducedMotion.matches) return null;
    const origin = artworkBounds(source);
    if (!origin.width || !origin.height) return null;

    const flight = document.createElement('div');
    flight.className = 'intro-menu-wordmark-flight';
    flight.ariaHidden = 'true';
    const image = source.cloneNode(false);
    image.className = 'intro-menu-wordmark-flight__image';
    flight.appendChild(image);
    const subtitle = titleContainer.querySelector('.intro-subtitle');
    if (subtitle) {
        const caption = subtitle.cloneNode(true);
        const style = getComputedStyle(subtitle);
        caption.className = 'intro-menu-wordmark-flight__caption';
        caption.style.font = style.font;
        caption.style.letterSpacing = style.letterSpacing;
        caption.style.wordSpacing = style.wordSpacing;
        caption.style.textIndent = style.textIndent;
        caption.style.color = style.color;
        caption.style.opacity = style.opacity;
        caption.style.top = `${subtitle.getBoundingClientRect().top - origin.top}px`;
        flight.appendChild(caption);
    }
    const place = (rect) => Object.assign(flight.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
    });
    place(origin);
    document.body.appendChild(flight);
    syncPulse(source, image);
    document.body.classList.add('intro-menu-handoff', 'intro-menu-revealed');

    let closed = false;
    let animation = null;
    let frame = null;
    let deadline;
    let target = null;
    let destination = null;
    let startedAt = null;
    let observer = null;

    const finish = () => {
        if (closed) return;
        closed = true;
        if (target?.isConnected) syncPulse(image, target);
        clearTimeout(deadline);
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', retarget);
        window.removeEventListener('modalShown', retarget);
        reducedMotion.removeEventListener('change', finish);
        observer?.disconnect();
        animation?.cancel();
        flight.remove();
        document.body.classList.remove('intro-menu-handoff');
        onGeometryChange?.();
    };

    function retarget() {
        if (closed) return;
        target = getTarget?.();
        if (!target?.isConnected || !target.offsetWidth) return;
        const to = artworkBounds(target);
        const unchanged = destination && ['left', 'top', 'width', 'height']
            .every((key) => Math.abs(to[key] - destination[key]) < 0.5);
        if (unchanged) {
            return;
        }
        const current = animation ? flight.getBoundingClientRect() : origin;
        const previous = animation;
        place(current);
        previous?.cancel();
        destination = to;
        const now = performance.now();
        if (startedAt === null) startedAt = now;
        const duration = Math.max(180, FLIGHT_MS - (now - startedAt));
        const translate = `translate3d(${to.left - current.left}px, ${to.top - current.top}px, 0)`;
        const scale = `scale(${to.width / current.width}, ${to.height / current.height})`;
        animation = flight.animate([
            { transform: 'translate3d(0, 0, 0) scale(1, 1)' },
            { transform: `${translate} ${scale}` },
        ], { duration, easing: EASING, fill: 'forwards' });
        const active = animation;
        active.finished.then(() => { if (animation === active && !closed) finish(); }).catch(() => {});
        clearTimeout(deadline);
        deadline = setTimeout(finish, duration + 300);
        onGeometryChange?.();
    }

    observer = typeof ResizeObserver === 'function' ? new ResizeObserver(retarget) : null;
    const cards = document.querySelector('.game-mode-cards-container');
    if (cards) observer?.observe(cards);
    window.addEventListener('resize', retarget, { passive: true });
    window.addEventListener('modalShown', retarget);
    reducedMotion.addEventListener('change', finish);
    // Wait for the real menu layout rather than guessing its future position.
    const waitForMenu = () => {
        if (closed) return;
        retarget();
        if (!animation) frame = requestAnimationFrame(waitForMenu);
    };
    deadline = setTimeout(finish, 2500);
    frame = requestAnimationFrame(waitForMenu);
    return { get element() { return closed ? null : flight; }, cancel: finish };
}
