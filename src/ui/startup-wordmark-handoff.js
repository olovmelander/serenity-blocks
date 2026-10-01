/**
 * Keep the loading wordmark visible while it grows into the live title's bounds.
 * Observe the untransformed wrapper so resizing never feeds an animated rect back
 * into its own destination. No per-frame layout reads are needed.
 */
export function connectStartupWordmark(titleContainer, durationMs) {
    const shell = document.getElementById('startup-shell');
    const origin = shell?.querySelector('.startup-logo__name');
    const wordmark = shell?.querySelector('.startup-logo__name-text');
    const title = titleContainer?.querySelector('.intro-title');
    if (!origin || !wordmark || !title) return () => {};

    const sync = () => {
        const from = origin.getBoundingClientRect?.();
        const to = title.getBoundingClientRect?.();
        if (!from?.width || !from?.height || !to?.width || !to?.height) return false;
        wordmark.style.setProperty('--sb-title-x', `${to.left + to.width / 2 - from.left - from.width / 2}px`);
        wordmark.style.setProperty('--sb-title-y', `${to.top + to.height / 2 - from.top - from.height / 2}px`);
        wordmark.style.setProperty('--sb-title-scale-x', String(to.width / from.width));
        wordmark.style.setProperty('--sb-title-scale-y', String(to.height / from.height));
        return true;
    };
    if (!sync()) return () => {};
    shell.style.setProperty('--sb-opening-duration', `${durationMs}ms`);
    titleContainer.style.setProperty('--sb-opening-duration', `${durationMs}ms`);
    titleContainer.classList.add('intro-title-connected');
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
    observer?.observe(origin);
    observer?.observe(title);
    let timer;
    const cleanup = () => {
        observer?.disconnect();
        clearTimeout(timer);
    };
    timer = setTimeout(cleanup, durationMs + 100);
    return cleanup;
}
