/**
 * The campaign finale: an untimed ending owned by the exact attempt that completed the campaign.
 * A night sky that carries all eight chapters' light; the journey as an ascent of the chapters,
 * each in its light with its boss's world as the art; the last theme at the ceremony size; the
 * journey in figures and cells; three ways on, each with its key and its controller button.
 *
 * Plain DOM properties only (className, dataset, ARIA reflection, innerHTML for the glyphs), so
 * it stays testable against minimal element stubs. Styles: public/styles/odyssey-finale.css,
 * with the orb art and the chapter hues from odyssey-shared.css.
 */
import { appendKeyHint, el, isSettingsOverSheet } from './keystone-sheet.js';
import { createThemeUnlockReward } from './ThemeUnlockReward.js';
import { createOdysseyOrbArt, ODYSSEY_STAR_SVG } from './odyssey-orb-art.js';

/**
 * Each way on and what chooses it: Enter (or Escape, or B as the way back) and A on the focused
 * button explore the journey; N or X follow the next star; R or Y open this orb's results.
 */
export const CAMPAIGN_FINALE_KEYS = Object.freeze({
    world: Object.freeze({ key: 'Enter', pad: 'A' }),
    mastery: Object.freeze({
        key: 'N', pad: 'X', code: 'KeyN', button: 2,
    }),
    details: Object.freeze({
        key: 'R', pad: 'Y', code: 'KeyR', button: 3,
    }),
});
const SHORTCUTS = ['mastery', 'details'];

/** The chapter's short name, the part before " & ": "Deep Ocean & Liquid Worlds" → "Deep Ocean". */
function shortName(name) {
    const text = String(name || '').trim();
    return text.split(/\s+&\s+/)[0] || text;
}

/** How far up the climb a station sits, 0 at the foot to 1 at the summit (easing toward the top). */
export function campaignFinaleLift(index, count) {
    if (count <= 1) return 1;
    return Math.sin((Math.PI / 2) * (index / (count - 1)));
}

/** A smooth line through the stations' worlds (user units: 100 per station, 0–100 high). */
function ascentPath(lifts) {
    const points = lifts.map((lift, index) => [(index + 0.5) * 100, (1 - lift) * 100]);
    const fmt = (point) => point.map((value) => Number(value.toFixed(1))).join(' ');
    let path = `M${fmt(points[0])}`;
    for (let index = 0; index < points.length - 1; index += 1) {
        const before = points[index - 1] || points[index];
        const from = points[index];
        const to = points[index + 1];
        const after = points[index + 2] || to;
        const lead = [from[0] + (to[0] - before[0]) / 6, from[1] + (to[1] - before[1]) / 6];
        const trail = [to[0] - (after[0] - from[0]) / 6, to[1] - (after[1] - from[1]) / 6];
        path += ` C${fmt(lead)} ${fmt(trail)} ${fmt(to)}`;
    }
    return path;
}

function createSky(chapters, lifts) {
    const sky = el('div', 'ody-finale__sky');
    sky.ariaHidden = 'true';
    chapters.forEach((chapter, index) => {
        // The chapters' lights climb the sky with the ascent, from the foot to the summit.
        const light = el('span', 'ody-finale__light');
        light.dataset.odyChapter = String(chapter.id);
        light.style.setProperty('--light', index);
        light.style.setProperty('--x', `${(((index + 0.5) / chapters.length) * 100).toFixed(2)}%`);
        light.style.setProperty('--y', `${(56 - lifts[index] * 24).toFixed(2)}%`);
        sky.appendChild(light);
    });
    sky.appendChild(el('span', 'ody-finale__stars'));
    sky.appendChild(el('span', 'ody-finale__horizon'));
    return sky;
}

function createHead() {
    const head = el('header', 'ody-finale__head');
    head.appendChild(el('p', 'sb-eyebrow ody-finale__eyebrow', 'Odyssey complete'));
    const title = el('h1', 'ody-finale__title', 'You reached the horizon.');
    title.tabIndex = -1;
    head.appendChild(title);
    head.appendChild(el(
        'p',
        'ody-finale__lede',
        'From the heart of the Earth to worlds beyond. Every orb completed. Every chapter yours.',
    ));
    return { head, title };
}

function createStarTally(stars, maxStars) {
    const tally = el('span', 'ody-finale__station-stars');
    tally.ariaHidden = 'true';
    tally.appendChild(el('b', '', String(stars)));
    tally.appendChild(el('small', '', `/${maxStars}`));
    const star = el('i');
    star.innerHTML = ODYSSEY_STAR_SVG;
    tally.appendChild(star);
    return tally;
}

/** The climb: chapter 1 at the foot, the encore at the summit, a line of their light between. */
function createJourney(chapters, lifts) {
    const journey = el('ol', 'ody-finale__journey');
    journey.ariaLabel = 'Your completed chapters';
    journey.style.setProperty('--stations', chapters.length);
    if (chapters.length > 1) {
        const line = el('span', 'ody-finale__ascent');
        line.ariaHidden = 'true';
        const width = chapters.length * 100;
        const stops = chapters.map((chapter, index) => `<stop offset="${((index + 0.5) / chapters.length).toFixed(4)}"`
            + ` data-ody-chapter="${Number(chapter.id) || 0}"/>`).join('');
        const path = ascentPath(lifts);
        line.innerHTML = `<svg viewBox="0 0 ${width} 100" preserveAspectRatio="none" focusable="false">`
            + '<defs><linearGradient id="ody-finale-ascent-light" gradientUnits="userSpaceOnUse"'
            + ` x1="0" y1="0" x2="${width}" y2="0">${stops}</linearGradient></defs>`
            + `<path class="ody-finale__ascent-glow" d="${path}"/><path d="${path}"/></svg>`;
        journey.appendChild(line);
    }
    chapters.forEach((chapter, index) => {
        const summit = index === chapters.length - 1;
        const station = el('li', 'ody-finale__station');
        station.dataset.odyChapter = String(chapter.id);
        if (summit) station.dataset.summit = 'true';
        station.style.setProperty('--station', index);
        station.style.setProperty('--lift', lifts[index].toFixed(3));
        const hasStars = Number.isInteger(chapter.stars) && Number.isInteger(chapter.maxStars) && chapter.maxStars > 0;
        const starsRead = hasStars ? `, ${chapter.stars} of ${chapter.maxStars} stars` : '';
        station.ariaLabel = `Chapter ${chapter.id}: ${chapter.name}, complete${starsRead}`;
        const art = createOdysseyOrbArt({
            themeId: chapter.themeId || null,
            chapter: chapter.id,
            state: 'cleared',
            number: chapter.id,
            breathe: summit,
            className: 'ody-finale__world',
        });
        if (art) station.appendChild(art);
        const name = el('span', 'ody-finale__station-name', chapter.shortName || shortName(chapter.name));
        name.ariaHidden = 'true';
        station.appendChild(name);
        if (hasStars) station.appendChild(createStarTally(chapter.stars, chapter.maxStars));
        journey.appendChild(station);
    });
    return journey;
}

/** The journey in figures (the navigator's big number and small-caps label) and its orbs as cells. */
function createSummary(summary) {
    const block = el('div', 'ody-finale__summary');
    const figures = el('dl', 'ody-finale__figures');
    [
        ['orbs', 'Orbs completed', summary.completedOrbs, summary.totalOrbs],
        ['chapters', 'Chapters explored', summary.completedChapters, summary.totalChapters],
        ['stars', 'Stars earned', summary.stars, summary.maxStars],
    ].forEach(([id, label, value, total]) => {
        const figure = el('div', 'ody-finale__figure');
        figure.dataset.figure = id;
        figure.appendChild(el('dt', '', label));
        const amount = el('dd');
        amount.appendChild(el('b', '', String(value)));
        amount.appendChild(el('small', '', `/ ${total}`));
        figure.appendChild(amount);
        figures.appendChild(figure);
    });
    block.appendChild(figures);
    // Every orb as a cell, chapter by chapter in its own light: all of them lit.
    const meter = el('div', 'ody-finale__meter');
    meter.ariaHidden = 'true';
    summary.chapters.forEach((chapter, index) => {
        const group = el('span', 'ody-finale__meter-chapter');
        group.dataset.odyChapter = String(chapter.id);
        const cells = Math.max(1, Number(chapter.orbs) || 1);
        group.style.setProperty('--cells', cells);
        group.style.setProperty('--station', index);
        for (let cell = 0; cell < cells; cell += 1) group.appendChild(el('i'));
        meter.appendChild(group);
    });
    block.appendChild(meter);
    block.appendChild(el('p', 'ody-finale__invitation', summary.nextMasteryLevelId !== null
        ? 'Stay a while. Revisit a favorite world, or follow the next star.'
        : 'Every star is yours. Return to a favorite world whenever you wish.'));
    return block;
}

/**
 * X and Y on the first controller, pressed fresh while the finale is the top sheet. A press that
 * began before the finale (a button still held from play) never chooses: each button counts
 * once it has been seen up. Installed through GamepadController.setPanelControls.
 * @param {object} controller the GamepadController (held-input latch, DAS reset)
 * @param {{ isActive: (choice: string) => boolean, onPress: (choice: string) => void }} callbacks
 */
export function createCampaignFinalePadControls(controller, { isActive, onPress }) {
    const up = new Map();
    const reset = () => up.clear();
    return {
        reset,
        process(gamepad, slot) {
            if (slot !== 0 || !gamepad) return false;
            for (const choice of SHORTCUTS) {
                const { button } = CAMPAIGN_FINALE_KEYS[choice];
                const down = Boolean(gamepad.buttons?.[button]?.pressed);
                const fresh = down && up.get(button) === true;
                up.set(button, !down);
                if (fresh && isActive(choice)) {
                    // The press is the finale's: the next screen's gameplay never sees it as a move.
                    if (controller?.odysseyHeldInputs && controller.getGameplayPressedState) {
                        controller.odysseyHeldInputs[0] = controller.getGameplayPressedState(gamepad, 0);
                    }
                    controller?.clearFixedTickInput?.({ slot: 0 });
                    controller?.clearDasTimers?.(0);
                    onPress(choice);
                    return true;
                }
            }
            return false;
        },
    };
}

/** An untimed celebration owned by the exact attempt that completed the campaign. */
export function createCampaignFinale({
    summary, themeUnlock = null, reducedMotion = false, onChoose = () => {}, gamepadController = null,
}) {
    const modal = el('div', 'ody-finale');
    modal.id = 'odyssey-finale-modal';
    modal.dataset.odysseyWheelLock = 'true';
    modal.dataset.reducedMotion = String(reducedMotion);
    modal.role = 'dialog';
    modal.ariaModal = 'true';
    modal.ariaLabel = 'Odyssey complete';

    const chapters = summary.chapters || [];
    const lifts = chapters.map((_, index) => campaignFinaleLift(index, chapters.length));
    modal.appendChild(createSky(chapters, lifts));
    // The section sizes the page (its width is what the layout answers to); the layout fills it.
    const content = el('section', 'ody-finale__content');
    const layout = el('div', 'ody-finale__layout');
    content.appendChild(layout);
    const { head, title } = createHead();
    layout.appendChild(head);
    layout.appendChild(createJourney(chapters, lifts));

    const themeReward = createThemeUnlockReward(themeUnlock, { reducedMotion, variant: 'ceremony' });
    layout.dataset.reward = String(Boolean(themeReward));
    if (themeReward) {
        const reward = el('div', 'ody-finale__reward');
        reward.appendChild(themeReward);
        layout.appendChild(reward);
    }
    layout.appendChild(createSummary(summary));

    let disposed = false;
    const buttons = [];
    const available = new Set();
    const choose = (choice) => {
        if (disposed || document.hidden || document.hasFocus?.() === false) return;
        modal.dispose();
        onChoose(choice);
    };
    const actions = el('div', 'ody-finale__actions');
    const addAction = (choice, label, primary = false) => {
        const button = el('button', `sb-btn${primary ? ' sb-btn--primary' : ''}`, label);
        button.type = 'button';
        button.dataset.finaleAction = choice;
        appendKeyHint(button, CAMPAIGN_FINALE_KEYS[choice].key, CAMPAIGN_FINALE_KEYS[choice].pad);
        button.addEventListener('click', () => choose(choice));
        actions.appendChild(button);
        buttons.push(button);
        available.add(choice);
        return button;
    };
    const world = addAction('world', 'Explore the journey', true);
    if (summary.nextMasteryLevelId !== null) addAction('mastery', 'Follow the next star');
    addAction('details', 'View this orb’s results');
    actions.appendChild(el('p', 'ody-finale__breath', 'There is no hurry. This moment is yours.'));
    layout.appendChild(actions);
    modal.appendChild(content);

    const shortcutFor = (event) => SHORTCUTS.find((choice) => available.has(choice)
        && (event.code === CAMPAIGN_FINALE_KEYS[choice].code
            || String(event.key || '').toUpperCase() === CAMPAIGN_FINALE_KEYS[choice].key));
    const onKeyDown = (event) => {
        const activation = ['Enter', ' ', 'Escape'].includes(event.key);
        if (activation && (event.repeat || document.hidden || document.hasFocus?.() === false)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const shortcut = !event.ctrlKey && !event.metaKey && !event.altKey && !isSettingsOverSheet()
            ? shortcutFor(event) : null;
        if (shortcut) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) choose(shortcut);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            choose('world');
        } else if (event.key === 'Tab') {
            const index = buttons.indexOf(document.activeElement);
            if (event.shiftKey ? index <= 0 : index < 0 || index === buttons.length - 1) {
                event.preventDefault();
                buttons[event.shiftKey ? buttons.length - 1 : 0].focus();
            }
            event.stopPropagation();
        } else if (activation) {
            event.stopPropagation();
            if (!buttons.includes(document.activeElement)) {
                event.preventDefault();
                if (event.key === 'Enter') choose('world');
            }
        }
    };
    document.addEventListener('keydown', onKeyDown, true);
    const pad = gamepadController?.setPanelControls?.(createCampaignFinalePadControls(gamepadController, {
        isActive: (choice) => !disposed && available.has(choice) && modal.isConnected !== false
            && gamepadController.getMenuSheet?.()?.element === modal
            && !document.body?.classList?.contains?.('serenity-hub-open'),
        onPress: choose,
    }));
    const focusTimer = setTimeout(() => {
        if (!disposed) (themeReward ? title : world).focus({ preventScroll: true });
    }, 0);
    modal.dispose = () => {
        if (disposed) return;
        disposed = true;
        themeReward?.dispose?.();
        pad?.dispose?.();
        clearTimeout(focusTimer);
        document.removeEventListener('keydown', onKeyDown, true);
        modal.remove();
    };
    return modal;
}
