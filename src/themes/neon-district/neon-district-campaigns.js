/**
 * Neon District — what the district sells (CPU only, three-free).
 *
 * Three campaign families share every surface that advertises — the billboard screens, the
 * floodlit roof boards, the paste-up poster walls, the tube-neon logos, the shop fascias:
 *
 *  - District brands: the local businesses, named for what a player does on the board. Each has a
 *    mark, two colours and a slogan, runs the same campaign on every surface, and most keep a shop
 *    on the street — the noodle chain on the billboards has a noodle bar under them.
 *  - Hale: the breathing guide's own campaign, the calm spots in a loud street. Its screens breathe
 *    on the game's breath (4 s in, 6 s out) and with the guide's breath while a session runs.
 *  - Serenity Transit: travel adverts for the game's other worlds and modes, each poster made from
 *    a render of the world it sells.
 *
 * No real company, film or game is named or drawn anywhere here, and no mark is built from the
 * board's pieces (the product's branding keeps piece imagery out: tetris_legal_review.md).
 */

/** Interior archetypes a generated shop can have (the shop shader's room recipes). */
export const SHOP_ARCHETYPES = Object.freeze([
    'diner', // a counter with stools, menu boards, pendant lamps
    'laundry', // a wall of washer doors, a folding table
    'mart', // bright aisles of shelves, a fridge wall
    'arcade', // a dark room of glowing cabinets
    'boutique', // lit display shelves, spotlights, a display table
    'bar', // backlit bottle shelves, a bar counter
    'studio', // a gym: a mirror wall, a weight rack, machines on the floor
    'office', // a service counter with screens, racks behind
    'calm', // soft round lamps, wood slats, mats on an open floor
]);

export const archetypeIndex = (name) => Math.max(0, SHOP_ARCHETYPES.indexOf(name));

/** The light inside each archetype (scene-linear), what its room throws through the glass. */
export const ARCHETYPE_LIGHT = Object.freeze({
    diner: [1.0, 0.55, 0.25],
    laundry: [0.6, 0.74, 1.0],
    mart: [0.74, 1.0, 0.9],
    arcade: [0.75, 0.3, 1.0],
    boutique: [1.0, 0.8, 0.58],
    bar: [1.0, 0.42, 0.12],
    studio: [0.82, 0.9, 1.0],
    office: [0.5, 0.72, 1.0],
    calm: [0.45, 0.95, 0.85],
});

/** A logo's atlas index (−1: none). */
export { logoIndex } from './neon-district-logos.js';

/**
 * The district's brands. `a` is the brand colour, `b` its second colour (sRGB hex); `logo` names
 * the tube-neon mark (neon-district-logos.js); `shop` the archetype of the brand's own shops
 * (null: the brand has no shop on the street — it sells from vending machines and taxis).
 */
export const BRANDS = Object.freeze([
    {
        id: 'cascade', name: 'CASCADE COLA', short: 'CASCADE', slogan: 'LET IT FALL', a: 0xff3046, b: 0xfff1e0, logo: 'cascade', shop: null,
    },
    {
        id: 'combo', name: 'COMBO NOODLES', short: 'COMBO', slogan: 'KEEP THE CHAIN GOING', a: 0xffa53a, b: 0xff3a30, logo: 'combo', shop: 'diner',
    },
    {
        id: 'stack', name: 'STACK SAVINGS', short: 'STACK', slogan: 'BUILD ON SOLID GROUND', a: 0x3b7bff, b: 0xffc04a, logo: 'stack', shop: 'office',
    },
    {
        id: 'drop', name: 'DROP COURIERS', short: 'DROP', slogan: 'HARD AND FAST', a: 0x4dffb0, b: 0x0f3d2c, logo: 'drop', shop: 'office',
    },
    {
        id: 'level', name: 'LEVEL GYM', short: 'LEVEL', slogan: 'ONE MORE LEVEL', a: 0xff2d86, b: 0xffe14a, logo: 'level', shop: 'studio',
    },
    {
        id: 'next', name: 'NEXT TAXI', short: 'NEXT', slogan: 'ALWAYS ONE MORE COMING', a: 0xffd21a, b: 0x16130a, logo: 'next', shop: null,
    },
    {
        id: 'clear', name: 'CLEAR OPTICS', short: 'CLEAR', slogan: 'SEE EVERY LINE', a: 0x22e4ff, b: 0xd6f3ff, logo: 'clear', shop: 'boutique',
    },
    {
        id: 'spin', name: 'SPIN CYCLE', short: 'SPIN', slogan: 'WASH DRY FOLD', a: 0x9b5cff, b: 0x7af0ff, logo: 'spin', shop: 'laundry',
    },
]);

/** The breathing guide's campaign. */
export const HALE = Object.freeze({
    id: 'hale', name: 'HALE', short: 'HALE', slogan: 'BREATHE IN THE CITY', a: 0x7fe6d8, b: 0xc9b8ff, logo: 'hale', shop: 'calm',
});

/**
 * Serenity Transit: where the district's travel adverts send you. `theme` is a theme id from the
 * registry (or a mode), `name` what the poster calls it, `line` its strapline.
 */
export const TRANSIT = Object.freeze({
    id: 'transit',
    name: 'SERENITY TRANSIT',
    short: 'TRANSIT',
    a: 0xf2e6c8,
    b: 0x22e4ff,
    logo: 'transit',
});

/** Every campaign by id: the brands, Hale and the transit line. */
export const CAMPAIGNS = Object.freeze(Object.fromEntries([...BRANDS, HALE, TRANSIT].map((c) => [c.id, c])));

/**
 * Shops that are not a brand's: a trade word on the fascia and the room that goes with it. The
 * words are generic trades (SIGN_WORDS in the layout spells the same kind of thing on the blades).
 */
export const TRADE_SHOPS = Object.freeze([
    { name: 'RAMEN', shop: 'diner', a: 0xff3a30 },
    { name: 'SUSHI BAR', shop: 'diner', a: 0x22e4ff },
    { name: 'DUMPLINGS', shop: 'diner', a: 0xffa53a },
    {
        name: 'NIGHT CAFE', shop: 'diner', a: 0xff2d86, logo: 'coffee',
    },
    { name: '24H MART', shop: 'mart', a: 0x4dffb0 },
    {
        name: 'PHARMACY', shop: 'mart', a: 0x4dffb0, logo: 'cross',
    },
    { name: 'GROCERY', shop: 'mart', a: 0x22e4ff },
    {
        name: 'ARCADE', shop: 'arcade', a: 0x9b5cff, logo: 'joystick',
    },
    { name: 'VR LOUNGE', shop: 'arcade', a: 0x22e4ff },
    { name: 'PARTS', shop: 'boutique', a: 0xffa53a },
    { name: 'PAWN', shop: 'boutique', a: 0xffd21a },
    {
        name: 'TATTOO', shop: 'boutique', a: 0xff3a30, logo: 'heart',
    },
    {
        name: 'JAZZ BAR', shop: 'bar', a: 0x3b7bff, logo: 'note',
    },
    {
        name: 'KARAOKE', shop: 'bar', a: 0xff2d86, logo: 'note',
    },
    {
        name: 'COCKTAILS', shop: 'bar', a: 0x9b5cff, logo: 'cocktail',
    },
    { name: 'SAUNA', shop: 'calm', a: 0xffa53a },
    { name: 'CAPSULE HOTEL', shop: 'office', a: 0xd6f3ff },
]);

/**
 * Words a tube blade can spell for a campaign, in its colour: the street's neon carries the
 * brands too, not only the screens.
 */
export const BRAND_WORDS = Object.freeze([
    { word: 'CASCADE', id: 'cascade' }, { word: 'COLA', id: 'cascade' },
    { word: 'COMBO', id: 'combo' }, { word: 'NOODLES', id: 'combo' },
    { word: 'STACK', id: 'stack' }, { word: 'SAVINGS', id: 'stack' },
    { word: 'DROP', id: 'drop' }, { word: 'COURIERS', id: 'drop' },
    { word: 'LEVEL', id: 'level' }, { word: 'GYM', id: 'level' },
    { word: 'NEXT', id: 'next' }, { word: 'TAXI', id: 'next' },
    { word: 'CLEAR', id: 'clear' }, { word: 'OPTICS', id: 'clear' },
    { word: 'SPIN', id: 'spin' }, { word: 'LAUNDRY', id: 'spin' },
    { word: 'HALE', id: 'hale' }, { word: 'BREATHE', id: 'hale' },
    { word: 'TRANSIT', id: 'transit' },
]);

/** What the travel posters call their destinations (by the cell id after 'transit-'). */
export const TRANSIT_NAMES = Object.freeze({
    'koi-pond': 'KOI POND',
    'sakura-twilight': 'SAKURA TWILIGHT',
    'crystal-cave': 'CRYSTAL CAVE',
    'golden-forest': 'GOLDEN FOREST',
    summer: 'MIDSOMMAR',
    ocean: 'OCEAN',
    winter: 'WINTER',
    stillwater: 'STILLWATER',
    'mode-infinity': 'INFINITY',
    'mode-stillfall': 'STILLFALL',
    'mode-odyssey': 'ODYSSEY',
});

/** Lines the district's own screens run under adverts that are not a campaign's. */
export const DISTRICT_LINES = Object.freeze([
    'DISTRICT NEWS · RAIN ALL NIGHT',
    'NIGHT MARKET OPEN TILL DAWN',
    'TRAINS EVERY 4 MIN · LINE 7',
    'LIVE MUSIC TONIGHT · DISTRICT 9',
    'STAY DRY · STAY BRIGHT',
]);

/**
 * The ticker line under an advert: a brand's name and slogan, Hale's breath, the transit line's
 * next departure, or one of the district's own lines.
 */
export function tickerLine(cell, pick = 0) {
    const campaign = CAMPAIGNS[cell.brand];
    if (cell.family === 'brand' && campaign) return `${campaign.name} · ${campaign.slogan}`;
    if (cell.family === 'hale') return 'HALE · BREATHE IN THE CITY · INHALE 4 · EXHALE 6';
    if (cell.family === 'transit') {
        const key = String(cell.id || '').replace(/^transit-/, '');
        const name = TRANSIT_NAMES[key] || key.replace(/^mode-/, '').replace(/-/g, ' ').toUpperCase();
        return `SERENITY TRANSIT · NOW BOARDING: ${name}`;
    }
    return DISTRICT_LINES[Math.abs(Math.floor(pick)) % DISTRICT_LINES.length];
}

/** What hangs in a lit shop window, if anything. */
export const WINDOW_SIGNS = Object.freeze(['OPEN', '24H', 'OPEN LATE', 'WELCOME']);
