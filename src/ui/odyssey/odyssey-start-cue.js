/**
 * Odyssey's Ready → Go cue: the fair start of every orb.
 *
 * Its timings are part of the start contract (the first frame stays frozen until GO and fast
 * orbs get a longer Ready), so presentation only adds motion around them: the plate settles in,
 * GO lands with a ring of light, and an afterglow fades after control has already been handed
 * over. The afterglow is pointer-transparent and never delays the first live tick.
 * Styles: `.odyssey-start-cue` in public/styles/odyssey-flow.css.
 */
import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';

const CUE_ID = 'odyssey-level-start-cue';

/** Faster gravity earns a longer Ready; the GO beat is never longer than a drop. */
export function getOdysseyStartCueTimings(gameState) {
    const dropInterval = Number(gameState?.dropInterval);
    if (Number.isFinite(dropInterval) && dropInterval <= 500) {
        return { readyMs: 800, goMs: 280, dropInterval };
    }
    if (Number.isFinite(dropInterval) && dropInterval <= 799) {
        return { readyMs: 650, goMs: 240, dropInterval };
    }
    return { readyMs: 500, goMs: 200, dropInterval: Number.isFinite(dropInterval) ? dropInterval : null };
}

function reducedMotionFor(mode) {
    return prefersOdysseyReducedMotion(mode, mode.deps?.settingsManager?.get?.() || {});
}

function createCue(mode, levelConfig, gameState) {
    document.getElementById(CUE_ID)?.remove();
    const element = (tag, className) => {
        const node = document.createElement(tag);
        node.className = className;
        return node;
    };
    const cueState = {
        overlay: element('div', 'odyssey-start-cue'),
        panel: element('div', 'odyssey-start-cue__panel'),
        ring: element('div', 'odyssey-start-cue__ring'),
        label: element('div', 'odyssey-start-cue__label'),
        subtitle: element('div', 'odyssey-start-cue__subtitle'),
        timings: getOdysseyStartCueTimings(gameState),
        timers: new Set(),
        pendingSettlers: new Set(),
    };
    const { overlay } = cueState;
    overlay.id = CUE_ID;
    overlay.setAttribute('aria-live', 'assertive');
    overlay.setAttribute('role', 'status');
    overlay.dataset.phase = 'ready';
    overlay.dataset.reducedMotion = String(reducedMotionFor(mode));
    cueState.ring.setAttribute('aria-hidden', 'true');
    cueState.label.id = `${CUE_ID}-label`;
    cueState.label.textContent = 'READY';
    cueState.subtitle.id = `${CUE_ID}-subtitle`;
    cueState.subtitle.textContent = levelConfig?.name || 'Odyssey';
    cueState.panel.appendChild(cueState.ring);
    cueState.panel.appendChild(cueState.label);
    cueState.panel.appendChild(cueState.subtitle);
    overlay.appendChild(cueState.panel);
    document.body.appendChild(overlay);
    return cueState;
}

function setPhase(mode, cueState, phase) {
    if (!cueState?.label) return;
    const isGo = phase === 'go';
    cueState.overlay.dataset.phase = isGo ? 'go' : 'ready';
    cueState.label.textContent = isGo ? 'GO' : 'READY';
    cueState.subtitle.textContent = isGo ? 'Now' : (mode.currentLevelConfig?.name || 'Odyssey');
}

function waitForDelay(mode, cueState, delayMs) {
    return new Promise((resolve) => {
        let timerId = null;
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            cueState.pendingSettlers.delete(finish);
            if (timerId !== null) {
                clearTimeout(timerId);
                cueState.timers.delete(timerId);
            }
            resolve(value);
        };
        cueState.pendingSettlers.add(finish);
        timerId = setTimeout(() => finish(mode.levelStartCueState === cueState), delayMs);
        cueState.timers.add(timerId);
    });
}

/** GO lingers as light for a moment after play begins; it is never an input owner. */
function releaseAfterglow(cueState) {
    const { overlay } = cueState;
    if (overlay?.dataset?.reducedMotion === 'true' || typeof overlay?.animate !== 'function') return;
    const afterglow = overlay.cloneNode?.(true);
    if (!afterglow) return;
    afterglow.removeAttribute?.('id');
    afterglow.removeAttribute?.('role');
    afterglow.removeAttribute?.('aria-live');
    afterglow.querySelectorAll?.('[id]').forEach((node) => node.removeAttribute('id'));
    afterglow.classList.add('odyssey-start-cue--afterglow');
    afterglow.setAttribute('aria-hidden', 'true');
    afterglow.inert = true;
    document.body.appendChild(afterglow);
    const fade = afterglow.animate(
        [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.06)' }],
        { duration: 320, easing: 'cubic-bezier(0.3, 0, 0.8, 0.15)', fill: 'forwards' },
    );
    fade.onfinish = () => afterglow.remove();
    fade.oncancel = () => afterglow.remove();
}

export function clearOdysseyStartCue(mode, { resolveValue = false, afterglow = false } = {}) {
    const cueState = mode.levelStartCueState;
    if (!cueState) return;
    mode.levelStartCueState = null;
    cueState.timers.forEach((timerId) => clearTimeout(timerId));
    cueState.timers.clear();
    Array.from(cueState.pendingSettlers).forEach((settle) => settle(resolveValue));
    cueState.pendingSettlers.clear();
    if (afterglow) releaseAfterglow(cueState);
    cueState.overlay?.remove?.();
}

/** Resolves true only when the full Ready → Go sequence completed for this exact cue. */
export async function showOdysseyStartCue(mode, levelConfig, gameState) {
    if (!gameState) return false;
    clearOdysseyStartCue(mode, { resolveValue: false });
    const cueState = createCue(mode, levelConfig, gameState);
    mode.levelStartCueState = cueState;
    mode.entryPhase = 'countdown';
    mode.deps?.soundManager?.sfxPlayer?.playMove?.();

    const readyElapsed = await waitForDelay(mode, cueState, cueState.timings.readyMs);
    if (!readyElapsed || mode.levelStartCueState !== cueState) return false;
    setPhase(mode, cueState, 'go');
    mode.deps?.soundManager?.sfxPlayer?.playDrop?.();

    const goElapsed = await waitForDelay(mode, cueState, cueState.timings.goMs);
    if (!goElapsed || mode.levelStartCueState !== cueState) return false;
    clearOdysseyStartCue(mode, { resolveValue: true, afterglow: true });
    return true;
}
