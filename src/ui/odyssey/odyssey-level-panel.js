/**
 * The map's orb panel: what an orb is, what it asks for, what each star needs, and what changes
 * from the orb before it. This is the briefing a player reads before pressing Play from the map,
 * so a rule change (a taller well, a deadline, cascade physics) is never a surprise on arrival.
 * One read-only line names the charms held that help here. Pure DOM by id; the mode owns
 * selection, prefetch, the Play button and the charm bag.
 */
import { formatOdysseyMapObjective, formatOdysseyStarCondition } from './objective-copy.js';
import { getOdysseyLevelBriefing } from './odyssey-level-briefing.js';
import { odysseyCharmHelps } from '../../core/odyssey/odyssey-charm-bag.js';
import { describeOdysseyPanelCharms } from './odyssey-charm-copy.js';
import { createOdysseyCharmIconNode } from './odyssey-charm-icon-stage.js';

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
 * The charm line: the charms held that do something on this orb, or nothing. Read-only; the
 * charms are used during the orb, never chosen here.
 * @param {Document} doc
 * @param {object} level the authored orb
 * @param {readonly { id: string, name: string, count: number }[] | null} charms the bag
 */
export function renderOdysseyPanelCharms(doc, level, charms) {
    const hint = doc.getElementById('level-panel-charm-hint');
    if (!hint) return;
    const line = describeOdysseyPanelCharms(charms, level);
    hint.textContent = line || '';
    hint.hidden = !line;
    if (!line || typeof hint.prepend !== 'function') return;
    // The helping charms' live icons ahead of the words.
    const icons = (charms || [])
        .filter((entry) => entry.count > 0 && odysseyCharmHelps(level, entry.id))
        .map((entry) => createOdysseyCharmIconNode(entry.id))
        .filter(Boolean);
    if (icons.length) hint.prepend(...icons);
}

/**
 * @param {object} options
 * @param {object} options.level the resolved presentation of the selected orb
 * @param {object|null} [options.previousLevel] the orb before it on the route
 * @param {object|null} [options.completion] the saved completion, if any
 * @param {boolean} options.unlocked whether the orb can be played now
 * @param {string} [options.chapterName]
 * @param {readonly { id: string, name: string, count: number }[] | null} [options.charms] the bag, for one
 *   read-only line naming the charms held that help here
 * @param {Document} [doc]
 */
export function renderOdysseyLevelPanel({
    level, previousLevel = null, completion = null, unlocked = false, chapterName = '', charms = null,
}, doc = globalThis.document) {
    if (!level || !doc) return;
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

    setText(doc, 'level-panel-goal', formatOdysseyMapObjective(level.victory?.primary));
    const starGoals = ['one', 'two', 'three'].map((tier, index) => (
        level.stars?.[tier] ? `${index + 1} ★ ${formatOdysseyStarCondition(level.stars[tier], index, level.victory?.bonuses)}` : null
    )).filter(Boolean);
    fillList(doc, 'level-panel-star-goals', starGoals);
    const starGoalsLabel = doc.getElementById('level-panel-star-goals-label');
    if (starGoalsLabel) starGoalsLabel.hidden = starGoals.length === 0;

    // What this orb asks that the orb before it did not; a fresh selection shows its rules.
    const briefing = getOdysseyLevelBriefing(level, previousLevel);
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
