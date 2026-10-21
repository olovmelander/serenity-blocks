/**
 * @fileoverview Stillfall's words for a goal, shared by the panel beside the well
 * (stillfall-hud.js) and the puzzle atlas (stillfall-atlas.js).
 */

export const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four'];
/** "one", "two" … for the small counts the game names in words; larger counts stay digits. */
export const countWord = (count) => NUMBER_WORDS[count] || String(count);

/** "the relic", "both relics", "all three relics" */
export const theMarked = (count, one, many) => {
    if (count === 1) return `the ${one}`;
    return count === 2 ? `both ${many}` : `all ${countWord(count)} ${many}`;
};

export const capitalised = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** One goal in the panel's words. */
function partText(part) {
    if (part.type === 'waves') return `Set off a cascade ${plural(part.atLeast, 'wave', 'waves')} deep`;
    if (part.type === 'lines') return `Clear ${plural(part.atLeast, 'line', 'lines')}`;
    if (part.type === 'clear-all') return 'Empty the well';
    if (part.type === 'seal') return 'Break the seal';
    return 'Bring the relic to the floor';
}

/** The goal as one sentence: two or three goals are joined, the counts first. */
export function goalText(goal) {
    if (goal.type !== 'all') return partText(goal);
    const relics = goal.of.filter((part) => part.type === 'relic-floor').length;
    const seals = goal.of.filter((part) => part.type === 'seal').length;
    const phrases = goal.of.filter((part) => part.type !== 'relic-floor' && part.type !== 'seal').map(partText);
    if (relics) phrases.push(`bring ${theMarked(relics, 'relic', 'relics')} to the floor`);
    if (seals) phrases.push(`break ${theMarked(seals, 'seal', 'seals')}`);
    const words = phrases.map((phrase) => phrase.charAt(0).toLowerCase() + phrase.slice(1));
    const sentence = words.length > 2 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words.join(' and ');
    return capitalised(sentence);
}
