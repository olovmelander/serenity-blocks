/**
 * Every Odyssey orb's player-facing words: its name, the description on its card and the tip
 * under its goals. This table is the only place they live; levels.js holds the rules.
 *
 * Keyed by the orb's theme, because every orb has its own world and a world travels with its
 * orb when the campaign is reordered. A new world needs new words: the copy test fails until
 * an orb's theme has an entry here. Find an orb's rules in levels.js by the same theme id.
 *
 * How the words are written (tests/unit/odyssey-orb-copy.test.js holds the checkable parts):
 * - Name: a few words, unique in the campaign, that fit the world you see.
 * - Description: what you see, then what the orb asks of you, in two short sentences that fit
 *   the navigator card's two lines on a 1366×768 screen (108 characters at most). No numbers:
 *   the goal and star lines below it carry those, and they change when an orb is retuned.
 * - Tip: practical advice for this orb's rules, in one or two sentences.
 * - Speak to the player, in plain US English. Never describe the design ("a release beat",
 *   "a reset level"), and never claim a place in the journey ("the finale") unless the orb
 *   ends its chapter. Pace and speed claims must match the orb's real drop speed.
 * - A rival's description names the rival and says how it plays (src/core/ai/bot-difficulty.js).
 */
export const ODYSSEY_ORB_COPY = Object.freeze({
    // Chapter 1 · Earth Core & Subterranean Origins
    'cinder-drift': {
        name: 'Ashen Dawn',
        description: 'A lava lake drifts beneath walls of black basalt, deep under the crust. '
            + 'Settle in and find your rhythm.',
        tip: 'Keep the stack flat with one column open, so your clears come two or three lines at a time.',
    },
    'crystal-cave': {
        name: 'Crystal Cascade',
        description: 'Crystals glow along a hall of rock above a still pool. '
            + 'This is where you learn to make the blocks cascade.',
        tip: 'Leave gaps under your overhangs. When a line clears, the blocks above fall into the gaps '
            + 'and can clear again.',
    },
    geode: {
        name: 'Geode Heart',
        description: 'Jewel crystals line a hollow geode around a glowing agate heart. '
            + 'Practice cascades until they feel easy.',
        tip: 'Build in layers rather than one tall tower, so every clear leaves blocks ready to fall into a gap.',
    },
    bioluminescence: {
        name: 'The Living Grotto',
        description: 'Mushrooms glow around a still pool in a cave that makes its own light. '
            + 'Clear lines and let cascades help.',
        tip: 'Turn the starting rows into your first cascades, then keep the stack low with steady line clears.',
    },
    pyrestorm: {
        name: 'Molten Flow',
        description: 'Lava rivers run below an erupting volcano. '
            + 'Cinder, your first rival, plays slowly and makes mistakes.',
        tip: 'A double sends one row, a triple two and a Quad three. Cinder is slow, so keep the pressure on.',
    },

    // Chapter 2 · Deep Ocean & Liquid Worlds
    ocean: {
        name: 'Ocean Descent',
        description: 'Light wanders over a reef canyon as whales pass in the blue. '
            + 'Dig out of the opening rows, then settle in.',
        tip: 'Clear the opening rows first, then keep one column open for a Quad: four lines with one piece.',
    },
    'luminous-tides': {
        name: 'Night Surf',
        description: 'Waves break blue with glowing plankton on a dark beach. '
            + 'Chain your cascades and the surf burns brighter.',
        tip: 'Build staggered shelves instead of tall spikes. Two- and three-wave chains are safer than one '
            + 'big gamble.',
    },
    'koi-pond': {
        name: 'Koi Sanctuary',
        description: 'Koi rise through a moonlit garden pond beside a stone lantern. '
            + 'Stack cleanly and keep the lines coming.',
        tip: 'Use the preview to plan your next pieces, and keep one column open for multi-line clears.',
    },
    stillwater: {
        name: 'Tarn of Wisps',
        description: 'A spirit and a troll with a lantern keep watch across a dark tarn. '
            + 'Chain cascades to draw them together.',
        tip: 'Stack shelves that can fall into the gaps below them, so one clear sets off the next.',
    },
    waves: {
        name: 'Wave Runner',
        description: 'The low sun shines through the barrel of a breaking wave. '
            + 'Your rival, Coral, plays steadily but still slips.',
        tip: 'Keep your stack low enough to take Coral\'s rows, then hit back with a Quad.',
    },

    // Chapter 3 · Surface World & Living Landscapes
    grainfields: {
        name: 'Grainfields',
        description: 'Sunbeams break through a storm over ripe barley and Lapporten, the Lapland gate. '
            + 'Breathe and stack cleanly.',
        tip: 'Pieces fall faster as you clear. Keep the stack low early, while there is still time to place '
            + 'each piece well.',
    },
    spring: {
        name: 'Spring Flood',
        description: 'A northern river runs high with the spring melt, past meadows white with anemones. '
            + 'Keep an easy rhythm.',
        tip: 'Let the rapids set your pace: steady drops, clean lines, and every clear carried away downstream.',
    },
    'golden-forest': {
        name: 'Golden Reflection',
        description: 'Spruce and pine stand mirrored in a Nordic lake at golden hour. '
            + 'Clear piece after piece to grow your score.',
        tip: 'Each clearing piece in a row raises the multiplier, and a piece that clears nothing resets it. '
            + 'Plan your runs.',
    },
    'moonlit-greenhouse': {
        name: 'Glasshouse Reverie',
        description: 'Moonlight slants through a glass palm house where moths circle the lanterns. '
            + 'Build cascades calmly.',
        tip: 'Build one layer at a time, leaving a gap under each shelf for the blocks above to drop into.',
    },
    tornado: {
        name: 'Gathering Storm',
        description: 'A tornado touches down beyond a wheat field under a turning storm. '
            + 'Clear your lines before time runs out.',
        tip: 'Speed matters, but panic costs more runs than the clock. Stay compact and keep one column open.',
    },
    fall: {
        name: 'Amber Grove',
        description: 'Amber leaves drift through an enchanted autumn grove. '
            + 'No clock, no hurry: build clean and wait for Quads.',
        tip: 'Keep the stack flat with one column open, and use that column only for Quads.',
    },
    'halcyon-apex': {
        name: 'Halcyon Ascension',
        description: 'A dawn lagoon mirrors a temple and the crystal floating over it. '
            + 'Chain cascades and the sanctuary rises.',
        tip: 'The tall well leaves room for long chains. Build upward in shelves and keep the gaps beneath '
            + 'them open.',
    },
    summer: {
        name: 'Summer Glow',
        description: 'A summer evening by the lake, with a maypole in the meadow. '
            + 'Your rival, Willow, thinks a move ahead.',
        tip: 'Send your rows when Willow\'s stack is already high, and keep your own low enough to absorb the '
            + 'answer.',
    },

    // Chapter 4 · Mountains & Thin-Air Ascension
    'sakura-twilight': {
        name: 'Blossom Foothills',
        description: 'Cherry trees bloom over a moonlit mirror lake below the mountains. '
            + 'Build your score before the climb.',
        tip: 'Clear the opening rows first, then keep clears coming piece after piece to build the multiplier.',
    },
    'verdant-hills': {
        name: 'Verdant Rise',
        description: 'Wind combs the grassy hills past an old oak and a white windmill. '
            + 'The tall well gives cascades room to grow.',
        tip: 'Tall wells reward patience. Build shelves, not spikes, so every clear feeds the next.',
    },
    'ice-temple': {
        name: 'Ice Temple',
        description: 'Ice columns rise from a frozen lake and ring with every piece you place. '
            + 'Build your score steadily.',
        tip: 'Keep the stack clean early, then build toward Quads; they are worth the most.',
    },
    wolfhour: {
        name: 'Alpine Night',
        description: 'Wolves cross the moonlit snow above a lone hut\'s warm window. '
            + 'Each clear can set the ledges sliding.',
        tip: 'Work from the lower shelves first so the upper layers always have somewhere safe to fall.',
    },
    'himalayan-peak': {
        name: 'Everest Ascent',
        description: 'Prayer flags snap on a high pass at first light, above a sea of cloud. '
            + 'Race the clock to the top.',
        tip: 'The pieces start fast. Take safe doubles and triples rather than waiting too long for a Quad.',
    },
    'high-coast': {
        name: 'The High Coast',
        description: 'Red granite cliffs rise over a pine archipelago on the High Coast. '
            + 'Keep clearing and let the land rise.',
        tip: 'Use the calmer pace to set up runs of clears instead of forcing risky rescues.',
    },
    sunfall: {
        name: 'Garden Under Stone',
        description: 'Sunlight falls through a cave\'s roof onto a hidden jungle. '
            + 'Chain cascades and the cave breathes out clouds.',
        tip: 'The well is deep. Keep two or three shelves going so one clear can set off the next.',
    },
    winter: {
        name: 'Winter Trial',
        description: 'An arctic fox runs over the snow as the aurora burns. '
            + 'Your rival, Frost, is quick and rarely slips.',
        tip: 'Frost answers quickly. Keep your stack low so incoming rows cannot push you over the top.',
    },

    // Chapter 5 · Sky & Atmospheric Drift
    sunset: {
        name: 'Lantern Sky',
        description: 'Paper lanterns ride a sunset sea, and every clear lifts one into the sky. '
            + 'Build cascades and score big.',
        tip: 'Use the extra height to smooth the board before you cash in on big clears.',
    },
    starlight: {
        name: 'Mirror of Stars',
        description: 'The Milky Way wheels over a mirror-still lake, and every piece adds a star. '
            + 'Keep the board light.',
        tip: 'Let the stack stay low and take efficient clears as they come.',
    },
    aurora: {
        name: 'Aurora Passage',
        description: 'Aurora curtains sway over snowy peaks and a mirror lake; every clear strums them. '
            + 'Precision beats force.',
        tip: 'Take clean doubles and triples to keep the multiplier alive until a Quad opens up.',
    },
    'nimbus-veil': {
        name: 'Nimbus Veil',
        description: 'Golden cloud tops roll beneath you at sunset, crossed by beams and mist. '
            + 'Build measured cascades.',
        tip: 'Think in layers. Gentle, repeatable cascades beat one overbuilt tower.',
    },
    sunbraid: {
        name: 'The Turning Suns',
        description: 'Three colored suns wheel over a pale valley, and every shadow takes a color. '
            + 'The pieces fall fast.',
        tip: 'Chains spin the suns faster. Keep the stack low and take every clear the light offers.',
    },
    parhelion: {
        name: 'Ice Halo',
        description: 'A standing stone hides the sun inside a halo with two sundogs. '
            + 'Reach the goal, then play on for stars.',
        tip: 'Secure the goal first; after that, every extra cascade and deeper chain counts toward your stars.',
    },
    lunara: {
        name: 'Atmosphere\'s End',
        description: 'Twin moons rise over a valley of crystal spires, with a ringed world beyond. '
            + 'Score big at the edge of space.',
        tip: 'Turn the opening rows into cascades early, then keep clears coming piece after piece to grow '
            + 'the multiplier.',
    },
    'rainbow-terraces': {
        name: 'Where Color Falls',
        description: 'Waterfalls spill from floating terraces into open sky. '
            + 'Your rival, Zephyr, reacts fast and seldom slips.',
        tip: 'Keep up a steady stream of doubles and triples so Zephyr never gets the time to build.',
    },

    // Chapter 6 · Space & Cosmic Expanse
    galaxy: {
        name: 'Galaxy Core',
        description: 'A spiral galaxy leans across the dark, its core burning beside the well. '
            + 'No clock; let the score build.',
        tip: 'Clear piece after piece to raise the multiplier, and save your Quads for when it is high.',
    },
    'cosmic-noir': {
        name: 'Cosmic Nocturne',
        description: 'A pulsar sweeps its beams through smoke like a black-and-white lighthouse. '
            + 'Build cascades in the dark.',
        tip: 'Layer the board so each clear can feed the next cascade.',
    },
    supernova: {
        name: 'Stellar Flare',
        description: 'A giant star burns inside the glowing shells it shed. '
            + 'Dig out of the opening rows and keep the stack low.',
        tip: 'Quick drops leave little room for repairs. Dig clean escape routes, use the preview and stay '
            + 'compact.',
    },
    'blood-moon': {
        name: 'Blood Moon',
        description: 'Earth\'s shadow turns the moon red above a mirror of salt. '
            + 'Keep your chains composed against the clock.',
        tip: 'Look beneath the top layer for the next cascade, and keep clearing to hold the multiplier.',
    },
    'void-ember': {
        name: 'Dying Ember',
        description: 'A dying star glows like a banked coal, fire in the cracks of its crust. Keep the score climbing.',
        tip: 'The pieces start fast. Keep clears flowing; a piece that clears nothing resets the multiplier.',
    },
    'aether-tides': {
        name: 'Aether Surge',
        description: 'A river of glowing gas winds between two stars and bends to their pull. '
            + 'The pieces fall fast: keep moving.',
        tip: 'A Quad clears four lines with one piece. The fastest way through is almost always the cleanest.',
    },
    'astral-weave': {
        name: 'Loom of Heaven',
        description: 'A great hoop hangs in a nebula, and every piece throws a thread of light across it. '
            + 'Find a steady rhythm.',
        tip: 'Steady scoring keeps you on course. The loom rewards rhythm over risk.',
    },
    'shifting-sands': {
        name: 'Twin-Sun Dunes',
        description: 'Twin suns set over alien dunes as something vast breaches the crests. '
            + 'Cross them with deliberate lines.',
        tip: 'The pieces start fast and only get faster. Keep the stack open and take wide clears to keep '
            + 'moving.',
    },
    'vesper-chrysalis': {
        name: 'Celestial Chrysalis',
        description: 'A crystal chrysalis hangs over a still lake at dusk, waiting to hatch. '
            + 'Build your score at your own pace.',
        tip: 'There is no countdown. Let the stack settle and choose clean scoring routes.',
    },
    'stellar-drift': {
        name: 'Silent Drift',
        description: 'A ringed giant fills the sky as you drift past two far moons. '
            + 'No clock, no rush: build your score in peace.',
        tip: 'Set up clean stacks and wait for the clears that score the most.',
    },
    'solar-eclipse': {
        name: 'Eclipse Horizon',
        description: 'The moon covers the sun, its corona streaming over range after range of mountains. '
            + 'Time is short.',
        tip: 'Start cascades in the opening rows right away. With this little time, every clear has to score.',
    },
    rainbark: {
        name: 'The Painted Giants',
        description: 'Colossal painted trees rise from glowing mist, a rare pocket of quiet. '
            + 'No clock: just clear your lines.',
        tip: 'Bring the stack down first, then rebuild it flat with one column open for multi-line clears.',
    },
    'black-hole': {
        name: 'The Singularity',
        description: 'A black hole bends starlight and swallows every piece you lock. '
            + 'Reach the goal, then play on for stars.',
        tip: 'The opening rows run deep. Work steady cascades out of them, and save the long chains for after '
            + 'the goal.',
    },
    'stellar-velocity': {
        name: 'Comet Chase',
        description: 'You race down a canyon of glowing cloud toward a far sun. '
            + 'Your rival, Nova, is fast and almost never slips.',
        tip: 'Nova punishes a tall stack. Trade small attacks early and save a cascade to answer a big one.',
    },

    // Chapter 7 · Black Hole & Abstract Transcendence
    'fluid-dreams': {
        name: 'Fluid Dreams',
        description: 'Drops of liquid light merge and pinch apart over a violet sea. '
            + 'Let the score build as reality softens.',
        tip: 'Trust the score game you already know. The visuals change; the discipline stays the same.',
    },
    'nebula-flow': {
        name: 'Star Cradle',
        description: 'Pillars of dust glow where young stars are born. '
            + 'Feed the nursery with cascades before the clock runs out.',
        tip: 'Dig into the opening rows for cascades, and keep every piece clearing while the multiplier climbs.',
    },
    'chiral-gold': {
        name: 'Golden Convergence',
        description: 'Two towers of braided gold turn in opposite directions over still black water. '
            + 'A sprint at very high speed.',
        tip: 'High speed demands a clear plan. Trust the preview, keep the well open and favor multi-line clears.',
    },
    'voltage-storm': {
        name: 'Voltage Storm',
        description: 'Lightning towers stand in a flooded plain under a thunderhead. Charge the storm with cascades.',
        tip: 'Use the full height, but do not overbuild. The best storm boards are structured, not chaotic.',
    },
    murmuration: {
        name: 'Murmuration',
        description: 'A swarm of light wheels through a dark nebula, gathering into shapes. '
            + 'Steady speed: dig out and breathe.',
        tip: 'Do not race the board. Let each cascade finish before you commit to the next shape.',
    },
    'serenity-warp': {
        name: 'Serenity Passage',
        description: 'Glass pieces of the game itself drift on the current into a wormhole. '
            + 'A calm, tall well for cascades.',
        tip: 'Use the starting shelves to rehearse layered cascades. There is no timer; leave room for the '
            + 'next piece.',
    },
    kaleidosonic: {
        name: 'Indra\'s Net',
        description: 'A temple of folded light folds deeper with every cascade you make. '
            + 'Reach the goal, then play on for stars.',
        tip: 'Use the full height of the well. The taller the structure, the longer the cascade.',
    },
    'chromatic-impasto': {
        name: 'Chromatic Impasto',
        description: 'Thick oil paint swirls under a studio lamp. '
            + 'Your rival, Prism, thinks two pieces ahead and loves a combo.',
        tip: 'Prism attacks in bursts. Keep your stack low between them and answer with cascades of your own.',
    },

    // Chapter 8 · Urban Dreams Encore
    'chromadelic-highway': {
        name: 'Chromadelic Gateway',
        description: 'A prism-glass highway of rainbow light races through a neon cosmos. '
            + 'Find your speed and enjoy the ride.',
        tip: 'Use the opening clears to set your pace. Confidence beats panic here.',
    },
    'neon-dusk': {
        name: 'Neon Dusk',
        description: 'A great sun sinks between neon mountains, mirrored in a floor of glass and light. '
            + 'Build a steady score.',
        tip: 'Keep clears coming piece after piece; on a score goal, the multiplier does the heavy lifting.',
    },
    'neon-district': {
        name: 'Rainlit Streets',
        description: 'Rain-soaked streets mirror a city of glowing signs. Reach the goal, then play on for stars.',
        tip: 'Treat the opening rows like fuel. Turn them into cascades fast, then keep the multiplier alive '
            + 'as long as you can.',
    },
    'synthwave-sunset': {
        name: 'Last Light',
        description: 'The sun sets behind a lit ferris wheel at the end of the pier. '
            + 'Neon, your last rival, almost never slips.',
        tip: 'Do not trade blow for blow. Keep your stack low, absorb what Neon sends, and strike back with '
            + 'cascades.',
    },
});

/** The copy for an orb, found by its world; null when the world has none yet. */
export function getOdysseyOrbCopy(level) {
    const themeId = level?.theme?.primary;
    return (themeId && ODYSSEY_ORB_COPY[themeId]) || null;
}

/**
 * Dress each orb in its words. Runs last, after the campaign is assembled, so the words that
 * ship are exactly the ones in the table. An orb whose world has no entry keeps what it has.
 * @param {ReadonlyArray<object>} levels the assembled campaign
 * @returns {object[]}
 */
export function applyOdysseyOrbCopy(levels) {
    return levels.map((level) => {
        const copy = getOdysseyOrbCopy(level);
        if (!copy) return level;
        return {
            ...level,
            name: copy.name,
            metadata: { ...level.metadata, description: copy.description, tip: copy.tip },
        };
    });
}
