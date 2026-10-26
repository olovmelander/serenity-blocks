/**
 * @fileoverview The game's one icon set: own-designed line SVGs, never emojis or stock icons.
 *
 * Every glyph inherits the element's text colour (`stroke: currentColor`). Use `csIcon(name)`
 * to get an `<svg>` string for innerHTML, `csIconEl(name)` for a DOM node, or `csIconInner(name)`
 * for the shapes alone when a surface builds its own `<svg>` (mp-sheet.js, the Odyssey orb art).
 * All icons share a 24×24 viewBox, 1.8 stroke, round caps/joins, so they read as one family.
 *
 * Keystone glyphs: the icons that name a place in the game (the modes, the menu dock and play
 * rail, the Hub's sections) are each a line form completed by one solid rounded tile, the coral
 * block that completes the logo's O. The tile (`.cs-tile`) takes the icon's colour; menus may
 * animate it locking in. The lotus stays the Serenity Hub's mark without one. Static copies in
 * index.html must match these (tests/unit/keystone-glyphs.test.js).
 */

/** The solid tile: 5 units square on the 24 grid unless a glyph needs it smaller. */
const tile = (x, y, s = 5) => `<rect class="cs-tile" x="${x}" y="${y}" width="${s}" height="${s}" rx="${Math.round(s * 27) / 100}" fill="currentColor" stroke="none"/>`;
/** A hollow tile, drawn inside the same square so it lines up with a solid one. */
const hollowTile = (x, y, s = 5) => `<rect x="${Math.round((x + 0.45) * 100) / 100}" y="${Math.round((y + 0.45) * 100) / 100}" width="${Math.round((s - 0.9) * 100) / 100}" height="${Math.round((s - 0.9) * 100) / 100}" rx="${Math.round(s * 24) / 100}"/>`;

const PATHS = {
    /* Keystone glyphs: one solid tile each */
    'mode-single': `<path d="M13 3.5H10.5A7 7 0 0 0 3.5 10.5v3a7 7 0 0 0 7 7h3a7 7 0 0 0 7-7V11"/>${tile(15.5, 3.5)}`,
    'mode-infinity': '<path d="M5 21.5V10M19 21.5V10M5 21.5h14"/><path d="M5 6.8v-.01M5 3.8v-.01M19 6.8v-.01M19 3.8v-.01"/>'
        + `<path d="M8.6 12.4h6.8" opacity=".5"/>${tile(9.5, 14.8)}`,
    'mode-stillfall': `<path d="M2.5 15.5h7v5h5v-5h7"/><path d="M12 10.8v.01M12 13.2v.01"/>${tile(9.5, 2.8)}`,
    'mode-local': '<path d="M3 4.5v14a1.8 1.8 0 0 0 1.8 1.8h4.4A1.8 1.8 0 0 0 11 18.5v-14M13 4.5v14a1.8 1.8 0 0 0 1.8 1.8h4.4a1.8 1.8 0 0 0 1.8-1.8v-14"/>'
        + `${tile(4.6, 14, 4.8)}${hollowTile(14.6, 9.2, 4.8)}`,
    'mode-online': '<path d="M8 6v12.5a1.8 1.8 0 0 0 1.8 1.8h4.4a1.8 1.8 0 0 0 1.8-1.8V6"/>'
        + '<path d="M4.6 8.5a7 7 0 0 0 0 7M19.4 8.5a7 7 0 0 1 0 7M1.8 6.2a10.5 10.5 0 0 0 0 11.6M22.2 6.2a10.5 10.5 0 0 1 0 11.6"/>'
        + `${tile(9.6, 13.7, 4.8)}`,
    'mode-serenity': `<circle cx="12" cy="12" r="9"/><path d="M3.6 15c2.8-2.2 5.6-2.2 8.4 0s5.6 2.2 8.4 0"/>${tile(12.6, 6.2, 4.4)}`,
    'mode-hale': `<path d="M2 19c3.6 0 4.8-7.5 10-7.5S18.4 19 22 19"/>${tile(9.5, 3.5)}`,
    'mode-odyssey': '<path d="M4.5 19.5c5 0 3.5-6 7.5-6s3-5.5 5.5-6.5" stroke-dasharray="0.1 2.7"/>'
        + `<circle cx="4.5" cy="19.5" r="1.7" fill="currentColor"/><circle cx="12" cy="13.5" r="1.7" fill="currentColor"/>${tile(16, 2.5)}`,
    records: `<path d="M2.5 20.5h19M4 20.5v-5h5M15 20.5V17h5v3.5M9 20.5V10.5h6v10"/>${tile(9.5, 3)}`,
    replays: `<path d="M20 12a8 8 0 1 1-2.35-5.65"/><path d="M20 4v5h-5"/>${tile(9.5, 9.5)}`,
    settings: `<path d="M3 7.5h9.5M17.5 7.5h3.5M3 16.5h3M11.5 16.5H21"/>${hollowTile(6.5, 14)}${tile(12.5, 5)}`,
    themes: '<path d="M13 4H7.5A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5V11"/>'
        + `<path d="M4.6 16.4l4-3.7 3.4 3 2.4-2 5 4"/>${tile(15.5, 3.5)}`,
    breathing: `<circle cx="12" cy="12" r="6.6"/><circle cx="12" cy="12" r="10" stroke-dasharray="0.1 3.1"/>${tile(9.5, 9.5)}`,
    note: `<path d="M15.2 15.5V4.2c2.2.4 4 1.7 4.8 3.8"/>${tile(9.4, 13.8, 5.8)}`,

    /* nature / calm */
    wave: '<path d="M2 9.3c1.8-2.4 3.6-2.4 5.4 0s3.6 2.4 5.4 0 3.6-2.4 5.4 0"/><path d="M2 14.7c1.8-2.4 3.6-2.4 5.4 0s3.6 2.4 5.4 0 3.6-2.4 5.4 0"/>',
    moon: '<path d="M20.5 14.8A8.5 8.5 0 1 1 9.2 3.5 6.6 6.6 0 0 0 20.5 14.8Z"/>',
    leaf: '<path d="M5 19c0-8 6.5-14 14.5-14 0 8-6.5 14-14.5 14Z"/><path d="M5.5 18.5C10 14 13.5 11 17 9"/>',
    tree: '<path d="M12 22v-7"/><path d="M12 15c-3.3 0-5.5-2-5.5-5a5.5 5.5 0 0 1 11 0c0 3-2.2 5-5.5 5Z"/>',
    flower: '<circle cx="12" cy="12" r="2.4"/><path d="M12 9.6c-1.2-1.7-1.2-3.6 0-5.1 1.2 1.5 1.2 3.4 0 5.1Z"/><path d="M12 14.4c1.2 1.7 1.2 3.6 0 5.1-1.2-1.5-1.2-3.4 0-5.1Z"/><path d="M9.6 12c-1.7-1.2-3.6-1.2-5.1 0 1.5 1.2 3.4 1.2 5.1 0Z"/><path d="M14.4 12c1.7-1.2 3.6-1.2 5.1 0-1.5 1.2-3.4 1.2-5.1 0Z"/>',
    cloud: '<path d="M7 18h10a3.6 3.6 0 0 0 .3-7.2A5 5 0 0 0 7.6 9.3 3.6 3.6 0 0 0 7 18Z"/>',
    mist: '<path d="M4 8h13"/><path d="M6 12h12"/><path d="M4 16h10"/>',

    /* energy / fire */
    bolt: '<path d="M13.5 2 4.5 13.5H11l-1 8.5 9-11.5h-6.5l1-8.5Z"/>',
    flame: '<path d="M12 3C9 6.5 10.5 9 9.4 11c-.6-.6-1-1.6-1-1.6C7 11 7 12.8 7.4 14a5 5 0 0 0 9.6-1.9c0-3.6-2.5-5.6-5-9.1Z"/>',
    star: '<path d="M12 2.6l2.7 5.6 6.1.8-4.4 4.3 1.1 6.1L12 16.5l-5.5 2.9 1.1-6.1-4.4-4.3 6.1-.8L12 2.6Z"/>',
    'match-start': '<path class="cs-match-start-body" d="M6 18.7c.5-2.8 1.8-5.3 4-7.5l5.3-5.3c1.1-1.1 2.8-1.8 4.5-1.7.1 1.7-.6 3.4-1.7 4.5L12.8 14c-2.2 2.2-4.7 3.5-6.8 4.7Z"/><path class="cs-match-start-fin" d="M10.1 11.1 6.9 10.4 4 13.3l3.8 1.2"/><path class="cs-match-start-fin" d="M12.9 13.9l.9 3.7-2.9 2.9-1.1-3.6"/><circle class="cs-match-start-window" cx="16.3" cy="7.7" r="1.25"/><path class="cs-match-start-flame" d="M5.3 18.8 3.4 20.7M6.9 20.2l-.6 1.5M3.8 17.2l-1.5.6"/>',
    crown: '<path class="cs-crown-band" d="M5.2 18.5h13.6l1.1-9.3-4.2 3.2L12 5.2l-3.7 7.2-4.2-3.2 1.1 9.3Z"/><path class="cs-crown-rim" d="M6.1 20.2h11.8"/>',
    /** The crown's band alone, for surfaces that fill it (the Odyssey orb art). */
    'crown-solid': '<path d="M5.2 18.5h13.6l1.1-9.3-4.2 3.2L12 5.2l-3.7 7.2-4.2-3.2 1.1 9.3Z"/>',
    trophy: '<path class="cs-trophy-cup" d="M7 4.5h10v4.2c0 3-2.1 5.4-5 5.4s-5-2.4-5-5.4V4.5Z"/><path class="cs-trophy-handle" d="M7 7H4.8a2.2 2.2 0 0 0 0 4.4H7M17 7h2.2a2.2 2.2 0 0 1 0 4.4H17"/><path class="cs-trophy-base" d="M12 14.1v3.2M8.7 20h6.6M10 17.3h4"/>',
    'chart-up': '<path class="cs-chart-frame" d="M4.5 19.5h15M4.5 19.5v-15"/><path class="cs-chart-line" d="M6.2 15.5 10 11.7l2.8 2.2 4.9-7.1"/><path class="cs-chart-point" d="M17.7 6.8h-3.1M17.7 6.8v3.1"/>',
    'crossed-swords': '<path class="cs-sword-a" d="M5 5l14 14M4 8l4-4M3.5 4.5l2-2M16 19l3-3"/><path class="cs-sword-b" d="M19 5 5 19M16 4l4 4M20.5 4.5l-2-2M8 19l-3-3"/>',
    skull: '<path class="cs-skull-head" d="M7 16.5V19h10v-2.5c1.4-1 2.2-2.6 2.2-4.7 0-4.1-2.9-7.2-7.2-7.2s-7.2 3.1-7.2 7.2c0 2.1.8 3.7 2.2 4.7Z"/><circle class="cs-skull-eye" cx="9.2" cy="12" r="1.1"/><circle class="cs-skull-eye" cx="14.8" cy="12" r="1.1"/><path class="cs-skull-nose" d="M12 14.2 11.2 16h1.6L12 14.2Z"/><path class="cs-skull-teeth" d="M9.5 19v-2M12 19v-2M14.5 19v-2"/>',
    'line-stack': '<rect class="cs-lines-block cs-lines-block-a" x="4" y="6" width="3.8" height="12" rx="1"/><rect class="cs-lines-block cs-lines-block-b" x="10.1" y="3.5" width="3.8" height="14.5" rx="1"/><rect class="cs-lines-block cs-lines-block-c" x="16.2" y="9" width="3.8" height="9" rx="1"/><path class="cs-lines-base" d="M3.5 20.5h17"/>',
    burst: '<path class="cs-burst-core" d="M12 8.5 14 11l3.2-.6-1.4 2.9 1.9 2.6-3.2.3-1.6 2.8-1.9-2.6-3.2.5 1.4-2.9-1.9-2.6 3.2-.3L12 8.5Z"/><path class="cs-burst-rays" d="M12 2.8v3M12 18.2v3M3.2 12h3M17.8 12h3M5.7 5.7l2.1 2.1M16.2 16.2l2.1 2.1M18.3 5.7l-2.1 2.1M7.8 16.2l-2.1 2.1"/>',
    inbox: '<path class="cs-inbox-tray" d="M4.5 12.5 6.4 5.5h11.2l1.9 7v5.2a1.8 1.8 0 0 1-1.8 1.8H6.3a1.8 1.8 0 0 1-1.8-1.8v-5.2Z"/><path class="cs-inbox-slot" d="M4.8 12.5h4.1l1.2 2.3h3.8l1.2-2.3h4.1"/><path class="cs-inbox-arrow" d="M12 4.2v6.2M9.4 8l2.6 2.6L14.6 8"/>',
    chain: '<path class="cs-chain-a" d="M9.8 7.3 11 6.1a4.1 4.1 0 0 1 5.8 5.8l-1.8 1.8a4.1 4.1 0 0 1-5.8 0"/><path class="cs-chain-b" d="M14.2 16.7 13 17.9a4.1 4.1 0 0 1-5.8-5.8L9 10.3a4.1 4.1 0 0 1 5.8 0"/>',
    folder: '<path d="M3.5 7.5h6l1.7 2h9.3v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z"/><path d="M3.5 7.5V6a2 2 0 0 1 2-2h4.2l1.7 2h7.1a2 2 0 0 1 2 2v1.5"/>',
    home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.5V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.5"/><path d="M9.8 20.5v-5.5h4.4v5.5"/>',
    /** Quit the desktop game (src/ui/desktop-quit.js). An action, not a place: no tile. */
    power: '<path d="M12 3.8v7.4"/><path d="M7.1 6.6a7.2 7.2 0 1 0 9.8 0"/>',
    potato: '<path class="cs-potato-body" d="M8 18.4c-2.6-1.8-3.3-5.8-1.6-9.1s5.3-4.9 8.6-3.9c3.6 1.1 5.3 4.8 3.8 8.3-1.7 4.1-7 6.8-10.8 4.7Z"/><path class="cs-potato-eye" d="M9.2 10.3h.01M13.9 8.5h.01M15.2 13.6h.01M10.8 15.2h.01"/><path class="cs-potato-spark" d="M18 4.2l1.2-1.7M20 6.2l2-.2"/>',
    bomb: '<circle class="cs-bomb-body" cx="11" cy="13" r="6.2"/><path class="cs-bomb-fuse" d="M15.2 8.8 17.5 6.5M17.5 6.5c1.3-1.3 2.5-1.3 3.7 0"/><path class="cs-bomb-spark" d="M21.3 3.4v2.1M20.2 4.5h2.1"/>',

    /* mind / structure */
    square: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
    triangle: '<path d="M12 4.5 20.5 19.5H3.5L12 4.5Z"/>',
    heart: '<path d="M12 20.3S3.5 15.4 3.5 9.6A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 8.5 2.2c0 5.8-8.5 10.7-8.5 10.7Z"/>',
    lotus: '<path d="M12 5.3c-1.6 1.3-2.5 3.1-2.5 5.2 0 1.2.4 2.4 1 3.3"/><path d="M12 5.3c1.6 1.3 2.5 3.1 2.5 5.2 0 1.2-.4 2.4-1 3.3"/><path d="M7.4 9.6c-1.3.7-2.4 1.8-3 3.4 1.3.3 2.8.1 4.1-.7"/><path d="M16.6 9.6c1.3.7 2.4 1.8 3 3.4-1.3.3-2.8.1-4.1-.7"/><path d="M4.1 16.9c2.4 1.7 5 2.5 7.9 2.5s5.5-.8 7.9-2.5"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="12" cy="12" r="0.6"/>',
    gem: '<path d="M6 4h12l3 5-9 11L3 9l3-5Z"/><path d="M3 9h18"/><path d="M9 4 6.5 9 12 20M15 4l2.5 5L12 20"/>',
    balance: '<path d="M12 4v16"/><path d="M6 7l12-1.6"/><path d="M8.5 20h7"/><path d="M6 7 3.6 12.4a3 3 0 0 0 4.8 0L6 7Z"/><path d="M18 5.4 15.6 10.8a3 3 0 0 0 4.8 0L18 5.4Z"/>',
    butterfly: '<path d="M12 6.6v10.8"/><path d="M12 8.6C9.5 4.2 4 5.1 4.6 9.6 5.1 13.5 9.5 15 12 11.1"/><path d="M12 8.6C14.5 4.2 20 5.1 19.4 9.6 18.9 13.5 14.5 15 12 11.1"/>',
    shield: '<path d="M12 3 5.5 5.8v4.7c0 4 2.7 6.7 6.5 8.5 3.8-1.8 6.5-4.5 6.5-8.5V5.8L12 3Z"/>',
    sprout: '<path d="M12 21v-9"/><path d="M12 13C9 13 7 11 7 8c3 0 5 2 5 5Z"/><path d="M12 11c0-2.8 2-4.8 5-4.8 0 3-2 4.8-5 4.8Z"/>',

    /* breath / motion / time */
    breath: '<path d="M3 8h10.4a2.5 2.5 0 1 0-2.5-2.6"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h9.4a2.5 2.5 0 1 1-2.5 2.6"/>',
    cycle: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4.5V10H15"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',

    /* breathing techniques */
    'aurora-dreams': '<path d="M5.2 19c2-4.6-.7-8.5 1.6-14"/><path d="M12 20c-2.2-4.4-1.3-9.1 1.2-15"/><path d="M18.8 19c-2-4.6.7-8.5-1.6-14"/><path d="M4.5 14c4.6-2.4 10.4-2.4 15 0"/><path d="M6.2 6.2h.01M18.3 6.8h.01"/>',
    'sacred-geometry': '<path d="M12 3.8 18.9 7.8v8.4L12 20.2l-6.9-4V7.8L12 3.8Z"/><path d="M12 7.3 16.6 15H7.4L12 7.3Z"/><circle cx="12" cy="12.6" r="1.8"/>',
    'moonlit-waters': '<path d="M17.2 6.8A5 5 0 0 1 11.1 3a6.2 6.2 0 0 0 5.6 10"/><path d="M4 15.6c1.7-1.7 3.5-1.7 5.2 0s3.5 1.7 5.2 0 3.5-1.7 5.2 0"/><path d="M5.2 19c1.2-.8 2.4-.8 3.6 0s2.4.8 3.6 0 2.4-.8 3.6 0"/>',
    'solar-flare': '<circle cx="12" cy="12" r="3.7"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/><path d="M14.7 3.1c.9 1.9 2.3 2.8 4.5 2.8M20.9 14.5c-2 .8-3 2.3-3 4.5"/>',
    'heart-glow': '<path d="M12 19.3S4.8 15.2 4.8 10.3A3.7 3.7 0 0 1 12 8.4a3.7 3.7 0 0 1 7.2 1.9c0 4.9-7.2 9-7.2 9Z"/><path d="M12 3.1v2M5.1 6.3 3.6 4.9M18.9 6.3l1.5-1.4M6.2 19.6l1.4-1.2M17.8 19.6l-1.4-1.2"/>',
    'crystal-prism': '<path d="M12 3.4 19.4 8l-7.4 12.6L4.6 8 12 3.4Z"/><path d="M4.6 8h14.8"/><path d="M8.4 8 12 20.6 15.6 8"/><path d="M12 3.4 8.4 8M12 3.4 15.6 8"/><path d="M19.1 5.2 21 3.6M20 12.1l2.2.6M4.9 5.2 3 3.6"/>',
    'volcanic-fire': '<path d="M4.2 20h15.6l-4.5-9-3.3 4.1L8.7 11 4.2 20Z"/><path d="M12 3.5c1.9 2.1 1.9 4.2 0 6.2-1.9-2-1.9-4.1 0-6.2Z"/><path d="M8.6 20c.5-2.7 1.7-4.3 3.4-5.1 1.7.8 2.9 2.4 3.4 5.1"/>',
    'ocean-tide': '<path d="M3.6 15.6c2.3-5 7.1-7.2 12-5.3 1.7.7 3 .4 3.9-.6-.4 3.5-3.2 5.5-6.7 4.8"/><path d="M4 19c1.8-1.8 3.6-1.8 5.4 0s3.6 1.8 5.4 0 3.6-1.8 5.4 0"/><path d="M8.8 13c1.5.5 2.5 1.4 3 2.7"/>',
    'zen-garden': '<path d="M4 9.2c4.2-2.1 9.1-2.1 16 0"/><path d="M4 13.1c4.2-2.1 9.1-2.1 16 0"/><path d="M4 17c4.2-2.1 9.1-2.1 16 0"/><ellipse cx="8" cy="17.2" rx="2.4" ry="1.4"/><path d="M16 6.7 19.3 3.7M18.5 7.9 21 5.6"/>',
    'cosmic-nebula': '<ellipse cx="12" cy="12" rx="8.7" ry="3.1" transform="rotate(-28 12 12)"/><ellipse cx="12" cy="12" rx="5.5" ry="2" transform="rotate(28 12 12)"/><circle cx="12" cy="12" r="1.3"/><path d="M5.3 7.4h.01M18.5 6.9h.01M19.1 16.5h.01M7 18h.01"/>',
    'ancient-forest': '<path d="M12 20.8v-7.2"/><path d="M8.4 20.8v-4.6M15.6 20.8v-4.6"/><path d="M12 13.8c-3.2 0-5.4-1.8-5.4-4.6a5.4 5.4 0 0 1 10.8 0c0 2.8-2.2 4.6-5.4 4.6Z"/><path d="M9.6 10.2h.01M14.4 10.2h.01M6 20.8h12"/>',
    'electric-storm': '<path d="M7 13.5h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.8-1.2A3.8 3.8 0 0 0 7 13.5Z"/><path d="M12.5 13.5 9.8 19H14l-1.4 3 4-5.3h-3.5l1.3-3.2"/><path d="M4.2 17.2 2.5 19M20.4 15.8l1.6 1.5"/>',

    /* serenity sessions */
    'hale-base': '<circle cx="12" cy="12" r="8.2"/><path d="M6.5 10.2c1.8-1.7 3.6-1.7 5.4 0s3.6 1.7 5.4 0"/><path d="M6.5 14.2c1.8-1.7 3.6-1.7 5.4 0s3.6 1.7 5.4 0"/><path d="M12 6.5v2M12 15.8v1.7"/>',
    'hale-elixir': '<path d="M12 3.2c3.2 3.7 5.2 6.5 5.2 9.1a5.2 5.2 0 0 1-10.4 0c0-2.6 2-5.4 5.2-9.1Z"/><path d="M13.2 7.6 9.8 13h3.1l-.8 4 3.7-5.7h-3.1l.5-3.7Z"/>',
    'hale-rest': '<path d="M18.6 8.2a5.4 5.4 0 0 1-6.8-4.1 7 7 0 1 0 6.6 11.1"/><path d="M5.2 17.4c1.8-1.4 3.6-1.4 5.4 0s3.6 1.4 5.4 0"/><path d="M19 5.2h.01"/>',
    'hale-flow': '<rect x="5.2" y="5.2" width="13.6" height="13.6" rx="4"/><path d="M8.4 11.2a4.2 4.2 0 0 1 7-2.3"/><path d="M15.4 8.9V6.6h2.3"/><path d="M15.6 12.8a4.2 4.2 0 0 1-7 2.3"/><path d="M8.6 15.1v2.3H6.3"/>',

    /* media / controls */
    play: '<path d="M7 5v14l11-7L7 5Z"/>',
    pause: '<rect x="7" y="5" width="3.4" height="14" rx="1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1"/>',
    prev: '<path d="M18 5v14l-9-7 9-7Z"/><path d="M7 5v14"/>',
    next: '<path d="M6 5v14l9-7-9-7Z"/><path d="M17 5v14"/>',
    volume: '<path d="M11 5 6.5 9H3v6h3.5l4.5 4V5Z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>',
    mute: '<path d="M11 5 6.5 9H3v6h3.5l4.5 4V5Z"/><path d="M22 9.5l-5 5"/><path d="M17 9.5l5 5"/>',
    equalizer: '<path d="M6 19v-7"/><path d="M12 19V5"/><path d="M18 19v-10"/>',
    gamepad: '<path d="M7.2 8.6h9.6c2.4 0 3.9 1.7 4.3 4.2l.3 2.4c.2 1.6-.7 2.7-2 2.7-.8 0-1.5-.4-2.2-1.2l-1-1.1H7.8l-1 1.1c-.7.8-1.4 1.2-2.2 1.2-1.3 0-2.2-1.1-2-2.7l.3-2.4c.4-2.5 1.9-4.2 4.3-4.2Z"/><path d="M7.2 11.6v3.1M5.7 13.2h3M15.6 12.7h.01M18.1 14.1h.01"/>',
    gear: '<path d="M9.45 5.48L10.21 2.98L13.79 2.98L14.55 5.48L14.81 5.59L17.11 4.35L19.65 6.89L18.41 9.19L18.52 9.45L21.02 10.21L21.02 13.79L18.52 14.55L18.41 14.81L19.65 17.11L17.11 19.65L14.81 18.41L14.55 18.52L13.79 21.02L10.21 21.02L9.45 18.52L9.19 18.41L6.89 19.65L4.35 17.11L5.59 14.81L5.48 14.55L2.98 13.79L2.98 10.21L5.48 9.45L5.59 9.19L4.35 6.89L6.89 4.35L9.19 5.59Z"/><circle cx="12" cy="12" r="2.8"/>',

    /* landscape / weather (theme thumbnails) */
    mountain: '<path d="M2.5 19 9 7.5l3.2 5.8 2.3-3.6L21.5 19H2.5Z"/><path d="M7.4 11 9 8.2l1.6 2.8"/>',
    snowflake: '<path d="M12 2v20M3.34 7 20.66 17M20.66 7 3.34 17"/><path d="M12 6 9.7 7.6M12 6l2.3 1.6M12 18l-2.3-1.6M12 18l2.3 1.6"/><path d="M5.4 8.3 5 11M5.4 8.3 8 8M18.6 15.7 19 13M18.6 15.7 16 16M5.4 15.7 8 16M5.4 15.7 5 13M18.6 8.3 16 8M18.6 8.3 19 11"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.1 5.1 6.9 6.9M17.1 17.1l1.8 1.8M18.9 5.1 17.1 6.9M6.9 17.1 5.1 18.9"/>',
    sunrise: '<path d="M3 18.5h18"/><path d="M7.5 18.5a4.5 4.5 0 0 1 9 0"/><path d="M12 3.5V6M4.5 8 6.2 9.7M19.5 8l-1.7 1.7M1.5 13.5H4M20 13.5h2.5"/>',
    rain: '<path d="M7 13.5h9a3.4 3.4 0 0 0 .4-6.8A4.8 4.8 0 0 0 7.1 5.5 3.5 3.5 0 0 0 7 13.5Z"/><path d="M8.5 16.5 7.5 19M12 16.5 11 19M15.5 16.5 14.5 19"/>',
    droplet: '<path d="M12 3.5c3.4 4.4 5.4 7.2 5.4 9.8a5.4 5.4 0 0 1-10.8 0c0-2.6 2-5.4 5.4-9.8Z"/><path d="M9.4 13.6a2.6 2.6 0 0 0 1.8 2.4"/>',
    aurora: '<path d="M3.5 5C5.5 9 5.5 14.5 4 19.5M8.5 3.8C10.5 8.5 10 14 9 20M14 4C16 8.7 15.6 14 14.6 20M19.5 5C21.5 9 21 14.5 19.7 19.5"/>',
    galaxy: '<ellipse cx="12" cy="12" rx="9" ry="3.4" transform="rotate(-28 12 12)"/><circle cx="12" cy="12" r="1.5"/><path d="M6 8.2h.01M18 15.8h.01M16 7h.01"/>',
    spiral: '<path d="M12 12a1.6 1.6 0 1 1 1.6 1.6 3.6 3.6 0 1 1-3.6-3.6 5.6 5.6 0 1 1 5.6 5.6 7.6 7.6 0 1 1-7.6-7.6"/>',
    island: '<path d="M7 17.5c0-2.4 1.2-4.5 5-4.5s5 2.1 5 4.5"/><path d="M12 13V6.5"/><path d="M12 6.5C9.8 6.5 8.4 5.3 8 3.8c2.2.3 3.6 1.3 4 2.7ZM12 6.5c2.2 0 3.6-1.2 4-2.7-2.2.3-3.6 1.3-4 2.7Z"/><path d="M3.5 20.5c2.5 1 14.5 1 17 0"/>',
    temple: '<path d="M12 3 3.5 8.5h17L12 3Z"/><path d="M5 8.5V14M9 8.5V14M15 8.5V14M19 8.5V14"/><path d="M4 14h16"/><path d="M6 14v4.5M18 14v4.5M12 14v4.5"/><path d="M3 20.5h18"/>',
    city: '<path d="M3 20.5h18"/><path d="M5 20.5V9.5h5v11M13 20.5V5h6v15.5"/><path d="M6.7 12.5h1.6M6.7 15.5h1.6M14.7 8h2.6M14.7 11h2.6M14.7 14h2.6M14.7 17h2.6"/>',
    bamboo: '<path d="M9.5 3v18M14.5 3v18"/><path d="M9 8h1M14 8h1M9 13h1M14 13h1"/><path d="M9.5 6C8 6 6.8 4.8 6.5 3.5 8 3.8 9.2 4.7 9.5 6ZM14.5 16c1.5 0 2.7 1.2 3 2.5-1.5-.3-2.7-1.2-3-2.5Z"/>',

    /* creatures / objects (theme thumbnails) */
    wolf: '<path d="M5.5 4 8 8.2M18.5 4 16 8.2"/><path d="M8 7.5C6.3 9.7 5.8 12.4 7 15c1 2.3 2.9 3.4 5 3.4s4-1.1 5-3.4c1.2-2.6.7-5.3-1-7.5"/><path d="M9.7 12.3h.01M14.3 12.3h.01"/><path d="M12 14.6 10.8 16M12 14.6 13.2 16"/>',
    fish: '<path d="M3 12c2.5-4 7.5-5.5 11.5-2.5C16 10.5 17 12 17 12s-1 1.5-2.5 2.5C10.5 17.5 5.5 16 3 12Z"/><path d="M17 12c1.8-1.8 4-2.4 4-2.4s-.6 2.4 0 4.8c0 0-2.2-.6-4-2.4Z"/><path d="M7 11.4h.01"/>',
    jellyfish: '<path d="M5.5 12a6.5 6.5 0 0 1 13 0v.5h-13V12Z"/><path d="M7.5 13c-.2 2.5-1 4.5-2 6.5M11 13l-.4 7M13 13l.4 7M16.5 13c.2 2.5 1 4.5 2 6.5"/>',
    bowl: '<path d="M3.5 11.5h17l-2 5.2A4 4 0 0 1 14.8 19H9.2a4 4 0 0 1-3.7-2.3l-2-5.2Z"/><path d="M8.5 11.5c0-2.8 7-2.8 7 0"/><path d="M17.5 11 19 5.5"/>',
    chime: '<path d="M4.5 4.5h15"/><path d="M8 4.5v8.5M12 4.5v10.5M16 4.5v8.5"/><circle cx="8" cy="15.5" r="1.5"/><circle cx="12" cy="17.5" r="1.5"/><circle cx="16" cy="15.5" r="1.5"/>',
    lantern: '<path d="M9 3h6M12 3v2.5"/><path d="M7.5 8.5C7.5 6.6 9.5 5.5 12 5.5s4.5 1.1 4.5 3v6c0 1.9-2 3-4.5 3s-4.5-1.1-4.5-3v-6Z"/><path d="M10 5.7v11.6M14 5.7v11.6"/><path d="M12 18.5V21"/>',
    candle: '<path d="M12 3.2c1.6 1.7 1.6 3.3 0 5-1.6-1.7-1.6-3.3 0-5Z"/><path d="M12 8.2v1.8"/><rect x="9" y="10" width="6" height="10.5" rx="1"/>',
    palette: '<path d="M12 3.2c-5 0-9 3.6-9 8.3 0 3 2.2 4.8 4.6 4.8 1.4 0 2.2-.8 2.2-2 0-.6-.2-1 .2-1.6.4-.6 1-.8 1.8-.8H15c3 0 5-2 5-4.8 0-2.5-3.5-3.9-8-3.9Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="15.5" cy="9.5" r="1"/>',
    dice: '<rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/><circle cx="9" cy="9" r="1.1"/><circle cx="15" cy="9" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="9" cy="15" r="1.1"/><circle cx="15" cy="15" r="1.1"/>',

    /* misc */
    check: '<path d="M20 6 9 17l-5-5"/>',

    /* utilities: conventional on purpose (multiplayer sheets, settings, toasts) */
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    headphones: '<path d="M4.5 15.5V13a7.5 7.5 0 0 1 15 0v2.5"/><rect x="3.5" y="14" width="4.5" height="6.5" rx="1.6"/><rect x="16" y="14" width="4.5" height="6.5" rx="1.6"/>',
    sliders: '<path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9"/><rect x="13" y="5.5" width="4" height="4" rx="1.2"/><rect x="7" y="14.5" width="4" height="4" rx="1.2"/>',
    display: '<rect x="3.5" y="4.5" width="17" height="11.5" rx="2.4"/><path d="M9 20h6M12 16v4"/>',
    visual: '<path d="M11 3.5 12.9 8l4.6 1.9-4.6 1.9L11 16.4l-1.9-4.6-4.6-1.9L9.1 8 11 3.5Z"/><path d="M17.8 14.4l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z"/>',
    keyboard: '<rect x="3.5" y="6.5" width="17" height="11" rx="2.2"/><path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M7 13.6h.01M10.2 13.6h6.8"/>',
    tip: '<path d="M9 18h6M10 21h4"/><path d="M8.2 14.1a5.2 5.2 0 1 1 7.6 0c-.8.8-1.2 1.5-1.35 2.35h-4.9c-.15-.85-.55-1.55-1.35-2.35Z"/><path d="M12 6.4v3.1"/>',
    code: '<path d="m9 7-5 5 5 5m6-10 5 5-5 5m-2-14-2 18"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    back: '<path d="M19 12H5.5"/><path d="M11 18l-6-6 6-6"/>',
    chevron: '<path d="M9.5 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    watch: '<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.7"/>',
    join: '<path d="M13.5 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4"/><path d="M9.5 16l4-4-4-4"/><path d="M13.5 12h-9"/>',
    dropin: '<path d="M12 3.5v9"/><path d="M8.2 9l3.8 3.8L15.8 9"/><rect x="4.5" y="16" width="15" height="4.5" rx="1.2"/>',
    copy: '<rect x="9" y="9" width="10.5" height="10.5" rx="2"/><path d="M5.5 14.5V6.5a2 2 0 0 1 2-2h8"/>',
    send: '<path d="M20.5 3.5 3.5 10.6l6.8 2.6 2.6 6.8 7.6-16.5Z"/><path d="M10.3 13.2l4.4-4.4"/>',
    human: '<circle cx="12" cy="8" r="3.5"/><path d="M5 19.8c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>',
    bot: '<rect x="5" y="8.2" width="14" height="11" rx="3"/><path d="M12 4.6v3.6"/><circle cx="12" cy="3.7" r=".9"/><path d="M9.4 13.2h.01M14.6 13.2h.01"/><path d="M10 16.3h4"/>',
    invite: '<circle cx="9.5" cy="8" r="3.4"/><path d="M3.5 19.8c.7-3.4 3.2-5.3 6-5.3 1.4 0 2.7.4 3.8 1.2"/><path d="M18 12.5v6M15 15.5h6"/>',
    leave: '<path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10"/><path d="M15 16l4-4-4-4"/><path d="M19 12H9.5"/>',
    remove: '<circle cx="9.5" cy="8" r="3.4"/><path d="M3.5 19.8c.7-3.4 3.2-5.3 6-5.3 1.6 0 3 .5 4.1 1.5"/><path d="M16 13.5l5 5M21 13.5l-5 5"/>',
    search: '<circle cx="11" cy="11" r="6.3"/><path d="M15.8 15.8 20.5 20.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5Z"/>',
    people: '<circle cx="9" cy="8.5" r="3.1"/><path d="M3.2 19.5c.6-3.1 2.9-5 5.8-5s5.2 1.9 5.8 5"/><circle cx="16.6" cy="9.4" r="2.5"/><path d="M15.8 14.6c2.6-.3 4.6 1.2 5.2 4"/>',
    rematch: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/><path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15"/><path d="M4.5 19.5V15H9"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2"/><path d="M12 7.9h.01"/>',
    alert: '<path d="M12 4.3 20.6 19.4H3.4L12 4.3Z"/><path d="M12 10.2v4.2"/><path d="M12 16.9h.01"/>',
    error: '<circle cx="12" cy="12" r="8.5"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
};

/** One drawing per thing: these names are the same glyph under the words other surfaces use. */
PATHS.refresh = PATHS.cycle;
PATHS.audio = PATHS.volume;

/**
 * @param {string} name  icon key (falls back to lotus)
 * @param {number} [size=22] px width/height
 * @param {string} [cls=''] extra class on the svg
 * @returns {string} inline <svg> markup
 */
export function csIcon(name, size = 22, cls = '') {
    const inner = PATHS[name] || PATHS.lotus;
    return `<svg class="cs-icon${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** DOM-node variant. */
export function csIconEl(name, size = 22, cls = '') {
    const span = document.createElement('span');
    span.innerHTML = csIcon(name, size, cls);
    return span.firstChild;
}

/**
 * A glyph's shapes without the `<svg>`, for a surface that builds its own element.
 * @param {string} name icon key (falls back to lotus)
 * @returns {string}
 */
export function csIconInner(name) {
    return PATHS[name] || PATHS.lotus;
}

export const COSMIC_ICON_NAMES = Object.keys(PATHS);
