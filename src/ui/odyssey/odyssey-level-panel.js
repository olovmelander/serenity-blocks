/**
 * The map's orb panel: what an orb is, what it asks for, what each star needs, and what changes
 * from the orb before it. This is the briefing a player reads before pressing Play from the map,
 * so a rule change (a taller well, a deadline, cascade physics) is never a surprise on arrival.
 * The charms gathered sit above the goal as carry toggles, and the goal, stars and rules below
 * describe the orb as the carried charms make it. Pure DOM by id; the mode owns selection,
 * prefetch, the Play button and the charm bag.
 */
import { formatOdysseyMapObjective, formatOdysseyStarCondition } from './objective-copy.js';
import { getOdysseyLevelBriefing } from './odyssey-level-briefing.js';
import { odysseyUncarriedHelp } from './odyssey-charm-carry.js';
import { ODYSSEY_CHARM_SLOTS, applyOdysseyCharmsToLevel, describeOdysseyCharms } from '../../core/odyssey/odyssey-charms.js';

/** The kind of orb, as the map marks it: a rival duel, the chapter's boss, a showcase, or none. */
export function describeOdysseyOrbKind(level) {
    if (!level) return null;
    if (level.mechanics?.versus) {
        return { id: 'rival', label: `Rival duel · ${level.mechanics.versus.botName || 'Rival'}` };
    }
    // One per chapter (campaign-order resolveChapterBossIds), as the map's crown marks it.
    if (level.chapterBoss) {
        const showcase = level.victoryLapPolicy === 'showcase';
        return { id: 'boss', label: showcase ? 'Chapter boss · Showcase' : 'Chapter boss' };
    }
    if (level.victoryLapPolicy === 'showcase') return { id: 'showcase', label: 'Showcase' };
    return null;
}

function setText(doc, id, text) {
    const node = doc.getElementById(id);
    if (node) node.textContent = text;
    return node;
}

function clearChildren(node) {
    if (typeof node.replaceChildren === 'function') node.replaceChildren();
    else node.innerHTML = '';
}

function fillList(doc, id, items) {
    const list = doc.getElementById(id);
    if (!list) return;
    clearChildren(list);
    items.forEach((text) => {
        const item = doc.createElement('li');
        item.textContent = text;
        list.appendChild(item);
    });
    list.hidden = items.length === 0;
}

/**
 * The charm block: every gathered charm as a carry toggle (pressed when carried), and one line
 * under them: a notice from the last toggle, the uncarried charms that would ease this orb, or
 * how many are carried. Hidden until a charm has been gathered.
 * @param {Document} doc
 * @param {object} level the authored orb
 * @param {{ gathered: string[], carried: string[], notice?: string | null, onToggle?: function(string): void } | null} bag
 */
export function renderOdysseyPanelCharms(doc, level, bag) {
    const block = doc.getElementById('level-panel-charms');
    if (!block) return;
    const gathered = describeOdysseyCharms(bag?.gathered);
    block.hidden = gathered.length === 0;
    if (!gathered.length) return;
    const carried = bag.carried || [];
    const list = doc.getElementById('level-panel-charm-list');
    if (list) {
        // The rebuild destroys the chip a keyboard toggle came from: give focus back to its
        // replacement, or Tab starts over from the page (audit 2026-10-18).
        const focusedCharm = list.contains?.(doc.activeElement) ? doc.activeElement?.dataset?.charm : null;
        clearChildren(list);
        gathered.forEach((charm) => {
            const chip = doc.createElement('button');
            const isCarried = carried.includes(charm.id);
            chip.type = 'button';
            chip.className = 'level-charm';
            chip.ariaPressed = String(isCarried);
            chip.setAttribute?.('aria-pressed', String(isCarried));
            if (chip.dataset) {
                chip.dataset.charm = charm.id;
                chip.dataset.carried = String(isCarried);
            }
            chip.title = `${charm.line} ${isCarried ? 'Carried: tap to set it down.' : 'In the bag: tap to carry it.'}`;
            chip.textContent = `${isCarried ? '◆' : '◇'} ${charm.name}`;
            chip.addEventListener?.('click', () => bag.onToggle?.(charm.id));
            list.appendChild(chip);
            if (charm.id === focusedCharm) chip.focus?.({ preventScroll: true });
        });
    }
    const hint = doc.getElementById('level-panel-charm-hint');
    if (!hint) return;
    const help = odysseyUncarriedHelp(bag, level);
    if (bag.notice) hint.textContent = bag.notice;
    else if (help.length) {
        hint.textContent = `Not carried here: ${help.map(({ charm, effect }) => `${charm.name} (${effect})`).join(' · ')}.`;
    } else if (carried.length) {
        hint.textContent = `Carrying ${carried.length} of ${ODYSSEY_CHARM_SLOTS}. The goal and rules below count them.`;
    } else hint.textContent = `Tap a charm to carry it. You can carry ${ODYSSEY_CHARM_SLOTS}.`;
    if (hint.dataset) hint.dataset.notice = String(Boolean(bag.notice));
}

/**
 * @param {object} options
 * @param {object} options.level the resolved presentation of the selected orb
 * @param {object|null} [options.previousLevel] the orb before it on the route
 * @param {object|null} [options.completion] the saved completion, if any
 * @param {boolean} options.unlocked whether the orb can be played now
 * @param {string} [options.chapterName]
 * @param {{ gathered: string[], carried: string[], notice?: string | null, onToggle?: function(string): void } | null}
 *   [options.charms] the charm bag; the goal, stars and rules show the orb as the carried charms make it
 * @param {Document} [doc]
 */
export function renderOdysseyLevelPanel({
    level, previousLevel = null, completion = null, unlocked = false, chapterName = '', charms = null,
}, doc = globalThis.document) {
    if (!level || !doc) return;
    // The orb as the carried charms make it: what the panel promises is what will be played.
    const carried = charms?.carried || [];
    const played = applyOdysseyCharmsToLevel(level, carried);
    const playedBefore = previousLevel ? applyOdysseyCharmsToLevel(previousLevel, carried) : null;
    const stars = Math.max(0, Math.min(3, Number(completion?.stars) || 0));
    const kind = describeOdysseyOrbKind(level);
    const kindNode = doc.getElementById('level-panel-kind');
    if (kindNode) {
        kindNode.textContent = kind?.label || '';
        kindNode.hidden = !kind;
        if (kindNode.dataset) kindNode.dataset.kind = kind?.id || '';
    }
    setText(doc, 'level-panel-number', `Orb ${level.id}`);
    setText(doc, 'level-panel-name', level.pathLabel || level.name);
    setText(doc, 'level-panel-chapter', `Chapter ${level.chapter}${chapterName ? `: ${chapterName}` : ''}`);
    const description = level.description || level.metadata?.description || 'Clear the goal to move on.';
    setText(doc, 'level-panel-description', description);

    const starsNode = doc.getElementById('level-panel-stars');
    if (starsNode) {
        starsNode.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
        if (starsNode.dataset) starsNode.dataset.earned = stars > 0 ? 'true' : 'false';
        starsNode.ariaLabel = `${stars} of 3 stars earned`;
        starsNode.setAttribute?.('aria-label', `${stars} of 3 stars earned`);
    }

    renderOdysseyPanelCharms(doc, level, charms);

    setText(doc, 'level-panel-goal', formatOdysseyMapObjective(played.victory?.primary));
    const starGoals = ['one', 'two', 'three'].map((tier, index) => (
        played.stars?.[tier] ? `${index + 1} ★ ${formatOdysseyStarCondition(played.stars[tier], index, played.victory?.bonuses)}` : null
    )).filter(Boolean);
    fillList(doc, 'level-panel-star-goals', starGoals);
    const starGoalsLabel = doc.getElementById('level-panel-star-goals-label');
    if (starGoalsLabel) starGoalsLabel.hidden = starGoals.length === 0;

    // What this orb asks that the orb before it did not; a fresh selection shows its rules.
    const briefing = getOdysseyLevelBriefing(played, playedBefore);
    const rules = previousLevel ? briefing.changes : briefing.rules;
    fillList(doc, 'level-panel-rules', rules);
    const rulesLabel = doc.getElementById('level-panel-rules-label');
    if (rulesLabel) {
        rulesLabel.textContent = previousLevel ? 'What changes here' : 'Rules';
        rulesLabel.hidden = rules.length === 0;
    }

    const tipNode = doc.getElementById('level-panel-tip');
    if (tipNode) {
        tipNode.textContent = level.metadata?.tip || '';
        tipNode.hidden = !level.metadata?.tip;
    }

    const lockNode = doc.getElementById('level-panel-lock');
    if (lockNode) {
        lockNode.textContent = unlocked ? '' : `Locked · clear orb ${level.id - 1} to open this one.`;
        lockNode.hidden = unlocked;
    }

    const playBtn = doc.getElementById('level-panel-play-btn');
    if (playBtn) {
        playBtn.disabled = !unlocked;
        if (!unlocked) playBtn.textContent = 'Locked';
        else playBtn.textContent = completion ? 'Play again' : 'Play';
    }
}
