/**
 * A breathing companion for the pause between Odyssey chapters.
 *
 * The rhythm is a cyclic sigh: a slow breath in, a short second breath to top the lungs up, then
 * a long, slow breath out. In a remote randomised trial (Balban et al. 2023, Cell Reports
 * Medicine), five daily minutes of this exhale-led breathing improved mood and slowed resting
 * breathing more than the same time of mindfulness meditation. Three breaths here are a rest, not
 * a treatment: the guide never gates Begin, never times out and keeps breathing for as long as the
 * player stays. Under reduced motion the light brightens and dims instead of growing.
 *
 * Pure timing (resolveChapterBreath) is separate from the view so tests resolve the same numbers.
 */
import { el } from './keystone-sheet.js';
import { easeBreath } from '../effects/breathing/breath-clock.js';
import { BreathworkChimes } from '../effects/breathwork-chimes.js';

/** [phase, seconds, lung fill at start, lung fill at end, spoken cue]. */
export const CHAPTER_BREATH = Object.freeze([
    Object.freeze({
        id: 'inhale', seconds: 4, from: 0, to: 0.78, cue: 'Breathe in',
    }),
    Object.freeze({
        id: 'top-up', seconds: 1.5, from: 0.78, to: 1, cue: 'A little more',
    }),
    Object.freeze({
        id: 'exhale', seconds: 7, from: 1, to: 0, cue: 'Let it all go',
    }),
    Object.freeze({
        id: 'rest', seconds: 1.5, from: 0, to: 0, cue: 'Rest',
    }),
]);
export const CHAPTER_BREATH_CYCLE_SECONDS = CHAPTER_BREATH.reduce((total, phase) => total + phase.seconds, 0);
export const GUIDED_BREATHS = 3;
const MAX_FRAME_SECONDS = 0.25;

/**
 * Where the guide is `elapsed` seconds after its first in-breath.
 * @returns {{breath: number, phase: string, phaseIndex: number, progress: number, level: number,
 *   cue: string, rested: boolean}}
 */
export function resolveChapterBreath(elapsed, guidedBreaths = GUIDED_BREATHS) {
    const time = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
    const cycle = Math.floor(time / CHAPTER_BREATH_CYCLE_SECONDS);
    let within = time - cycle * CHAPTER_BREATH_CYCLE_SECONDS;
    let phaseIndex = CHAPTER_BREATH.length - 1;
    for (let index = 0; index < CHAPTER_BREATH.length; index += 1) {
        if (within < CHAPTER_BREATH[index].seconds) {
            phaseIndex = index;
            break;
        }
        within -= CHAPTER_BREATH[index].seconds;
    }
    const phase = CHAPTER_BREATH[phaseIndex];
    const progress = Math.min(1, Math.max(0, within / phase.seconds));
    const level = phase.from + (phase.to - phase.from) * easeBreath(progress);
    return {
        breath: cycle + 1,
        phase: phase.id,
        phaseIndex,
        progress,
        level,
        cue: phase.cue,
        rested: cycle >= guidedBreaths,
    };
}

function countLabel(state, guidedBreaths) {
    return state.rested ? 'Stay as long as you like' : `Breath ${state.breath} of ${guidedBreaths}`;
}

/**
 * @param {{reducedMotion?: boolean, guidedBreaths?: number, chimes?: object|null,
 *   now?: () => number, onRested?: () => void}} [options]
 * @returns {HTMLElement & {start: () => void, pause: () => void, resume: () => void, dispose: () => void}}
 */
export function createChapterBreath({
    reducedMotion = false,
    guidedBreaths = GUIDED_BREATHS,
    chimes = new BreathworkChimes(),
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    onRested = () => {},
} = {}) {
    const root = el('section', 'ody-breath');
    root.role = 'group';
    root.ariaLabel = 'Breathing guide';
    root.dataset.reducedMotion = String(reducedMotion);
    root.dataset.phase = 'inhale';
    root.dataset.running = 'false';
    const orb = el('div', 'ody-breath__orb');
    orb.ariaHidden = 'true';
    ['track', 'glow', 'ring', 'core'].forEach((part) => orb.appendChild(el('span', `ody-breath__${part}`)));
    root.appendChild(orb);
    const cue = el('p', 'ody-breath__cue', CHAPTER_BREATH[0].cue);
    // A cue every few seconds would interrupt a screen reader; the guide is described once instead.
    cue.ariaLive = 'off';
    root.appendChild(cue);
    const count = el('p', 'ody-breath__count', `Breath 1 of ${guidedBreaths}`);
    root.appendChild(count);
    root.appendChild(el('p', 'ody-breath__hint', 'In through the nose, a little more, then a long breath out.'));

    let elapsed = 0;
    let lastTick = null;
    let frame = null;
    let timer = null;
    let running = false;
    let disposed = false;
    let lastPhase = null;
    let lastBreath = 0;
    let restedAnnounced = false;
    const raf = globalThis.window?.requestAnimationFrame?.bind(globalThis.window);
    const caf = globalThis.window?.cancelAnimationFrame?.bind(globalThis.window);

    const render = () => {
        const state = resolveChapterBreath(elapsed, guidedBreaths);
        root.style.setProperty('--breath', state.level.toFixed(3));
        if (state.phase !== lastPhase || state.breath !== lastBreath) {
            root.dataset.phase = state.phase;
            cue.textContent = state.rested && state.phase === 'rest' ? 'You’re ready' : state.cue;
            count.textContent = countLabel(state, guidedBreaths);
            if (state.phase === 'inhale' && state.breath === 1 && lastBreath === 0) chimes?.bell?.('start');
            lastPhase = state.phase;
            lastBreath = state.breath;
        }
        if (state.rested && !restedAnnounced) {
            restedAnnounced = true;
            root.dataset.rested = 'true';
            chimes?.bell?.('round');
            onRested();
        }
    };
    const schedule = () => {
        if (!running || disposed) return;
        if (raf) frame = raf(tick);
        else timer = setTimeout(() => tick(), 50);
    };
    function tick() {
        frame = null;
        timer = null;
        if (!running || disposed) return;
        const time = now();
        if (lastTick !== null) elapsed += Math.min(MAX_FRAME_SECONDS, Math.max(0, (time - lastTick) / 1000));
        lastTick = time;
        render();
        schedule();
    }
    const stopDriver = () => {
        if (frame !== null) caf?.(frame);
        if (timer !== null) clearTimeout(timer);
        frame = null;
        timer = null;
        lastTick = null;
    };

    root.start = () => {
        if (disposed || running) return;
        running = true;
        root.dataset.running = 'true';
        lastTick = now();
        render();
        schedule();
    };
    // A held presence (blur, hidden page, Pause) freezes the breath where it is.
    root.pause = () => {
        if (!running) return;
        running = false;
        root.dataset.running = 'false';
        stopDriver();
    };
    root.resume = () => root.start();
    root.dispose = () => {
        if (disposed) return;
        root.pause();
        disposed = true;
        chimes?.silence?.();
        root.remove?.();
    };
    root.getElapsed = () => elapsed;
    render();
    return root;
}
