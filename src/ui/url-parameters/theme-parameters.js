/** URL readers in the production theme adapters. This is documentation, not a flag reader. */
const ON = '1, true, yes, on, or an empty value; other values disable (case-insensitive)';
const ON_SHORT = '1, true, yes, or an empty value; other values disable (case-insensitive)';
const PRESENCE = 'Any present value enables, including 0; remove the parameter to disable';
const PRESENT_UNLESS_FALSE = 'Any present value except the exact strings 0 and false enables';
const QUALITY = 'Minimal, Low, Medium, High, Ultra, Extreme (case-insensitive)';
const source = (id) => `src/themes/${id}/${id}-theme.js`;
const entry = (name, scope, description, values, defaultValue, example, sources, notes = '') => ({
    name,
    category: 'Themes',
    scope,
    description,
    values,
    defaultValue,
    example: `${name}=${example}`,
    sources,
    ...(notes ? { notes } : {}),
});
const toggle = (
    name,
    scope,
    description,
    sources,
    values = ON,
    notes = '',
) => entry(
    name,
    scope,
    description,
    values,
    'Off',
    '1',
    sources,
    notes,
);
const aliases = (names, scope, description, sources, values = ON, notes = '') => names.map((name) => toggle(
    name,
    scope,
    description,
    sources,
    values,
    `${notes}${notes ? ' ' : ''}Equivalent names: ${names.join(', ')}.`,
));
const numeric = (
    name,
    scope,
    description,
    values,
    defaultValue,
    example,
    sources,
    notes = '',
) => entry(
    name,
    scope,
    description,
    values,
    defaultValue,
    example,
    sources,
    notes,
);

const captureThemes = [
    ['aether-tides', 'aether', 'Aether Tides', 'nebula, stars, beams, stardust, cells'],
    ['astral-weave', 'astralWeave', 'Astral Weave', 'sky, rosette, wefts, warp, hoop, flares, sparks, dust'],
    ['bioluminescence',
        'biolum',
        'Bioluminescence',
        'backdrop, vault, floor, islets, spikes, water, pads, elder, parasols, bells, globes, crystals, '
        + 'worms, threads, vines, motes, jellies, spores, runners, jets'],

    ['chiral-gold',
        'chiralGold',
        'Chiral Gold',
        'sky, water, ring, towers, shafts, motes, leaf, sparks, blades, flares, braid, tally'],

    ['chromatic-impasto', 'chromaticImpasto', 'Chromatic Impasto', 'canvas, droplets, shadows, motes'],

    ['cinder-drift',
        'cinderDrift',
        'Cinder Drift',
        'columns, lake, shell, fissure, falls, smoke, shaft, embers, spatter, bombs, flashes, jets'],

    ['fluid-dreams',
        'fluidDreams',
        'Fluid Dreams',
        'liquid, motes, spray'],

    ['galaxy',
        'galaxy',
        'Galaxy',
        'sky, giants, jetFar, disc, stars, nurseries, jetNear, nucleus, meteors, sparks, seeds, beams'],

    ['geode', 'geode', 'Geode', 'shell, druzy, crystals, glints, beams, air, shards, wisps, rowBeams'],

    ['halcyon-apex',
        'halcyonApex',
        'Halcyon Apex',
        'sky, ranges, islets, flora, water, site, siteLey, dial, dialLey, crystals, halos, '
        + 'upfall, beads, motes, birds, sparks, beacons, wisps, beams'],

    ['himalayan-peak',
        'himalayan',
        'Himalayan Peak',
        'sky, massif, clouds, pass, shrine, cords, flags, spindrift, avalanche, papers, beams, dust, eagle'],

    ['ice-temple',
        'iceTemple',
        'Ice Temple',
        'sky, mountains, aurora, architecture, floor, crown, flake, mist, snow, dust, chips, beams'],

    ['koi-pond',
        'koi',
        'Koi Pond',
        'ground, stones, lantern, wood, leaves, iris, pads, lilies, floaters, koi, dragon, water, '
        + 'pools, fireflyMirror, mist, fireflies, spray'],

    ['lunara',
        'lunara',
        'Lunara',
        'sky, moon, companion, meteors, ranges, banks, water, crystals, glints, '
        + 'pillars, flowers, motes, shards, wisps, beams'],

    ['neon-district',
        'neonDistrict',
        'Neon District',
        'sky, mega, facades, street, shopfronts, signs, screens, lamps, cables, '
        + 'lanterns, halos, cones, beacons, traffic, sparks, counter, dragon, steam, '
        + 'rain, beams, kit-awning, kit-vending, kit-escape, kit-pipes, kit-bridge, '
        + 'kit-gantry, kit-tank, kit-mast, kit-aircon, kit-frame'],

    ['shifting-sands', 'shiftingSands', 'Shifting Sands', 'sky, dunes, rocks, worm, fx'],

    ['stillwater',
        'stillwater',
        'Stillwater',
        'sky, water, ground, boulders, trunks, boughs, fringe, saplings, ferns, reeds, pads, lilies, '
        + 'caps, spirit, troll, mist, eyes, fireflies, wisps, drops, sparks'],

    ['supernova', 'supernova', 'Supernova', 'sky, nebula, beams, star, ring, loops, embers, streams, sparks'],

    ['tornado',
        'tornado',
        'Tornado',
        'sky, ground, wheat, props, funnel, debris, motes, bolts'],

    ['vesper-chrysalis',
        'vesperChrysalis',
        'Vesper Chrysalis',
        'sky, lake, spires, reeds, chrysalis, threads, wings, blooms, moths, dust, fireflies, blades'],

    ['void-ember',
        'voidEmber',
        'Void Ember',
        'star, world, boulders, stones, gravel, sky, ring, corona, loops, wind, sparks, comets, shells, beams',
        'rocks also names all three classes of stone (boulders, stones, gravel).'],

    ['voltage-storm',
        'voltageStorm',
        'Voltage Storm',
        'sky, water, towers, towerMirror, boltMirror, glows, bolts, sparks, rain'],

    ['waves', 'waves', 'Waves', 'sky, water, dolphins, mist, rain, spray'],

    ['winter', 'winter', 'Winter', 'sky, ground, trees, prints, snow, dust, sparks, beams, fox, spirit'],
];
// A row may end with a note on its parts (an alias the world accepts beside the listed names).
const captureEntries = captureThemes.flatMap(([id, prefix, label, parts, partsNote = '']) => [
    toggle(`${prefix}ForceWebGL`, label, 'Use the WebGL2 renderer for this theme.', [source(id)]),
    numeric(
        `${prefix}Time`,
        label,
        'Freeze the scene at a chosen animation time for repeatable screenshots.',
        'Finite seconds, 0 or greater',
        'Live animation',
        '12',
        [source(id)],
    ),
    numeric(
        `${prefix}FixedDt`,
        label,
        'Advance the theme by a fixed time step each frame.',
        'Positive number: seconds when <= 1; milliseconds when > 1',
        'Measured frame time',
        '16.6667',
        [source(id)],
        'A Time override freezes animation even when a fixed time step is supplied.',
    ),
    entry(
        `${prefix}Parts`,
        label,
        'Render only the named scene parts for visual or performance isolation.',
        `Comma-separated names: ${parts}`,
        'All scene parts',
        parts.split(',')[0].trim(), // the theme's own first part (not every scene has a sky)
        [source(id), `src/themes/${id}/${id}-world.js`],
        ['Names are case-sensitive. Parts absent at the selected quality stay absent.', partsNote].filter(Boolean)
            .join(' '),
    ),
    toggle(
        `${prefix}FalseColor`,
        label,
        'Show a false-color brightness diagnostic instead of the normal final grade.',
        [source(id)],
    ),

]);

const rendererAliases = [
    ['aurora', 'auroraForceWebGL', 'Aurora', ON],
    ['black-hole', 'blackHoleForceWebGL', 'Black Hole', ON],
    ['blood-moon',
        'bloodMoonForceWebGL',
        'Blood Moon',
        'Any present value except 0, false, off, no enables (case-insensitive)'],

    ['crystal-cave', 'crystalCaveForceWebGL', 'Crystal Cave', ON],
    ['fall', 'fallForceWebGL', 'Fall', ON],
    ['forest', 'forestForceWebGL', 'Forest', ON],
    ['golden-forest', 'goldenForestForceWebGL', 'Golden Forest', ON],
    ['misty-lake', 'mistyLakeForceWebGL', 'Misty Lake', ON],
    ['moonlit-forest', 'moonlitForceWebGL', 'Moonlit Forest', ON],
    ['ocean', 'oceanForceWebGL', 'Ocean', ON],
    ['parhelion', 'parhelionForceWebGL', 'Parhelion', ON],
    ['sakura-twilight', 'sakuraForceWebGL', 'Sakura Twilight', ON],
    ['serenity-warp', 'serenityWarpForceWebGL', 'Serenity Warp', ON_SHORT],
    ['starlight', 'starlightForceWebGL', 'Starlight', ON_SHORT],
    ['stellar-drift', 'stellarDriftForceWebGL', 'Stellar Drift', ON],
    ['summer', 'summerForceWebGL', 'Summer', ON],
    ['verdant-hills', 'verdantHillsForceWebGL', 'Verdant Hills', ON],
    ['wolfhour', 'wolfhourForceWebGL', 'Wolfhour', ON_SHORT],
].map(([id,
    name,
    label,
    values]) => toggle(
    name,
    label,
    'Use the WebGL2 renderer for this theme.',
    [source(id)],
    values,
));

const simpleSeedEntries = [
    ['fall', 'fallSeed', 'Fall', '271'],
    ['forest', 'forestSeed', 'Forest', '419'],
    ['golden-forest', 'goldenForestSeed', 'Golden Forest', '271'],
    ['sakura-twilight', 'sakuraSeed', 'Sakura Twilight', '271'],
    ['summer', 'summerSeed', 'Summer', '624'],
    ['verdant-hills', 'verdantHillsSeed', 'Verdant Hills', '1107'],
    ['stellar-drift', 'stellarSeed', 'Stellar Drift', '187'],
].map(([id, name, label, fallback]) => numeric(
    name,
    label,
    'Choose a repeatable scene-generation seed.',
    'Finite number',
    fallback,
    '42',
    [source(id)],
));

const oldCaptureThemes = [
    ['neon-dusk', 'neonDusk', 'Neon Dusk'],
    ['nimbus-veil', 'nimbus', 'Nimbus Veil'],
    ['synthwave-sunset', 'synthwave', 'Synthwave Sunset'],
];
const oldCaptureEntries = oldCaptureThemes.flatMap(([id, prefix, label]) => [
    toggle(`${prefix}NoPost`, label, 'Disable the post-processing pipeline.', [source(id)], PRESENT_UNLESS_FALSE),
    toggle(`${prefix}NoDRS`, label, 'Disable automatic render-resolution changes.', [source(id)], PRESENT_UNLESS_FALSE),
    toggle(
        `${prefix}Baseline`,
        label,
        'Enable baseline frame capture and diagnostic helpers.',
        [source(id)],
        PRESENT_UNLESS_FALSE,
    ),

    numeric(
        `${prefix}FixedDt`,
        label,
        'Use a fixed animation step for reproducible captures.',
        'Finite milliseconds greater than 0',
        'Measured frame time',
        '16.6667',
        [source(id)],
        'Takes priority over fixedDt.',
    ),
    numeric(
        `${prefix}Seed`,
        label,
        'Choose a repeatable scene-generation seed.',
        'Finite number; invalid provided values become 1',
        'Random',
        '42',
        [source(id)],
        'Takes priority over seed.',
    ),
]);

const legacyPerformanceEntries = [
    ['cosmic-noir', 'cosmicNoir', 'Cosmic Noir', ON_SHORT],
    ['wolfhour', 'wolfhour', 'Wolfhour', ON_SHORT],
    ['stellar-velocity', 'stellarVel', 'Stellar Velocity', ON],
].flatMap(([id, prefix, label, values]) => [
    ...[
        ['NoPost', 'Disable the post-processing pipeline.'],
        ['NoMRT', 'Disable multiple-render-target rendering; use the supported fallback.'],
        ['NoCompute', 'Disable GPU compute effects; use the supported fallback.'],
        ['Baseline', 'Enable baseline performance capture and console helpers.'],
    ].map(([suffix, description]) => toggle(`${prefix}${suffix}`, label, description, [source(id)], values)),
    numeric(
        `${prefix}Seed`,
        label,
        'Choose a repeatable scene-generation seed.',
        'Finite number',
        id === 'stellar-velocity' ? '0 (mapped to the seeded generator starting at 1)' : 'Random',
        '42',
        [source(id)],
        'Takes priority over seed.',
    ),
    numeric(
        `${prefix}FixedDt`,
        label,
        'Use a fixed animation step for reproducible captures.',
        'Finite milliseconds greater than 0',
        'Measured frame time',
        '16.6667',
        [source(id)],
        'Takes priority over fixedDt.',
    ),
]);

const playbackEntries = [
    ['chromadelic-highway', 'chromadelic', 'Chromadelic Highway'],
    ['stellar-velocity', 'stellarVel', 'Stellar Velocity'],
    ['wolfhour', 'wolfhour', 'Wolfhour'],
].flatMap(([id, prefix, label]) => [
    entry(
        `${prefix}Playback`,
        label,
        'Automatically play a scripted sequence of theme reactions.',
        'default or stress; other nonempty names use the default sequence',
        'No automatic playback',
        'stress',
        [source(id)],
        'Emits synthetic gameplay events for visual testing.',
    ),
    numeric(
        `${prefix}PlaybackLoops`,
        label,
        'Repeat the scripted theme-reaction sequence this many times.',
        'Finite number greater than 0, rounded down',
        '1',
        '3',
        [source(id)],
        `Requires ${prefix}Playback.`,
    ),
]);

const oceanSystems = [
    ['Fish', 'fish schools'], ['HeroAssets', 'the main imported habitat assets'],
    ['Dwellers', 'seabed dwellers'], ['RareFauna', 'rare sea creatures'],
    ['Seaweed', 'seaweed'], ['Seagrass', 'seagrass'], ['Coral', 'coral'],
    ['Jellyfish', 'jellyfish'], ['Plankton', 'plankton'], ['Bubbles', 'bubbles'],
    ['Billboards', 'camera-facing scenery sprites'], ['Atmosphere', 'the atmosphere system'],
    ['AtmosphereBillboards', 'atmosphere sprites'], ['Haze', 'haze'],
    ['BeamDust', 'dust inside light beams'], ['GlowAnchors', 'glowing atmosphere anchors'],
    ['BioSilhouettes', 'bioluminescent silhouettes'], ['HeroCoral', 'large featured coral'],
    ['HeroKelp', 'large featured kelp'], ['HeroReef', 'the featured reef'],
    ['CoralCarpets', 'coral carpets'], ['ForegroundRocks', 'foreground rocks'],
    ['ImportedSeabed', 'the imported seabed'], ['ReefSilhouettes', 'distant reef silhouettes'],
    ['Arches', 'rock arches'], ['GameplayFx', 'gameplay-triggered effects'],
    ['Seabed', 'the seabed'], ['Water', 'water rendering'],
    ['Post', 'all post-processing'], ['GodRays', 'light shafts'],
    ['Dof', 'depth-of-field blur'], ['Refraction', 'refraction'],
    ['Chroma', 'chromatic aberration'], ['Bloom', 'bloom'],
    ['Grade', 'color grading'], ['Vignette', 'the edge vignette'],
].flatMap(([suffix, label]) => aliases(
    [`oceanNo${suffix}`, `no${suffix}`],
    'Ocean',
    `Disable ${label} to isolate visual or performance issues.`,
    [source('ocean')],
));

const validationIds = ['aurora',
    'black-hole',
    'crystal-cave',
    'fall',
    'forest',
    'golden-forest',
    'sakura-twilight',
    'stellar-drift',
    'summer',
    'verdant-hills'];

export const THEME_URL_PARAMETERS = [
    entry(
        'forceWebGL',
        'Supported game themes',
        'Request the WebGL2 backend instead of WebGPU.',
        'Use 1 to enable reliably across themes; remove to use automatic backend selection',
        'Automatic backend selection',
        '1',
        ['src/themes/shared/node-renderer.js', source('winter'), source('chromadelic-highway')],
        'Theme parsers differ: some accept true/yes/on/empty, some require 1, and '
            + 'Chromadelic enables on any presence.',

    ),
    entry(
        'noThemeFpsCap',
        'All BaseTheme backgrounds',
        'Remove the background frame-rate cap tied to Target Frame Rate.',
        '1 enables; 0 disables',
        'Off',
        '1',
        ['src/themes/base-theme.js', 'src/core/flags.js'],
        'Also reads localStorage serenity.noThemeFpsCap. URL takes precedence. '
            + 'Hidden-page and reduced-rendering limits still apply.',

    ),
    ...rendererAliases,
    ...captureEntries,
    ...simpleSeedEntries,
    toggle(
        'themeValidation',
        'Aurora, Black Hole, Crystal Cave, Fall, Forest, Golden Forest, Sakura Twilight, Stellar Drift, Summer, '
            + 'Verdant Hills',
        'Expose the current theme instance on a theme-specific window debug handle.',
        validationIds.map(source),
    ),
    ...aliases(
        ['blackHoleNoDrs',
            'blackHoleNoDRS'],
        'Black Hole',
        'Disable dynamic render resolution.',
        [source('black-hole')],
    ),

    toggle(
        'blackHoleNoGpuDrs',
        'Black Hole / WebGPU',
        'Disable GPU-timing-driven dynamic resolution feedback.',
        [source('black-hole')],
    ),

    ...['NoPost', 'NoMRT'].map((suffix) => toggle(
        `stellar${suffix}`,
        'Stellar Drift',
        suffix === 'NoPost' ? 'Disable post-processing.' : 'Disable multiple-render-target rendering.',
        [source('stellar-drift')],
    )),
    ...oldCaptureEntries,
    ...legacyPerformanceEntries,
    ...playbackEntries,
    ...['noDRS', 'noDrs'].map((name) => toggle(
        name,
        'Neon Dusk, Nimbus Veil, Synthwave Sunset',
        'Disable automatic render-resolution changes.',
        oldCaptureThemes.map(([id]) => source(id)),
        PRESENT_UNLESS_FALSE,
    )),
    entry(
        'seed',
        'Chromadelic Highway, Cosmic Noir, Neon Dusk, Nimbus Veil, Stellar Drift, '
            + 'Stellar Velocity, Synthwave Sunset, Wolfhour',

        'Fallback scene-generation seed when a theme-specific seed is absent.',
        'Finite number',
        'Varies: Stellar Drift 187; Chromadelic/Velocity 0; others random',
        '42',
        ['chromadelic-highway',
            'cosmic-noir',
            'neon-dusk',
            'nimbus-veil',
            'stellar-drift',
            'stellar-velocity',
            'synthwave-sunset',
            'wolfhour'].map(source),

        'Prefer the theme-specific parameter to avoid changing unrelated scenes. '
            + 'This does not set the gameplay piece seed.',

    ),
    entry(
        'fixedDt',
        'Chromadelic Highway, Cosmic Noir, Neon Dusk, Nimbus Veil, Stellar Velocity, Synthwave Sunset, Wolfhour',
        'Fallback fixed animation time step when the theme-specific override is absent.',
        'Finite milliseconds greater than 0',
        'Measured frame time',
        '16.6667',
        ['chromadelic-highway',
            'cosmic-noir',
            'neon-dusk',
            'nimbus-veil',
            'stellar-velocity',
            'synthwave-sunset',
            'wolfhour'].map(source),

    ),
    toggle(
        'noPost',
        'Cosmic Noir, Neon Dusk, Nimbus Veil, Sky Children, Synthwave Sunset, Wolfhour',
        'Disable theme post-processing.',
        ['cosmic-noir', 'neon-dusk', 'nimbus-veil', 'sky-children-v2', 'synthwave-sunset', 'wolfhour'].map(source),
        'Use 1; Cosmic Noir/Wolfhour also accept empty/true/yes, Sky Children adds '
            + 'on, and Neon Dusk/Nimbus/Synthwave accept any value except 0/false',

    ),
    ...['noMRT', 'noCompute'].map((name) => toggle(
        name,
        'Cosmic Noir, Sky Children, Wolfhour',
        name === 'noMRT' ? 'Disable multiple-render-target effects.' : 'Disable GPU compute effects.',
        ['cosmic-noir', 'sky-children-v2', 'wolfhour'].map(source),
        ON_SHORT,
        'Sky Children also accepts on.',
    )),
    toggle(
        'baseline',
        'Cosmic Noir, Moonlit Forest, Neon Dusk, Nimbus Veil, Synthwave Sunset, Wolfhour',
        'Enable the theme baseline or performance capture helpers.',
        ['cosmic-noir', 'moonlit-forest', 'neon-dusk', 'nimbus-veil', 'synthwave-sunset', 'wolfhour'].map(source),
        'Use 1; other accepted boolean spellings vary by theme',
    ),
    ...aliases(
        ['wolfhourNoAdaptivePacing',
            'noAdaptivePacing'],
        'Wolfhour',
        'Disable adaptive rendering cadence.',
        [source('wolfhour')],
        ON_SHORT,
    ),

    ...aliases(
        ['wolfhourNoPrewarm',
            'noPrewarm'],
        'Wolfhour',
        'Skip theme pipeline prewarming.',
        [source('wolfhour')],
        ON_SHORT,
    ),

    entry(
        'playback',
        'Wolfhour',
        'Fallback automatic scripted theme-reaction sequence.',
        'default or stress; other nonempty names use default',
        'No automatic playback',
        'stress',
        [source('wolfhour')],
        'wolfhourPlayback takes priority. Emits synthetic gameplay events.',
    ),
    numeric(
        'playbackLoops',
        'Wolfhour',
        'Fallback repeat count for scripted reactions.',
        'Finite number greater than 0, rounded down',
        '1',
        '3',
        [source('wolfhour')],
        'wolfhourPlaybackLoops takes priority.',
    ),
    ...[
        ['stellarVelNoDrs', 'Disable dynamic render resolution.'],
        ['stellarVelNoEnhancements', 'Disable optional enhanced rendering paths, including MRT and compute.'],
        ['stellarVelGpuTiming', 'Request GPU timing measurements when the backend supports them.'],
        ['stellarVelMrtAudit', 'Log multiple-render-target material compatibility diagnostics.'],
    ].map(([name, description]) => toggle(name, 'Stellar Velocity', description, [source('stellar-velocity')])),
    ...[
        ['cosmicNoirNoAdaptiveScale', 'Disable automatic pixel-ratio scaling.'],
        ['cosmicNoirMrtAudit', 'Log multiple-render-target material diagnostics.'],
        ['cosmicNoirPreserveDrawingBuffer', 'Preserve the WebGL drawing buffer for capture tooling.'],
    ].map(([name, description]) => toggle(name, 'Cosmic Noir', description, [source('cosmic-noir')], ON_SHORT)),
    ...aliases(
        ['cosmicNoirPerf',
            'perf'],
        'Cosmic Noir',
        'Enable performance instrumentation.',
        [source('cosmic-noir')],
        ON_SHORT,
    ),

    entry(
        'cosmicNoirMsaa',
        'Cosmic Noir / WebGPU',
        'Override whether WebGPU multisample antialiasing is enabled.',
        '1/true/yes/empty enables; 0/false/no disables (case-insensitive)',
        'Quality/platform policy',
        '0',
        [source('cosmic-noir')],
    ),
    ...['cosmicNoirFixedDeltaMs', 'fixedDeltaMs'].map((name) => numeric(
        name,
        'Cosmic Noir',
        'Override the theme animation time step.',
        'Finite milliseconds greater than 0',
        'Measured frame time',
        '16.6667',
        [source('cosmic-noir')],
        'Priority: cosmicNoirFixedDeltaMs, cosmicNoirFixedDt, fixedDeltaMs, fixedDt.',
    )),
    ...['cosmicNoirFixedPixelRatio', 'fixedPixelRatio'].map((name) => numeric(
        name,
        'Cosmic Noir',
        'Override rendering pixel ratio and stop adaptive scaling.',
        'Finite number greater than 0',
        'Quality/device policy',
        '1',
        [source('cosmic-noir')],
        'cosmicNoirFixedPixelRatio takes priority.',
    )),
    numeric(
        'cosmicNoirAtmoShells',
        'Cosmic Noir',
        'Override the number of atmosphere shells around the planet.',
        'Finite number greater than 0, rounded; at least 1 shell',
        'Quality preset',
        '1',
        [source('cosmic-noir')],
    ),
    numeric(
        'cosmicNoirRenderScale',
        'Cosmic Noir',
        'Override the scene-buffer scale for sharpness/performance comparisons.',
        'Finite positive number, clamped to 0.5–2',
        'Quality preset',
        '0.75',
        [source('cosmic-noir')],
    ),
    ...[
        ['chromadelicNoPost', 'Disable post-processing.'],
        ['chromadelicBaseline', 'Enable baseline instrumentation and repeatable capture mode.'],
        ['chromadelicFalseColor', 'Show brightness bands before tone mapping.'],
    ].map(([name,
        description]) => toggle(
        name,
        'Chromadelic Highway',
        description,
        [source('chromadelic-highway')],
        PRESENCE,
    )),

    ...['chromadelicNoCompute',
        'chromadelicNoMRT',
        'chromadelicMrtAudit',
        'chromadelicNoShootingStarCompute'].map((name) => toggle(
        name,
        'Chromadelic Highway / compatibility',
        'Compatibility parameter; currently no effect.',
        [source('chromadelic-highway')],
        PRESENCE,
        'The rebuilt theme no longer uses the affected compute/MRT path.',
    )),
    numeric(
        'chromadelicSeed',
        'Chromadelic Highway',
        'Choose a repeatable scene-generation seed.',
        'Finite number',
        '0 (mapped to the seeded generator starting at 1)',
        '42',
        [source('chromadelic-highway')],
        'Takes priority over seed.',
    ),
    numeric(
        'chromadelicFixedDt',
        'Chromadelic Highway',
        'Use a fixed animation time step.',
        'Finite milliseconds greater than 0',
        'Measured frame time',
        '16.6667',
        [source('chromadelic-highway')],
    ),
    numeric(
        'chromadelicTime',
        'Chromadelic Highway',
        'Seek to a scene time and freeze for screenshots.',
        'Finite seconds, 0 or greater',
        'Live animation',
        '12',
        [source('chromadelic-highway')],
    ),
    numeric(
        'chromadelicMsaa',
        'Chromadelic Highway',
        'Override the scene-pass antialiasing sample count.',
        'Finite number; supported sample counts depend on the backend (normally 0 or 4)',
        'Quality/antialiasing setting',
        '0',
        [source('chromadelic-highway')],
    ),
    entry(
        'chromadelicParts',
        'Chromadelic Highway',
        'Render only selected world parts.',
        'Comma-separated: sky, stars, planets, road, rails, rings, streaks, motes, meteors',
        'All parts',
        'road,rails',
        [source('chromadelic-highway'), 'src/themes/chromadelic-highway/chromadelic-highway-world.js'],
    ),
    toggle('mistyLakeNoPost', 'Misty Lake', 'Disable bloom post-processing.', [source('misty-lake')]),
    toggle(
        'mistyLakeNoReflection',
        'Misty Lake',
        'Disable reflection even when the opt-in reflection flag is set.',
        [source('misty-lake')],
    ),

    ...aliases(
        ['mistyLakeReflection',
            'mistyLakeEnableReflection'],
        'Misty Lake',
        'Opt in to water reflection.',
        [source('misty-lake')],
    ),

    ...['mistyLakeNoMRT', 'mistyLakeNoCompute', 'mistyLakeDebug'].map((name) => toggle(
        name,
        'Misty Lake / compatibility',
        'Compatibility parameter; currently no effect.',
        [source('misty-lake')],
    )),
    ...[
        ['skyV2NoPost', 'Disable theme post-processing.'], ['skyV2NoMRT', 'Disable multiple-render-target rendering.'],
        ['skyV2NoCompute',
            'Disable GPU compute effects.'],
        ['skyV2UseMRT',
            'Opt in to multiple-render-target rendering when supported.'],

        ['skyV2Debug', 'Show the Sky Children theme debug overlay.'],
    ].map(([name, description]) => toggle(name, 'Sky Children', description, [source('sky-children-v2')])),
    ...oceanSystems,
    ...[
        [['oceanLegacyModels', 'legacyModels'], 'Use the legacy ocean asset collection.'],
        [['oceanNoStriding', 'noStriding'], 'Disable staggered subsystem updates for performance comparison.'],
        [['oceanLogStartup', 'logStartup'], 'Log ocean startup diagnostics.'],
        [['oceanHelp', 'help'], 'Print the ocean diagnostic parameter list in the console.'],
    ].flatMap(([names, description]) => aliases(names, 'Ocean', description, [source('ocean')])),
    ...['oceanBisect', 'bisect'].map((name) => entry(
        name,
        'Ocean',
        'Automatically compare disabled subsystems to find rendering cost.',
        'broad, atmosphere, fauna, post, render, all; any other present value selects broad',
        'Off',
        'atmosphere',
        [source('ocean')],
        'Starts four seconds after initialization, temporarily cycles scene '
            + 'features, and prints timing results. oceanBisect takes priority.',

    )),
    numeric(
        'bloodMoonTime',
        'Blood Moon',
        'Freeze the scene at a chosen animation time.',
        'Finite seconds; negative values clamp to 0',
        'Live animation',
        '12',
        [source('blood-moon')],
    ),
    numeric(
        'bloodMoonSeed',
        'Blood Moon',
        'Override the effect scene-generation seed.',
        'Finite number',
        'seed override, or 724461',
        '42',
        [source('blood-moon')],
        'Forwarded as seed to the effect factory.',
    ),
    numeric(
        'parhelionSeed',
        'Parhelion',
        'Choose a repeatable scene-generation seed.',
        'Finite number, truncated to an integer',
        '1470239127 (0x57a21197)',
        '42',
        [source('parhelion')],
    ),
    numeric(
        'parhelionFixedDt',
        'Parhelion',
        'Advance the theme by a fixed time step.',
        'Positive number: seconds when <= 1, milliseconds when > 1; clamped to 0.0001–0.05 seconds',
        'Measured frame time',
        '16.6667',
        [source('parhelion')],
    ),
    ...[
        ['moonlit-forest', 'moonlitQuality', 'Moonlit Forest'],
    ].map(([id, name, label]) => entry(
        name,
        label,
        'Override the theme graphics-quality tier.',
        QUALITY,
        'Current graphics setting, or High',
        'High',
        [source(id)],
        'Takes priority over quality.',
    )),
    entry(
        'quality',
        'Moonlit Forest',
        'Fallback graphics-quality override for this theme.',
        QUALITY,
        'Current graphics setting, or High',
        'High',
        [source('moonlit-forest')],
        'A theme-specific quality override takes priority.',
    ),
    ...aliases(
        ['moonlitPerf',
            'moonlitBaseline'],
        'Moonlit Forest',
        'Record theme baseline/performance samples.',
        [source('moonlit-forest')],
    ),
];
