/**
 * The three star goals of a finished orb, each marked earned or not, with the next star's
 * shortfall in the player's own numbers. The completion ceremony and the results sheet show
 * the same list, so a player always learns why an attempt earned the stars it did.
 */
import { el } from './keystone-sheet.js';
import { describeOdysseyStarOutcome, formatOdysseyNextStar } from './objective-copy.js';

function setData(node, name, value) {
    if (node?.dataset) node.dataset[name] = String(value);
}

/**
 * @param {object} level the finished orb's resolved config
 * @param {object} results the attempt's final results, including the engine's star count
 * @param {{ className?: string }} [options]
 * @returns {{ list: HTMLElement, words: string[], readingWords: string[], outcome: object }|null}
 *   the list to mount, every line of its text, and the lines a player reads rather than scans
 */
export function createOdysseyStarNotes(level, results, { className = 'ody-star-notes' } = {}) {
    if (!level?.stars || !results) return null;
    const outcome = describeOdysseyStarOutcome(level, results);
    if (!outcome.tiers.length) return null;
    const list = el('ul', className);
    list.ariaLabel = 'Star goals';
    const words = [];
    outcome.tiers.forEach((tier) => {
        const item = el('li', `${className}__tier${tier.earned ? ' is-earned' : ''}`);
        setData(item, 'tier', tier.tier);
        setData(item, 'earned', tier.earned);
        const glyph = el('span', `${className}__glyph`, tier.earned ? '✦' : '·');
        glyph.ariaHidden = 'true';
        item.appendChild(glyph);
        item.appendChild(el('span', `${className}__label`, tier.label));
        item.ariaLabel = `${tier.label}: ${tier.earned ? 'earned' : 'not earned'}`;
        list.appendChild(item);
        words.push(tier.label);
    });
    const next = formatOdysseyNextStar(outcome);
    const readingWords = [];
    if (next) {
        const item = el('li', `${className}__next`, next);
        setData(item, 'next', true);
        list.appendChild(item);
        words.push(next);
        readingWords.push(next);
    }
    return {
        list, words, readingWords, outcome,
    };
}
