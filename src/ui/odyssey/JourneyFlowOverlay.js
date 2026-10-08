/* eslint-disable no-await-in-loop -- Presence changes restart the visible handoff fade. */
/**
 * A light DOM portal between Odyssey orbs. Gameplay, loading and progression stay
 * with the mode; this view owns only its input, brief celebration and cover.
 */
import { el } from './keystone-sheet.js';
import { getOdysseyLevelBriefing } from './odyssey-level-briefing.js';
import { createThemeUnlockReward } from './ThemeUnlockReward.js';

const AUTO_CONTINUE_MS = 2600;
const CHAPTER_COLORS = [
    '#f3ac77', '#8cd3ed', '#b5d4a2', '#c8d3f0',
    '#c8b2ed', '#b5a0ee', '#e6a9dd', '#f3b29d',
];

/**
 * @param {object} options
 * @returns {HTMLElement} Mount before calling cover(). dispose() cancels all waits.
 */
export function createJourneyFlowOverlay({
    variant = 'completion',
    level = null,
    nextLevel = null,
    chapter = null,
    results = null,
    autoContinue = true,
    reducedMotion = false,
    onChoose = () => {},
    onAutoContinueChange = () => {},
} = {}) {
    let transitActive = variant === 'transit';
    let presentationVariant = variant;
    let chooseHandler = onChoose;
    const modal = el('div', `ody-flow ody-flow--${variant}`);
    modal.id = 'odyssey-flow-overlay';
    modal.dataset.odysseyWheelLock = 'true';
    modal.dataset.variant = variant;
    modal.dataset.reducedMotion = String(reducedMotion);
    modal.role = 'dialog';
    modal.ariaModal = 'true';
    modal.visibilityGeneration = 0;
    modal.ariaLabel = variant === 'chapter' ? 'A new chapter' : 'Continue your Odyssey';
    const chapterId = chapter?.id || nextLevel?.chapter || level?.chapter || 1;
    modal.style.setProperty('--ody-flow-color', CHAPTER_COLORS[chapterId - 1] || CHAPTER_COLORS[0]);

    const portal = el('div', 'ody-flow__portal');
    portal.ariaHidden = 'true';
    ['halo', 'orbit', 'orbit ody-flow__orbit--inner', 'trail', 'trail ody-flow__trail--second'].forEach((part) => {
        portal.appendChild(el('span', `ody-flow__${part}`));
    });
    const core = el('span', 'ody-flow__core', String(nextLevel?.id || level?.id || '').padStart(2, '0'));
    portal.appendChild(core);
    modal.appendChild(portal);

    const content = el('section', 'ody-flow__content');
    const chapterCopy = [];
    const eyebrow = {
        chapter: `Chapter ${chapterId} · A new horizon`,
        transit: 'Your journey continues',
        completion: `Orb ${level?.id || ''} · Complete`,
    }[variant];
    const eyebrowNode = el('p', 'ody-flow__eyebrow', eyebrow);
    eyebrowNode.tabIndex = -1;
    content.appendChild(eyebrowNode);
    if (variant === 'completion' && Number.isFinite(results?.stars)) {
        const stars = Math.max(0, Math.min(3, Math.floor(results.stars)));
        const starRow = el('div', 'ody-flow__stars');
        starRow.role = 'img';
        starRow.ariaLabel = `${stars} of 3 stars earned`;
        for (let index = 0; index < 3; index += 1) {
            const star = el('span', index < stars ? 'is-earned' : '', '✦');
            star.ariaHidden = 'true';
            starRow.appendChild(star);
        }
        content.appendChild(starRow);
    }
    if (variant === 'completion') {
        const tally = [];
        if (Number.isFinite(results?.score)) tally.push(`${results.score.toLocaleString()} points`);
        if (Number.isFinite(results?.time) && results.time >= 0) {
            const seconds = Math.floor(results.time);
            tally.push(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
        }
        if (tally.length) content.appendChild(el('p', 'ody-flow__tally', tally.join(' · ')));
    }
    const themeReward = variant === 'completion'
        ? createThemeUnlockReward(results?.themeUnlock, { reducedMotion }) : null;
    if (themeReward) {
        modal.dataset.themeReward = 'true';
        content.appendChild(themeReward);
    }
    const title = variant === 'chapter' ? chapter?.name : nextLevel?.name;
    const titleNode = el('h2', 'ody-flow__title', title || 'The journey continues');
    titleNode.tabIndex = -1;
    content.appendChild(titleNode);
    if (chapter) {
        if (chapter?.subtitle) chapterCopy.push(el('p', 'ody-flow__subtitle', chapter.subtitle));
        if (chapter?.narrative?.intro) {
            chapterCopy.push(el('p', 'ody-flow__narrative', chapter.narrative.intro));
        }
        chapterCopy.forEach((node) => {
            node.hidden = variant !== 'chapter';
            content.appendChild(node);
        });
    }
    let destinationLabel = null;
    if (nextLevel) {
        const briefing = getOdysseyLevelBriefing(nextLevel, level);
        const destination = el('p', 'ody-flow__destination');
        const nextLabel = `Next · Orb ${nextLevel.id}${variant === 'chapter' ? ` · ${nextLevel.name}` : ''}`;
        destinationLabel = el('span', 'ody-flow__orb-label', nextLabel);
        destination.appendChild(destinationLabel);
        destination.appendChild(el('span', 'ody-flow__goal', briefing.goal));
        content.appendChild(destination);
        if (briefing.changes.length) {
            const changes = el('ul', 'ody-flow__changes');
            changes.ariaLabel = 'What changes next';
            briefing.changes.forEach((change) => changes.appendChild(el('li', '', change)));
            content.appendChild(changes);
        }
    }

    const status = el('p', 'ody-flow__status');
    status.role = 'status';
    status.ariaLive = 'polite';
    content.appendChild(status);
    const progress = el('div', 'ody-flow__progress');
    progress.ariaHidden = 'true';
    progress.appendChild(el('span', 'ody-flow__progress-fill'));
    content.appendChild(progress);

    const actions = el('div', 'ody-flow__actions');
    const primary = el(
        'button',
        'sb-btn sb-btn--primary ody-flow__primary',
        variant === 'chapter' ? 'Begin chapter' : 'Continue now',
    );
    primary.type = 'button';
    primary.dataset.flowAction = 'next';
    primary.hidden = variant === 'transit';
    const resume = el('button', 'sb-btn sb-btn--primary', 'Resume journey');
    resume.type = 'button';
    resume.dataset.flowAction = 'resume';
    resume.hidden = true;
    const pause = el('button', 'sb-btn ody-flow__quiet', 'Pause');
    pause.type = 'button';
    pause.dataset.flowAction = 'pause';
    pause.hidden = variant === 'chapter' || (variant === 'completion' && !autoContinue);
    const details = el('button', 'sb-btn ody-flow__quiet', 'Results');
    details.type = 'button';
    details.dataset.flowAction = 'details';
    details.hidden = variant !== 'completion';
    const map = el('button', 'sb-btn ody-flow__quiet', 'Map');
    map.type = 'button';
    map.dataset.flowAction = 'map';
    [primary, resume, pause, details, map].forEach((button) => actions.appendChild(button));
    content.appendChild(actions);

    let checkbox = null;
    let preference = null;
    if (variant === 'completion') {
        preference = el('label', 'ody-flow__preference');
        checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(autoContinue);
        preference.appendChild(checkbox);
        preference.appendChild(el('span', '', 'Flow to the next orb automatically'));
        content.appendChild(preference);
    }
    if (chapter || variant === 'chapter') {
        const breath = el('p', 'ody-flow__breath', 'Take a breath. Begin when you’re ready.');
        breath.hidden = variant !== 'chapter';
        content.appendChild(breath);
        chapterCopy.push(breath);
    }
    modal.appendChild(content);

    let disposed = false;
    let retained = false;
    let chosen = false;
    let held = false;
    let visibilityHeld = false;
    let scenicStage = null;
    let scenicReadingHeld = false;
    let autoTimer = null;
    const timers = new Set();
    const pending = new Set();
    const visibilityWaiters = new Set();
    const listeners = [];
    const isVisible = () => !document.hidden && document.hasFocus?.() !== false;
    const transitStatus = () => ({
        emerging: 'Returning to the journey…',
        travel: 'Following the path to your next orb…',
        entering: 'Entering your next orb…',
    }[scenicStage] || 'Preparing your next orb…');
    const listen = (target, type, handler, capture = false) => {
        target.addEventListener(type, handler, capture);
        listeners.push(() => target.removeEventListener(type, handler, capture));
    };
    const later = (callback, milliseconds) => {
        const timer = setTimeout(() => {
            timers.delete(timer);
            callback();
        }, milliseconds);
        timers.add(timer);
        return timer;
    };
    const wait = (milliseconds) => new Promise((resolve) => {
        if (disposed || retained) { resolve(false); return; }
        pending.add(resolve);
        later(() => { pending.delete(resolve); resolve(!disposed); }, milliseconds);
    });
    const stopAuto = () => {
        clearTimeout(autoTimer);
        timers.delete(autoTimer);
        autoTimer = null;
        modal.dataset.autoRunning = 'false';
        pause.disabled = !transitActive;
    };
    const hold = () => {
        if (disposed || chosen || transitActive) return;
        themeReward?.suppressCelebration?.();
        held = true;
        stopAuto();
        if (presentationVariant === 'completion') status.textContent = 'Paused. Continue when you’re ready.';
    };
    const holdForReading = () => {
        if (!autoTimer || transitActive || disposed || chosen) return;
        const bounds = pause.getBoundingClientRect?.();
        const height = window.innerHeight || document.documentElement?.clientHeight;
        if (bounds && height && (bounds.bottom > height - 8 || bounds.top < 0)) {
            hold();
            status.textContent = 'Paused to give you time to read. Continue when you’re ready.';
        }
    };
    const choose = (choice) => {
        if (disposed || chosen) return;
        if (choice === 'next' && (visibilityHeld || !isVisible())) {
            hold();
            return;
        }
        chosen = true;
        stopAuto();
        chooseHandler(choice);
    };
    const suspend = () => {
        if (disposed || retained) return;
        themeReward?.suppressCelebration?.();
        modal.visibilityGeneration += 1;
        hold();
        visibilityHeld = true;
        modal.inert = false;
        modal.dataset.visibilityHeld = 'true';
        resume.hidden = false;
        primary.hidden = true;
        pause.hidden = true;
        status.textContent = 'Journey paused. Resume when you’re ready.';
    };
    const resumeVisible = () => {
        if (disposed || !isVisible()) return;
        visibilityHeld = false;
        modal.dataset.visibilityHeld = 'false';
        modal.inert = modal.dataset.revealing === 'true';
        resume.hidden = true;
        primary.hidden = transitActive;
        pause.hidden = !transitActive && (presentationVariant !== 'completion' || !autoContinue);
        status.textContent = transitActive
            ? transitStatus() : 'Continue when you’re ready.';
        visibilityWaiters.forEach((resolve) => resolve(true));
        visibilityWaiters.clear();
        (transitActive ? pause : primary).focus({ preventScroll: presentationVariant !== 'chapter' });
    };
    const holdScenicForReading = () => {
        if (!scenicStage || scenicReadingHeld || disposed || retained
            || modal.dataset.revealing === 'true') return;
        const bounds = pause.getBoundingClientRect?.();
        const height = window.innerHeight || document.documentElement?.clientHeight;
        const controlClipped = bounds && height && (bounds.bottom > height - 8 || bounds.top < 0);
        const textClipped = content.clientHeight > 0 && content.scrollHeight > content.clientHeight + 1;
        if (!textClipped && !controlClipped) return;
        // The player may explicitly resume after reading the scrolling briefing.
        // Further layout checks must not trap that choice in repeated auto-holds.
        scenicReadingHeld = true;
        suspend();
        status.textContent = 'Journey paused to give you time to read. Resume when you’re ready.';
        resume.focus({ preventScroll: true });
    };

    modal.hold = () => {
        if (modal.dataset.revealing === 'true') suspend();
        else hold();
    };
    modal.setStatus = (text) => {
        if (!disposed && !retained && !visibilityHeld) status.textContent = text;
    };
    modal.waitUntilVisible = () => {
        if (disposed || retained) return Promise.resolve(false);
        if (!visibilityHeld && isVisible()) return Promise.resolve(true);
        if (!visibilityHeld) suspend();
        return new Promise((resolve) => { visibilityWaiters.add(resolve); });
    };
    modal.dispose = () => {
        if (disposed) return;
        disposed = true;
        themeReward?.dispose?.();
        timers.forEach(clearTimeout);
        timers.clear();
        listeners.forEach((remove) => remove());
        pending.forEach((resolve) => resolve(false));
        pending.clear();
        visibilityWaiters.forEach((resolve) => resolve(false));
        visibilityWaiters.clear();
        modal.remove();
    };
    modal.cover = async () => {
        if (disposed || retained) return false;
        modal.dataset.covered = 'true';
        if (scenicStage) modal.dataset.scenicCovered = 'true';
        // A retained completion is already visible and becomes opaque in place.
        // Allow its cover to paint without replaying the separate portal entrance.
        return wait(reducedMotion || modal.dataset.continuation === 'true' ? 100 : 420);
    };
    modal.reveal = async () => {
        if (disposed || retained) return false;
        modal.dataset.revealing = 'true';
        modal.inert = !visibilityHeld;
        while (!disposed && !retained) {
            if (!await modal.waitUntilVisible()) return false;
            const generation = modal.visibilityGeneration;
            if (!await wait(reducedMotion ? 100 : 360)) return false;
            if (!visibilityHeld && isVisible() && generation === modal.visibilityGeneration) break;
        }
        if (disposed || retained) return false;
        // Keep visibility ownership through the caller's ready cue. The caller
        // disposes immediately before gameplay starts; a blurred reveal can still
        // restore this surface and require a deliberate Resume.
        modal.dataset.revealed = 'true';
        return true;
    };
    modal.retainCover = () => {
        if (disposed || retained) return;
        retained = true;
        themeReward?.suppressCelebration?.();
        themeReward?.dispose?.();
        scenicStage = null;
        delete modal.dataset.worldStage;
        delete modal.dataset.scenicCovered;
        chosen = true;
        stopAuto();
        timers.forEach(clearTimeout);
        timers.clear();
        listeners.forEach((remove) => remove());
        pending.forEach((resolve) => resolve(false));
        pending.clear();
        visibilityWaiters.forEach((resolve) => resolve(false));
        visibilityWaiters.clear();
        modal.dataset.covered = 'true';
        modal.dataset.revealing = 'false';
        modal.dataset.revealed = 'false';
        modal.dataset.visibilityHeld = 'false';
        modal.dataset.retained = 'true';
        modal.inert = false;
        [primary, resume, pause, details, map, checkbox].filter(Boolean).forEach((node) => {
            node.disabled = true;
        });
        status.textContent = 'Returning to the map…';
    };
    // Transfer this same composition and presence owner to preparation. Only Map
    // can end this second phase; Pause can hold it until a deliberate Resume.
    modal.beginTransit = ({ onChoose: nextChoose } = {}) => {
        if (disposed || retained || transitActive) return false;
        themeReward?.suppressCelebration?.();
        transitActive = true;
        if (nextChoose) chooseHandler = nextChoose;
        chosen = false;
        stopAuto();
        const continuation = presentationVariant === 'completion';
        presentationVariant = 'transit';
        modal.className = `ody-flow ody-flow--transit${continuation ? ' ody-flow--continuation' : ''}`;
        modal.dataset.continuation = String(continuation);
        modal.dataset.variant = 'transit';
        modal.dataset.covered = 'true';
        modal.dataset.revealing = 'false';
        modal.dataset.revealed = 'false';
        modal.ariaLabel = 'Continue your Odyssey';
        modal.inert = false;
        primary.hidden = true;
        details.hidden = true;
        pause.hidden = visibilityHeld;
        if (preference) preference.ariaHidden = 'true';
        if (checkbox) checkbox.disabled = true;
        chapterCopy.forEach((node) => { node.hidden = true; });
        if (!continuation) eyebrowNode.textContent = 'Your journey continues';
        titleNode.textContent = nextLevel?.name || 'The journey continues';
        if (destinationLabel) destinationLabel.textContent = `Next · Orb ${nextLevel.id}`;
        if (!visibilityHeld) {
            status.textContent = 'Preparing your next orb…';
            pause.focus({ preventScroll: true });
        }
        return true;
    };
    // A chapter arrival is the same presence owner with an untimed Begin action.
    // Authored narrative appears only after the caller has settled the new vista.
    modal.showChapter = ({ onChoose: nextChoose } = {}) => {
        if (disposed || retained || !transitActive) return false;
        if (themeReward) themeReward.hidden = true;
        transitActive = false;
        presentationVariant = 'chapter';
        scenicStage = null;
        chosen = false;
        if (nextChoose) chooseHandler = nextChoose;
        stopAuto();
        modal.className = 'ody-flow ody-flow--chapter';
        modal.dataset.variant = 'chapter';
        modal.dataset.continuation = 'false';
        modal.dataset.covered = 'false';
        modal.dataset.revealing = 'false';
        modal.dataset.revealed = 'false';
        delete modal.dataset.worldStage;
        delete modal.dataset.scenicCovered;
        modal.ariaLabel = 'A new chapter';
        modal.inert = false;
        eyebrowNode.textContent = `Chapter ${chapterId} · A new horizon`;
        titleNode.textContent = chapter?.name || 'A new horizon';
        primary.textContent = 'Begin chapter';
        primary.hidden = visibilityHeld;
        pause.hidden = true;
        details.hidden = true;
        if (preference) preference.hidden = true;
        chapterCopy.forEach((node) => { node.hidden = false; });
        if (destinationLabel) destinationLabel.textContent = `First · Orb ${nextLevel.id} · ${nextLevel.name}`;
        modal.scrollTop = 0;
        content.scrollTop = 0;
        if (!visibilityHeld) {
            status.textContent = '';
            titleNode.focus({ preventScroll: true });
        }
        return true;
    };
    // Scenic travel keeps the same goal, controls and presence owner over the
    // real world. It is independent of reveal(), which hands off to live play.
    modal.setScenic = (stage) => {
        if (disposed || retained || !transitActive) return false;
        if (stage !== false && !['emerging', 'travel', 'entering'].includes(stage)) return false;
        scenicStage = stage || null;
        if (scenicStage) {
            modal.dataset.worldStage = scenicStage;
            modal.dataset.revealing = 'false';
            modal.dataset.revealed = 'false';
            modal.inert = false;
            later(holdScenicForReading, 0);
        } else {
            delete modal.dataset.worldStage;
            delete modal.dataset.scenicCovered;
        }
        if (!visibilityHeld) status.textContent = transitStatus();
        return true;
    };

    listen(primary, 'click', () => choose('next'));
    listen(resume, 'click', resumeVisible);
    listen(pause, 'click', () => {
        if (transitActive) {
            suspend();
            resume.focus({ preventScroll: true });
        } else {
            hold();
            primary.focus({ preventScroll: true });
        }
    });
    listen(details, 'click', () => choose('details'));
    listen(map, 'click', () => choose('map'));
    listen(modal, 'focusin', (event) => {
        if (!transitActive && presentationVariant === 'completion'
            && event.target !== primary && event.target !== eyebrowNode) hold();
    });
    listen(modal, 'pointerdown', hold);
    if (checkbox) {
        listen(checkbox, 'change', () => {
            hold();
            onAutoContinueChange(checkbox.checked);
        });
    }
    const focusables = () => [primary, resume, pause, details, map, checkbox]
        .filter((node) => node && !node.hidden && !node.disabled);
    listen(document, 'keydown', (event) => {
        if (disposed || chosen) return;
        if (modal.inert && event.key !== 'Escape') {
            if (!event.metaKey && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
            }
            return;
        }
        const activation = ['Enter', ' ', 'Escape'].includes(event.key);
        if (event.repeat && activation) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            choose('map');
        } else if (event.key === 'Tab') {
            hold();
            const nodes = focusables();
            const index = nodes.indexOf(document.activeElement);
            if (event.shiftKey ? index <= 0 : index < 0 || index === nodes.length - 1) {
                event.preventDefault();
                nodes[event.shiftKey ? nodes.length - 1 : 0]?.focus();
            }
            event.stopPropagation();
        } else if ((event.key === 'Enter' || event.key === ' ') && !focusables().includes(document.activeElement)) {
            // Space is a gameplay hard-drop key: never turn a carried key into Continue.
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Enter') {
                if (visibilityHeld) resumeVisible();
                else if (!transitActive) choose('next');
            }
        } else if (activation) {
            event.stopPropagation();
        }
    }, true);
    listen(document, 'visibilitychange', () => { if (document.hidden) suspend(); });
    listen(window, 'blur', suspend);
    listen(window, 'resize', holdForReading);
    listen(window, 'resize', holdScenicForReading);
    later(() => {
        if (!isVisible()) { suspend(); return; }
        holdForReading();
        let initialFocus = transitActive ? pause : primary;
        if (presentationVariant === 'chapter') initialFocus = titleNode;
        else if (presentationVariant === 'completion' && themeReward) initialFocus = eyebrowNode;
        if (visibilityHeld) initialFocus = resume;
        initialFocus.focus({ preventScroll: true });
    }, 0);
    if (variant === 'completion' && autoContinue) {
        modal.dataset.autoRunning = 'true';
        status.textContent = 'Continuing automatically. Pause to read.';
        autoTimer = later(() => {
            if (!held && isVisible()) choose('next');
            else if (!isVisible()) suspend();
        }, AUTO_CONTINUE_MS);
    } else {
        status.textContent = variant === 'transit' ? 'Preparing your next orb…' : '';
    }
    if (!isVisible()) suspend();
    return modal;
}

export default createJourneyFlowOverlay;
