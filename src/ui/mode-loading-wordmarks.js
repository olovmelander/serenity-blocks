// Mode titles share the original logo's custom alphabet, not its game name.
const WORDMARKS = {
    'SINGLE PLAYER': ['single-player', 532, 244],
    MULTIPLAYER: ['multiplayer', 532, 264],
    INFINITY: ['infinity', 538, 104],
    SERENITY: ['serenity', 652, 104],
    ODYSSEY: ['odyssey', 628, 104],
};

export function getModeLoadingWordmark(title) {
    let mode = title;
    let eyebrow = '';
    let variant = '';
    if (title === 'ONLINE MULTIPLAYER' || title === 'LOCAL MULTIPLAYER') {
        mode = 'MULTIPLAYER';
        eyebrow = title.split(' ')[0];
    } else if (['FREE-FOR-ALL', 'LAST STANDING', 'HOT POTATO'].includes(title)) {
        mode = 'MULTIPLAYER';
        eyebrow = 'LOCAL';
        variant = title;
    }
    const wordmark = WORDMARKS[mode];
    if (!wordmark) return null;
    const [file, width, height] = wordmark;
    return {
        src: `./assets/branding/modes/${file}.svg`,
        width,
        height,
        wide: height < 150,
        label: mode,
        eyebrow,
        variant,
    };
}
