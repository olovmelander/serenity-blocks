/* eslint-disable no-await-in-loop -- Presence changes restart the visible handoff fade. */
/**
 * A light DOM portal between Odyssey orbs. Gameplay, loading and progression stay
 * with the mode; this view owns only its input, its celebration and its cover.
 *
 * One composition carries the whole handoff. A first-time completion is a reward ceremony
 * (the orb you finished, its stars, then the theme and song it unlocked); the next orb is a
 * teaser beneath it. When the journey moves on, the ceremony departs in place while the same
 * briefing docks over the live world, so attention never restarts on an unrelated screen.
 * Chapters end in an untimed arrival with a breathing companion.
 *
 * Layouts (data-layout): ceremony → departing → scenic | transit, and chapter.
 * State attributes (variant, world stage, covered, revealing, held) keep their old meanings.
 */
import { el } from './keystone-sheet.js';
import { getOdysseyLevelBriefing } from './odyssey-level-briefing.js';
import { createThemeUnlockReward } from './ThemeUnlockReward.js';
import { createChapterBreath } from './chapter-breath.js';
import { countWords, getCompletionHoldMs } from './journey-pacing.js';
import { resolveHubThemeThumbnailUrl } from '../serenity-hub/theme-thumbnail-manifest.js';

/** The ceremony fades in place before the briefing docks; the return portal starts beneath it. */
export const DEPARTURE_MS = 340;
/** The docked briefing's entrance; reading room is measured after it, not mid-motion. */
const DOCK_MS = 680;
/** The ceremony's staged entrance (stars, reward bloom, next teaser) before measuring overflow. */
const CEREMONY_SETTLE_MS = { reward: 2700, brief: 1600 };
/** Let a chapter's title settle before the breathing light starts to move. */
const BREATH_DELAY_MS = 900;
const CHAPTER_COLORS = [
    '#f3ac77', '#8cd3ed', '#b5d4a2', '#c8d3f0',
    '#c8b2ed', '#b5a0ee', '#e6a9dd', '#f3b29d',
];

function formatTally(results) {
    const tally = [];
    if (Number.isFinite(results?.score)) tally.push(`${results.score.toLocaleString()} points`);
    if (Number.isFinite(results?.time) && results.time >= 0) {
        const seconds = Math.floor(results.time);
        tally.push(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    }
    return tally.join(' · ');
}

function createStarRow(results) {
    if (!Number.isFinite(results?.stars)) return null;
    const stars = Math.max(0, Math.min(3, Math.floor(results.stars)));
    const starRow = el('div', 'ody-flow__stars');
    starRow.role = 'img';
    starRow.ariaLabel = `${stars} of 3 stars earned`;
    for (let index = 0; index < 3; index += 1) {
        const star = el('span', index < stars ? 'is-earned' : '', '✦');
        star.ariaHidden = 'true';
        star.style.setProperty('--i', String(index));
        starRow.appendChild(star);
    }
    return starRow;
}

function destinationArtwork(level) {
    const themeId = level?.theme?.primary;
    const url = themeId ? resolveHubThemeThumbnailUrl(themeId, undefined, null) : null;
    if (!url) return null;
    const image = el('img', 'ody-flow__dest-art');
    image.src = url;
    image.alt = '';
    image.width = 56;
    image.height = 56;
    image.decoding = 'async';
    image.ariaHidden = 'true';
    image.addEventListener?.('error', () => { image.hidden = true; }, { once: true });
    return image;
}

/**
 * @param {object} options
 * @returns {HTMLElement} Mount before calling cover(). dispose() cancels all waits.
 */
export function createJourneyFlowOverlay({
    variant = 'completion',
    level = null,
    nextLevel = null,
    chapter = null,
    fromChapter = null,
    results = null,
    autoContinue = true,
    reducedMotion = false,
    nowPlaying = false,
    onChoose = () => {},
    onAutoContinueChange = () => {},
} = {}) {
    let transitActive = variant === 'transit';
    let presentationVariant = variant;
    let chooseHandler = onChoose;
    const crossesChapter = Boolean(level && nextLevel && level.chapter !== nextLevel.chapter);
    const modal = el('div', `ody-flow ody-flow--${variant}`);
    modal.id = 'odyssey-flow-overlay';
    modal.dataset.odysseyWheelLock = 'true';
    modal.dataset.variant = variant;
    modal.dataset.reducedMotion = String(reducedMotion);
    modal.dataset.crossesChapter = String(crossesChapter);
    modal.role = 'dialog';
    modal.ariaModal = 'true';
    modal.visibilityGeneration = 0;
    modal.ariaLabel = variant === 'chapter' ? 'A new chapter' : 'Continue your Odyssey';
    const chapterId = chapter?.id || nextLevel?.chapter || level?.chapter || 1;
    const chapterColor = (id) => CHAPTER_COLORS[id - 1] || CHAPTER_COLORS[0];
    // A chapter's last ceremony keeps its own colour; the next chapter's arrives with the journey.
    modal.style.setProperty('--ody-flow-color', chapterColor(
        variant === 'completion' && crossesChapter ? level.chapter : chapterId,
    ));

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
    const recognition = el('p', 'ody-flow__recognition');
    recognition.hidden = true;
    content.appendChild(recognition);
    const eyebrowNode = el('p', 'ody-flow__eyebrow', eyebrow);
    eyebrowNode.tabIndex = -1;
    content.appendChild(eyebrowNode);
    // The orb just finished is the hero of its own completion, not the next destination.
    const achievement = variant === 'completion' && level?.name
        ? el('p', 'ody-flow__achievement', level.name) : null;
    if (achievement) content.appendChild(achievement);
    const starRow = variant === 'completion' ? createStarRow(results) : null;
    const tallyText = variant === 'completion' ? formatTally(results) : '';
    if (starRow || tallyText) {
        const score = el('div', 'ody-flow__score');
        if (starRow) score.appendChild(starRow);
        if (tallyText) score.appendChild(el('p', 'ody-flow__tally', tallyText));
        content.appendChild(score);
    }
    const themeReward = variant === 'completion'
        ? createThemeUnlockReward(results?.themeUnlock, { reducedMotion, variant: 'ceremony', nowPlaying }) : null;
    if (themeReward) {
        modal.dataset.themeReward = 'true';
        content.appendChild(themeReward);
    }

    // The next orb: a quiet teaser under the ceremony, the briefing during travel.
    const nextBlock = el('div', 'ody-flow__next');
    const nextEyebrowText = crossesChapter
        ? `Chapter ${level?.chapter} complete · Next, Chapter ${nextLevel?.chapter}`
        : `Next · Orb ${nextLevel?.id || ''}`;
    const nextEyebrow = nextLevel ? el('p', 'ody-flow__next-label', nextEyebrowText) : null;
    if (nextEyebrow) nextBlock.appendChild(nextEyebrow);
    const destinationArt = nextLevel ? destinationArtwork(nextLevel) : null;
    if (destinationArt) nextBlock.appendChild(destinationArt);
    let title = variant === 'chapter' ? chapter?.name : nextLevel?.name;
    if (variant === 'completion' && crossesChapter && chapter?.name) title = chapter.name;
    const titleNode = el('h2', 'ody-flow__title', title || 'The journey continues');
    titleNode.tabIndex = -1;
    nextBlock.appendChild(titleNode);
    if (chapter) {
        if (chapter?.subtitle) chapterCopy.push(el('p', 'ody-flow__subtitle', chapter.subtitle));
        if (chapter?.narrative?.intro) {
            chapterCopy.push(el('p', 'ody-flow__narrative', chapter.narrative.intro));
        }
        chapterCopy.forEach((node) => {
            node.hidden = variant !== 'chapter';
            nextBlock.appendChild(node);
        });
    }
    // The chapter you leave speaks once more while the world carries you out of it.
    const farewell = crossesChapter && fromChapter?.narrative?.outro
        ? el('p', 'ody-flow__farewell', fromChapter.narrative.outro) : null;
    if (farewell) {
        farewell.hidden = true;
        nextBlock.appendChild(farewell);
    }
    let destinationLabel = null;
    let briefing = null;
    if (nextLevel) {
        briefing = getOdysseyLevelBriefing(nextLevel, level);
        const destination = el('p', 'ody-flow__destination');
        const nextLabel = `Next · Orb ${nextLevel.id}${variant === 'chapter' ? ` · ${nextLevel.name}` : ''}`;
        destinationLabel = el('span', 'ody-flow__orb-label', variant === 'chapter'
            ? `First · Orb ${nextLevel.id} · ${nextLevel.name}` : nextLabel);
        if (crossesChapter && variant === 'completion') {
            destinationLabel.textContent = `First · Orb ${nextLevel.id} · ${nextLevel.name}`;
        }
        destination.appendChild(destinationLabel);
        destination.appendChild(el('span', 'ody-flow__goal', briefing.goal));
        nextBlock.appendChild(destination);
        if (briefing.changes.length) {
            const changes = el('ul', 'ody-flow__changes');
            changes.ariaLabel = 'What changes next';
            briefing.changes.forEach((change) => changes.appendChild(el('li', '', change)));
            nextBlock.appendChild(changes);
        }
    }
    content.appendChild(nextBlock);

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
        const breath = el('p', 'ody-flow__breath', 'Rest here with the light for as long as you like.');
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
    let departing = false;
    let autoTimer = null;
    let breathGuide = null;
    let breathTimer = null;
    const fadingGuides = new Set();
    const timers = new Set();
    const pending = new Set();
    const visibilityWaiters = new Set();
    const listeners = [];
    const autoContinueMs = getCompletionHoldMs({
        hasReward: Boolean(themeReward),
        rewardWords: themeReward?.readingWords || 0,
        briefingWords: countWords(nextEyebrow?.textContent, titleNode.textContent, briefing?.goal, briefing?.changes),
    });
    modal.autoContinueMs = autoContinueMs;
    modal.style.setProperty('--ody-flow-hold', `${autoContinueMs}ms`);
    const isVisible = () => !document.hidden && document.hasFocus?.() !== false;
    const transitStatus = () => {
        if (crossesChapter && presentationVariant === 'transit' && !modal.dataset.chapterShown) {
            return {
                emerging: 'The chapter closes behind you…',
                travel: `Crossing into Chapter ${nextLevel?.chapter || chapterId}…`,
                entering: 'Entering the first orb…',
            }[scenicStage] || 'A new horizon is near…';
        }
        return {
            emerging: 'Returning to the journey…',
            travel: 'Following the path to your next orb…',
            entering: 'Entering your next orb…',
        }[scenicStage] || 'Preparing your next orb…';
    };
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
        if (modal.dataset.autoState === 'running') modal.dataset.autoState = 'held';
        pause.disabled = !transitActive;
    };
    const stopBreath = ({ fade = false } = {}) => {
        clearTimeout(breathTimer);
        timers.delete(breathTimer);
        breathTimer = null;
        const guide = breathGuide;
        breathGuide = null;
        if (!guide) return;
        if (!fade || reducedMotion) {
            guide.dispose();
            return;
        }
        // A departing chapter lets its light fade with the text before it is removed.
        guide.pause();
        guide.dataset.leaving = 'true';
        fadingGuides.add(guide);
        later(() => {
            fadingGuides.delete(guide);
            guide.dispose();
        }, DEPARTURE_MS);
    };
    const disposeFadingGuides = () => {
        fadingGuides.forEach((guide) => guide.dispose());
        fadingGuides.clear();
    };
    const pauseBreath = () => {
        clearTimeout(breathTimer);
        timers.delete(breathTimer);
        breathTimer = null;
        breathGuide?.pause();
    };
    const resumeBreath = () => {
        if (!breathGuide || presentationVariant !== 'chapter' || disposed || retained || visibilityHeld) return;
        breathTimer = later(() => {
            breathTimer = null;
            if (presentationVariant === 'chapter' && !visibilityHeld && isVisible()) breathGuide?.start();
        }, BREATH_DELAY_MS);
    };
    const mountBreath = () => {
        if (breathGuide || disposed || retained) return;
        breathGuide = createChapterBreath({ reducedMotion });
        modal.appendChild(breathGuide);
        resumeBreath();
    };
    const hold = () => {
        if (disposed || chosen || transitActive) return;
        themeReward?.suppressCelebration?.();
        held = true;
        stopAuto();
        if (presentationVariant === 'completion') status.textContent = 'Paused. Continue when you’re ready.';
    };
    const isClipped = () => {
        const bounds = pause.getBoundingClientRect?.();
        const height = window.innerHeight || document.documentElement?.clientHeight;
        const controlClipped = bounds && height && (bounds.bottom > height - 8 || bounds.top < 0);
        const scrolls = modal.clientHeight > 0 && modal.scrollHeight > modal.clientHeight + 1;
        return Boolean(controlClipped || scrolls);
    };
    const holdForReading = () => {
        if (!autoTimer || transitActive || disposed || chosen) return;
        if (isClipped()) {
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
        pauseBreath();
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
        if (presentationVariant === 'chapter') status.textContent = '';
        visibilityWaiters.forEach((resolve) => resolve(true));
        visibilityWaiters.clear();
        resumeBreath();
        (transitActive ? pause : primary).focus({ preventScroll: presentationVariant !== 'chapter' });
    };
    const holdScenicForReading = () => {
        if (!scenicStage || scenicReadingHeld || disposed || retained || departing
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
    // A departing composition keeps its layout while it fades; the next one takes over after.
    const syncLayout = () => {
        modal.dataset.departing = String(departing);
        if (departing) return;
        let layout = 'transit';
        if (presentationVariant === 'completion') layout = 'ceremony';
        else if (presentationVariant === 'chapter') layout = 'chapter';
        else if (scenicStage) layout = 'scenic';
        const changed = modal.dataset.layout !== layout;
        modal.dataset.layout = layout;
        if (farewell) farewell.hidden = layout !== 'scenic' || !crossesChapter || Boolean(modal.dataset.chapterShown);
        // Entrance motion shifts boxes; measure reading room once the new layout has settled.
        if (changed && layout === 'scenic') later(holdScenicForReading, reducedMotion ? 0 : DOCK_MS);
    };
    // The visible composition fades in place, then the next layout takes over.
    const depart = () => {
        if (reducedMotion || departing) {
            syncLayout();
            return;
        }
        departing = true;
        syncLayout();
        later(() => {
            departing = false;
            if (disposed || retained) return;
            syncLayout();
        }, DEPARTURE_MS);
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
        stopBreath();
        disposeFadingGuides();
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
        departing = false;
        themeReward?.suppressCelebration?.();
        themeReward?.dispose?.();
        stopBreath();
        disposeFadingGuides();
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
        modal.dataset.layout = 'transit';
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
        const departedFrom = presentationVariant;
        stopBreath({ fade: departedFrom === 'chapter' });
        if (crossesChapter) modal.style.setProperty('--ody-flow-color', chapterColor(chapterId));
        const continuation = departedFrom === 'completion';
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
        recognition.hidden = true;
        if (!continuation) eyebrowNode.textContent = 'Your journey continues';
        // Before a chapter arrival the briefing names the place ahead; afterwards, the orb.
        const towardChapter = continuation && crossesChapter && chapter?.name;
        titleNode.textContent = towardChapter ? chapter.name : (nextLevel?.name || 'The journey continues');
        if (destinationLabel) {
            destinationLabel.textContent = towardChapter
                ? `First · Orb ${nextLevel.id} · ${nextLevel.name}` : `Next · Orb ${nextLevel.id}`;
        }
        if (nextEyebrow && !towardChapter) nextEyebrow.textContent = `Next · Orb ${nextLevel?.id || ''}`;
        if (!visibilityHeld) {
            status.textContent = 'Preparing your next orb…';
            pause.focus({ preventScroll: true });
        }
        if (['completion', 'chapter'].includes(departedFrom)) depart();
        else syncLayout();
        return true;
    };
    // A chapter arrival is the same presence owner with an untimed Begin action.
    // Authored narrative appears only after the caller has settled the new vista.
    modal.showChapter = ({ onChoose: nextChoose, completedChapter = null } = {}) => {
        if (disposed || retained || !transitActive) return false;
        if (themeReward) themeReward.hidden = true;
        transitActive = false;
        presentationVariant = 'chapter';
        scenicStage = null;
        departing = false;
        chosen = false;
        if (nextChoose) chooseHandler = nextChoose;
        stopAuto();
        modal.className = 'ody-flow ody-flow--chapter';
        modal.dataset.variant = 'chapter';
        modal.dataset.chapterShown = 'true';
        modal.dataset.continuation = 'false';
        modal.dataset.covered = 'false';
        modal.dataset.revealing = 'false';
        modal.dataset.revealed = 'false';
        delete modal.dataset.worldStage;
        delete modal.dataset.scenicCovered;
        modal.ariaLabel = 'A new chapter';
        modal.inert = false;
        if (completedChapter?.id) {
            const facts = [`Chapter ${completedChapter.id} complete`];
            if (Number.isFinite(completedChapter.completed) && Number.isFinite(completedChapter.total)) {
                facts.push(`${completedChapter.completed} of ${completedChapter.total} orbs`);
            }
            if (Number.isFinite(completedChapter.stars) && Number.isFinite(completedChapter.maxStars)) {
                facts.push(`✦ ${completedChapter.stars} of ${completedChapter.maxStars}`);
            }
            recognition.textContent = facts.join(' · ');
            recognition.hidden = false;
        }
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
        syncLayout();
        mountBreath();
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
        const settled = modal.dataset.layout === 'scenic' && !departing;
        if (scenicStage) {
            modal.dataset.worldStage = scenicStage;
            modal.dataset.revealing = 'false';
            modal.dataset.revealed = 'false';
            modal.inert = false;
            if (settled) later(holdScenicForReading, 0);
        } else {
            delete modal.dataset.worldStage;
            delete modal.dataset.scenicCovered;
        }
        syncLayout();
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
    if (variant === 'completion') {
        later(holdForReading, reducedMotion ? 0 : CEREMONY_SETTLE_MS[themeReward ? 'reward' : 'brief']);
    }
    later(() => {
        if (!isVisible()) { suspend(); return; }
        if (variant !== 'completion') holdForReading();
        let initialFocus = transitActive ? pause : primary;
        if (presentationVariant === 'chapter') initialFocus = titleNode;
        else if (presentationVariant === 'completion' && themeReward) initialFocus = eyebrowNode;
        if (visibilityHeld) initialFocus = resume;
        initialFocus.focus({ preventScroll: true });
    }, 0);
    syncLayout();
    if (variant === 'chapter') mountBreath();
    if (variant === 'completion' && autoContinue) {
        modal.dataset.autoRunning = 'true';
        modal.dataset.autoState = 'running';
        status.textContent = crossesChapter
            ? 'A new chapter awaits · Pause to stay longer'
            : `On to orb ${nextLevel?.id || 'the next'} · Pause to stay longer`;
        autoTimer = later(() => {
            if (!held && isVisible()) choose('next');
            else if (!isVisible()) suspend();
        }, autoContinueMs);
    } else {
        status.textContent = variant === 'transit' ? 'Preparing your next orb…' : '';
    }
    if (!isVisible()) suspend();
    return modal;
}

export default createJourneyFlowOverlay;
