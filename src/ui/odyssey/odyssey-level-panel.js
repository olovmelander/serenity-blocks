/**
 * The map's orb panel: what an orb is, what it asks for, what each star needs, and what changes
 * from the orb before it. This is the briefing a player reads before pressing Play from the map,
 * so a rule change (a taller well, a deadline, cascade physics) is never a surprise on arrival.
 * Pure DOM by id; the mode owns selection, prefetch and the Play button.
 */
import { formatOdysseyMapObjective, formatOdysseyStarCondition } from './objective-copy.js';
import { getOdysseyLevelBriefing } from './odyssey-level-briefing.js';

/** The kind of orb, as the map marks it: a rival duel, the chapter's boss, a showcase, or none. */
export function describeOdysseyOrbKind(level) {
    if (!level) return null;
    if (level.mechanics?.versus) {
        return { id: 'rival', label: `Rival duel · ${level.mechanics.versus.botName || 'Rival'}` };
    }
    if (level.role === 'boss') {
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

function fillList(doc, id, items) {
    const list = doc.getElementById(id);
    if (!list) return;
    list.replaceChildren?.();
    if (!list.replaceChildren) list.innerHTML = '';
    items.forEach((text) => {
        const item = doc.createElement('li');
        item.textContent = text;
        list.appendChild(item);
    });
    list.hidden = items.length === 0;
}

/**
 * @param {object} options
 * @param {object} options.level the resolved presentation of the selected orb
 * @param {object|null} [options.previousLevel] the orb before it on the route
 * @param {object|null} [options.completion] the saved completion, if any
 * @param {boolean} options.unlocked whether the orb can be played now
 * @param {string} [options.chapterName]
 * @param {Document} [doc]
 */
export function renderOdysseyLevelPanel({
    level, previousLevel = null, completion = null, unlocked = false, chapterName = '',
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

    setText(doc, 'level-panel-goal', formatOdysseyMapObjective(level.victory?.primary));
    const starGoals = ['one', 'two', 'three'].map((tier, index) => (
        level.stars?.[tier] ? `${index + 1} ★ ${formatOdysseyStarCondition(level.stars[tier], index)}` : null
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
