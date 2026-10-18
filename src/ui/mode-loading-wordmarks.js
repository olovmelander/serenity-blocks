// Mode titles share the original logo's custom alphabet, not its game name.
const WORDMARKS = {
    'SINGLE PLAYER': ['single-player', 532, 244],
    'LOCAL VERSUS': ['local-versus', 540, 254],
    'ONLINE VERSUS': ['online-versus', 540, 245],
    INFINITY: ['infinity', 538, 104],
    SERENITY: ['serenity', 652, 104],
    ODYSSEY: ['odyssey', 628, 104],
    STILLFALL: ['stillfall', 704, 104],
};

/**
 * The lettering for a loading title. "LOCAL VERSUS · TEAMS · HOT POTATO" is the mode's
 * wordmark, then how this match is played on the line below it.
 */
export function getModeLoadingWordmark(title) {
    const [mode, ...variant] = String(title || '').split(' · ');
    const wordmark = WORDMARKS[mode];
    if (!wordmark) return null;
    const [file, width, height] = wordmark;
    return {
        src: `./assets/branding/modes/${file}.svg`,
        width,
        height,
        wide: height < 150,
        label: mode,
        variant: variant.join(' · '),
    };
}
