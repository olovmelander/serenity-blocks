import { appendKeyHint, el } from './keystone-sheet.js';
import { createThemeUnlockReward } from './ThemeUnlockReward.js';

/** An untimed celebration owned by the exact attempt that completed the campaign. */
export function createCampaignFinale({
    summary, themeUnlock = null, reducedMotion = false, onChoose = () => {},
}) {
    const modal = el('div', 'ody-finale');
    modal.id = 'odyssey-finale-modal';
    modal.dataset.odysseyWheelLock = 'true';
    modal.dataset.reducedMotion = String(reducedMotion);
    modal.role = 'dialog';
    modal.ariaModal = 'true';
    modal.ariaLabel = 'Odyssey complete';

    const horizon = el('div', 'ody-finale__horizon');
    horizon.ariaHidden = 'true';
    modal.appendChild(horizon);
    const content = el('section', 'ody-finale__content');
    content.appendChild(el('p', 'ody-finale__eyebrow', 'Odyssey complete'));
    const title = el('h1', 'ody-finale__title', 'You reached the horizon.');
    title.tabIndex = -1;
    content.appendChild(title);
    content.appendChild(el(
        'p',
        'ody-finale__lede',
        'From the heart of the Earth to worlds beyond. Every orb completed. Every chapter yours.',
    ));
    const themeReward = createThemeUnlockReward(themeUnlock, { reducedMotion });
    if (themeReward) content.appendChild(themeReward);

    const journey = el('ol', 'ody-finale__journey');
    journey.ariaLabel = 'Your completed chapters';
    summary.chapters.forEach((chapter, index) => {
        const station = el('li', 'ody-finale__station');
        station.style.setProperty('--station', index);
        station.ariaLabel = `Chapter ${chapter.id}: ${chapter.name}, complete`;
        const orb = el('span', 'ody-finale__orb', String(chapter.id).padStart(2, '0'));
        orb.ariaHidden = 'true';
        station.appendChild(orb);
        journey.appendChild(station);
    });
    content.appendChild(journey);

    const facts = el('dl', 'ody-finale__facts');
    [
        ['Orbs completed', `${summary.completedOrbs} / ${summary.totalOrbs}`],
        ['Chapters explored', `${summary.completedChapters} / ${summary.totalChapters}`],
        ['Stars earned', `${summary.stars} / ${summary.maxStars}`],
    ].forEach(([label, value]) => {
        const fact = el('div', 'ody-finale__fact');
        fact.appendChild(el('dt', '', label));
        fact.appendChild(el('dd', '', value));
        facts.appendChild(fact);
    });
    content.appendChild(facts);
    content.appendChild(el('p', 'ody-finale__invitation', summary.nextMasteryLevelId !== null
        ? 'Stay a while. Revisit a favorite world, or follow the next star.'
        : 'Every star is yours. Return to a favorite world whenever you wish.'));

    let disposed = false;
    const buttons = [];
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
        button.addEventListener('click', () => choose(choice));
        actions.appendChild(button);
        buttons.push(button);
        return button;
    };
    const world = addAction('world', 'Explore the journey', true);
    appendKeyHint(world, 'Enter', 'A');
    if (summary.nextMasteryLevelId !== null) addAction('mastery', 'Follow the next star');
    addAction('details', 'View this orb’s results');
    content.appendChild(actions);
    content.appendChild(el('p', 'ody-finale__breath', 'There is no hurry. This moment is yours.'));
    modal.appendChild(content);

    const onKeyDown = (event) => {
        const activation = ['Enter', ' ', 'Escape'].includes(event.key);
        if (activation && (event.repeat || document.hidden || document.hasFocus?.() === false)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.key === 'Escape') {
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
    const focusTimer = setTimeout(() => {
        if (!disposed) (themeReward ? title : world).focus({ preventScroll: true });
    }, 0);
    modal.dispose = () => {
        if (disposed) return;
        disposed = true;
        themeReward?.dispose?.();
        clearTimeout(focusTimer);
        document.removeEventListener('keydown', onKeyDown, true);
        modal.remove();
    };
    return modal;
}
