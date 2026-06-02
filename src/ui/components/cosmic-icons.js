/**
 * @fileoverview Cosmic Serenity icon set — clean line SVGs used in place of emojis.
 *
 * The game never uses emojis; every glyph is an own-designed inline SVG that
 * inherits the element's text colour (`stroke: currentColor`). Use `csIcon(name)`
 * to get an `<svg>` string for innerHTML, or `csIconEl(name)` for a DOM node.
 *
 * All icons share a 24×24 viewBox, 1.8 stroke, round caps/joins, so they read as
 * one coherent family at any size.
 */

const PATHS = {
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
    star: '<path d="M12 3.5l2.4 5.3 5.6.5-4.3 3.8 1.3 5.6L12 16.6 7 18.7l1.3-5.6L4 9.3l5.6-.5L12 3.5Z"/>',

    /* mind / structure */
    square: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
    triangle: '<path d="M12 4.5 20.5 19.5H3.5L12 4.5Z"/>',
    heart: '<path d="M12 20.3S3.5 15.4 3.5 9.6A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 8.5 2.2c0 5.8-8.5 10.7-8.5 10.7Z"/>',
    lotus: '<path d="M12 20.4c-4.6 0-7.6-2.6-7.6-2.6s2-4.6 7.6-4.6 7.6 4.6 7.6 4.6-3 2.6-7.6 2.6Z"/><path d="M12 13.4c-2.5-1.6-2.5-4.7 0-6.7 2.5 2 2.5 5.1 0 6.7Z"/><path d="M12 13.4 6.6 9.8M12 13.4 17.4 9.8"/>',
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

    /* media / controls */
    note: '<path d="M9 18V6l9-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="15.5" cy="16" r="2.5"/>',
    play: '<path d="M7 5v14l11-7L7 5Z"/>',
    pause: '<rect x="7" y="5" width="3.4" height="14" rx="1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1"/>',
    prev: '<path d="M18 5v14l-9-7 9-7Z"/><path d="M7 5v14"/>',
    next: '<path d="M6 5v14l9-7-9-7Z"/><path d="M17 5v14"/>',
    volume: '<path d="M11 5 6.5 9H3v6h3.5l4.5 4V5Z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>',
    mute: '<path d="M11 5 6.5 9H3v6h3.5l4.5 4V5Z"/><path d="M22 9.5l-5 5"/><path d="M17 9.5l5 5"/>',
    equalizer: '<path d="M6 19v-7"/><path d="M12 19V5"/><path d="M18 19v-10"/>',
    gamepad: '<path d="M9 11H6M7.5 9.5v3"/><circle cx="15.5" cy="10.5" r="1"/><circle cx="18" cy="13" r="1"/><path d="M7 7.5h10a3.5 3.5 0 0 1 3.4 2.7l.9 4A2.3 2.3 0 0 1 17 16l-1.5-2h-7L7 16a2.3 2.3 0 0 1-4.3-1.8l.9-4A3.5 3.5 0 0 1 7 7.5Z"/>',

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
};

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

export const COSMIC_ICON_NAMES = Object.keys(PATHS);
