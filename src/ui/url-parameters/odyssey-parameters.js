/** URL reference data audited against Odyssey's active readers, not historical flags. */
const BOARD = 'src/rendering/odyssey/OdysseyBoardController.js';
const MODE_FLAGS = 'src/core/odyssey/odyssey-url-flags.js';
const EARTH = 'src/rendering/odyssey/chapter-environments/earth-core.js';
const COSMOS = 'src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
const PILOT = 'src/rendering/odyssey/pilot/odyssey-webgpu-pilot.js';
const WORLD_SCOPE = 'Odyssey world, chapters 2–5 (One World enabled)';
const ON = '1 or true enables; other values disable';
const OFF = '0, false or off disables; other values enable';

function parameter(name, description, values, defaultValue, exampleValue, extra = {}) {
    return {
        name,
        category: 'Odyssey',
        scope: 'Odyssey world map',
        description,
        values,
        defaultValue,
        example: `${name}=${exampleValue}`,
        sources: [BOARD],
        ...extra,
    };
}

function toggle(name, description, extra = {}) {
    return parameter(name, description, ON, 'Off', '1', extra);
}

export const ODYSSEY_URL_PARAMETERS = Object.freeze([
    parameter(
        'odysseyEditor',
        'Opens the Odyssey layout editor for arranging the journey.',
        '1 enables; other values disable',
        'Off',
        '1',
        {
            scope: 'Odyssey; development builds only',
            sources: [MODE_FLAGS],
            notes: 'Ignored in production builds. The editor can change and export layout data.',
        },
    ),
    parameter(
        'odysseyDebug',
        'Exposes Odyssey console handles for development and capture tools.',
        '1 enables; other values do not opt in',
        'On in development builds; off in production',
        '1',
        {
            sources: [MODE_FLAGS],
            notes: 'Does not automatically start or unlock an orb. '
                + 'Calling testOdysseyLevel in the console can change real saved progression.',
        },
    ),
    parameter(
        'odysseyAAA',
        'Shows the Odyssey diagnostics overlay and exposes console debug handles.',
        '1 enables; other values disable the overlay',
        'Overlay off; console handles already on in development',
        '1',
        {
            sources: [MODE_FLAGS, 'src/rendering/odyssey/composition/odyssey-debug-overlay.js', BOARD],
            notes: 'The cinematic rendering already runs by default. '
                + 'odysseyOverlay=0 or odysseyNoOverlay=1 hides this overlay.',
        },
    ),
    parameter(
        'odysseyOverlay',
        'Suppresses the diagnostics overlay requested by odysseyAAA=1.',
        '0 or false hides; other values leave odysseyAAA in control',
        'Follows odysseyAAA',
        '0',
        {
            sources: ['src/rendering/odyssey/composition/odyssey-debug-overlay.js'],
        },
    ),
    parameter(
        'odysseyNoOverlay',
        'Hides the Odyssey diagnostics overlay.',
        '1 hides; other values leave odysseyAAA in control',
        'Off',
        '1',
        {
            sources: ['src/rendering/odyssey/composition/odyssey-debug-overlay.js'],
        },
    ),
    parameter(
        'odysseyCaptureChapters',
        'Restricts chapter loading to a chosen set for bounded captures.',
        'Comma-separated chapter numbers 1–8',
        'No capture restriction',
        '1,6',
        {
            sources: [BOARD, MODE_FLAGS],
            notes: 'Disables normal background loading, chapter eviction and chapter detail switching. '
                + 'Its presence also exposes debug handles; it does not grant orb completion.',
        },
    ),
    parameter(
        'odysseyKeepBoard',
        'Keeps the world map in memory while an orb is played, reducing return loading.',
        OFF,
        'On',
        '0',
        { sources: [MODE_FLAGS] },
    ),
    parameter(
        'odysseyCoreInstanced',
        'Uses shared rendering for orb cores; disabling restores separate orb meshes.',
        OFF,
        'On in the browser',
        '0',
        { sources: ['src/rendering/odyssey/LevelNodeManager.js'] },
    ),
    parameter(
        'odysseySerialInit',
        'Creates and compiles chapters serially to investigate driver startup problems.',
        '1 enables; other values disable',
        'Off',
        '1',
    ),
    parameter(
        'odysseyWarmupMode',
        'Chooses how much of the journey is prepared before the map appears.',
        'current (focus, focused, minimal); full (journey, all); off (none, skip)',
        'current',
        'full',
        {
            sources: [BOARD, 'src/rendering/odyssey/odyssey-performance-utils.js'],
            notes: 'Case-insensitive. An explicit recognized mode takes precedence over odysseyFastStartOff.',
        },
    ),
    toggle(
        'odysseyFastStartOff',
        'Warms the full available journey before reveal instead of only the current chapter.',
        {
            notes: 'Applies when odysseyWarmupMode is absent or unrecognized.',
        },
    ),
    toggle(
        'odysseyMotionWarm',
        'Warms a short moving path behind the loading overlay to investigate first-motion hitches.',
        {
            notes: 'Only applies with the current-chapter warmup mode.',
        },
    ),
    toggle('odysseyEagerWindowOff', 'Disables the initial chapter neighborhood limit so startup loads all chapters.'),
    parameter(
        'odysseyWarpPreinit',
        'Chooses when the portal transition renderer is prepared.',
        'immediate, defer or off (case-insensitive)',
        'defer',
        'immediate',
        {
            sources: ['src/core/game-modes/OdysseyMode.js'],
        },
    ),
    parameter(
        'odysseyEffectWarm',
        'Prepares hidden theme effects during orb loading before they first appear in play.',
        '1 enables; other values disable',
        'Off',
        '1',
        {
            scope: 'Odyssey orb loading', sources: ['src/rendering/odyssey/effect-prewarm.js'],
        },
    ),
    parameter(
        'odysseyDeferSeamCompiles',
        'Defers world and chapter-transition shader compilation until after the map reveal.',
        '0 disables; other values enable',
        'On',
        '0',
        {
            notes: 'odysseyDeferSeamCompilesOff=1 also disables this behavior.',
        },
    ),
    toggle('odysseyDeferSeamCompilesOff', 'Disables deferred transition compilation, '
        + 'restoring the pre-reveal barrier.'),
    parameter(
        'odysseyLiveCompile',
        'Compiles background chapters through the running renderer before warming them.',
        '0 disables; other values enable',
        'On',
        '0',
        {
            notes: 'odysseyLiveCompileOff=1 also disables this behavior.',
        },
    ),
    toggle('odysseyLiveCompileOff', 'Disables live background compilation for comparison with render-only warming.'),
    parameter(
        'odysseyCompileWidth',
        'Sets how many startup shader compilation requests may run concurrently.',
        'Positive integer, capped at 32',
        '6',
        '3',
        {
            sources: [BOARD, 'src/rendering/odyssey/warmup/post-target-compile.js'],
        },
    ),
    parameter(
        'odysseyBgWarm',
        'Warms unseen chapter rendering in the background after the map appears.',
        OFF,
        'On, except when chapter eviction owns residency',
        '0',
        {
            notes: 'odysseyPerfDisableBackgroundWarm=1 also disables the warm sweep.',
        },
    ),
    toggle('odysseyPerfDisableBackgroundWarm', 'Disables the post-reveal background '
        + 'render warm sweep for measurement.'),
    toggle('odysseyDisableBackgroundLoading', 'Stops the normal deferred creation of distant chapters.'),
    parameter(
        'odysseyBackgroundLoadDelayMs',
        'Sets the initial wait before deferred background chapter loading.',
        'Number in milliseconds; 0 or an invalid value uses the default',
        '1800 ms',
        '3000',
        {
            notes: 'Has an effect only while background chapter loading is enabled.',
        },
    ),
    toggle(
        'odysseyChapterEvict',
        'Disposes distant chapters and recreates them as the camera approaches.',
        {
            notes: 'Disabled during capture-restricted runs; '
                + 'replaces the normal background loading and full warm sweep.',
        },
    ),
    parameter(
        'odysseyChapterEvictWindow',
        'Keeps the current chapter plus this many neighboring chapters on each side.',
        'Integer; minimum 1, with 0 or invalid input falling back to 2',
        '2',
        '1',
        {
            notes: 'Requires odysseyChapterEvict=1.',
            sources: [BOARD, 'src/rendering/odyssey/ChapterEnvironmentManager.js'],
        },
    ),
    toggle('odysseyChapterLOD', 'Reduces detail in off-center chapters while traveling.', {
        notes: 'Disabled during capture-restricted runs.',
    }),
    parameter(
        'odysseyLodFastSpeed',
        'Sets the camera speed at which chapter detail switching treats movement as fast.',
        'Finite number; 0 or invalid input uses the default',
        '0.0015',
        '0.002',
        {
            notes: 'Requires odysseyChapterLOD=1.',
            sources: [BOARD, 'src/rendering/odyssey/ChapterEnvironmentManager.js'],
        },
    ),
    toggle('odysseyTravelGate', 'Temporarily holds camera travel before a chapter that is still being prepared.'),
    parameter(
        'odysseyPrewarmConcurrency',
        'Compatibility parameter; currently no effect.',
        'Integer; parsed with a minimum of 1 and a default of 3',
        '3 (unused)',
        '3',
        {
            notes: 'The former concurrent background compilation path was retired. '
                + 'Changing this parameter does not change chapter warming.',
        },
    ),
    parameter(
        'odysseyTravelGateReleaseMs',
        'Limits how long the camera waits at an unready chapter frontier.',
        'Number in milliseconds; 0 or invalid input uses the default',
        '2500 ms',
        '1500',
        {
            notes: 'Requires odysseyTravelGate=1.',
        },
    ),
    parameter(
        'odysseyScrollSpeed',
        'Adjusts mouse wheel and trackpad travel sensitivity on the world map.',
        'Finite number; 0 or invalid input uses the default',
        '0.09',
        '0.05',
        {
            sources: [BOARD, 'src/rendering/odyssey/OdysseyCameraController.js'],
        },
    ),
    parameter(
        'odysseyMaxScroll',
        'Caps manual map travel velocity in journey progress per second.',
        'Finite number; 0 or invalid input uses the default',
        '0.15',
        '0.1',
        {
            sources: [BOARD, 'src/rendering/odyssey/OdysseyCameraController.js'],
        },
    ),
    parameter(
        'odysseyArrivalPreview',
        'Starts the map arrival camera at a later point for repeatable screenshots.',
        'Positive number: values up to 1 settle the shot; values above 1 specify elapsed seconds',
        'Normal arrival animation',
        '1',
        { sources: ['src/rendering/odyssey/OdysseyCameraController.js'] },
    ),
    toggle(
        'odysseyDisableAdaptiveQuality',
        'Disables automatic quality adjustments so a performance comparison stays fixed.',
    ),
    parameter(
        'odysseyPixelRatio',
        'Overrides the map rendering pixel ratio.',
        'Positive number, clamped to 0.5–2',
        'Based on device, quality and dynamic scaling; capped at 1.5',
        '1',
    ),
    parameter(
        'odysseyPerfRefreshTarget',
        'Overrides the target frame rate used by Odyssey performance controls.',
        'Positive number, rounded and clamped to 30–1000 FPS',
        'Game setting, then detected refresh rate, then 60 FPS',
        '60',
        {
            sources: [BOARD, 'src/rendering/odyssey/odyssey-performance-utils.js'],
            notes: 'The adaptive target is also capped by the detected display refresh rate.',
        },
    ),
    toggle('odysseyLowPowerGpu', 'Requests a low-power graphics adapter instead of a high-performance adapter.', {
        notes: 'A browser or driver may choose a different adapter; reload to apply.',
    }),
    toggle('odysseyGpuProfile', 'Enables GPU timestamp profiling without requiring the diagnostics overlay.', {
        notes: 'Requires a backend and device that support timestamp queries.',
    }),
    toggle('odysseyPerfGpuSync', 'Waits for GPU completion during journey warmup to separate rendering and wait time.'),
    toggle('odysseyWarmProbe', 'Logs diagnostics for chapter render-warm failures without enabling the overlay.'),
    toggle('odysseyHideLevelNodes', 'Hides orb nodes on the map for scene rendering comparisons.'),
    toggle('odysseyDomeCullOff', 'Keeps the global atmosphere dome visible even when a chapter sky covers it.'),
    toggle('odysseyLightsFirst', 'Builds the initial chapter light set before starting chapter shader compilation.'),
    toggle('odysseyLightsLate', 'Restores late atmosphere-light creation for startup ordering comparisons.'),
    parameter(
        'odysseySharpen',
        'Sharpens the image when dynamic resolution lowers map rendering resolution.',
        OFF,
        'On',
        '0',
    ),
    parameter(
        'odysseySharpenMax',
        'Sets the maximum sharpening amount at the dynamic-resolution floor.',
        'Finite number, clamped to 0–1',
        '0.35',
        '0.2',
        {
            sources: [BOARD, 'src/rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js'],
        },
    ),
    toggle('odysseyPerfDisableBloom', 'Disables the map bloom glow for rendering comparisons.', {
        notes: 'Bloom is already off at Minimal quality.',
    }),
    parameter(
        'odysseyPerfBloomScale',
        'Sets the resolution fraction used for map bloom.',
        'Finite number, clamped to 0.1–1',
        '0.25',
        '0.5',
    ),
    parameter(
        'odysseyPerfPostQuality',
        'Scales post-processing grain and color-fringe effects.',
        'Finite number, clamped to 0–1',
        '1',
        '0',
        {
            sources: [BOARD, 'src/rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js'],
            notes: 'Adaptive quality can subsequently change this value.',
        },
    ),
    parameter(
        'odysseyOneWorld',
        'Uses one continuous landscape across chapters 2–5; disabling restores the legacy chapter scenes.',
        '0 or false disables; other values enable',
        'On',
        '0',
        { scope: 'Odyssey, chapters 2–5' },
    ),
    toggle('odysseyWorldBakeSync', 'Runs world scenery preparation on the main thread instead of workers.', {
        scope: WORLD_SCOPE,
    }),
    parameter(
        'odysseyBakeBands',
        'Splits world ground preparation across this many worker bands.',
        'Integer, clamped to 1–8; 0 or invalid input uses the default',
        '3 on machines reporting at least 8 logical cores; otherwise 2',
        '2',
        {
            scope: WORLD_SCOPE, sources: [BOARD, 'src/rendering/odyssey/world/odyssey-world-bake-loader.js'],
        },
    ),
    toggle(
        'odysseyWorldCloudSheet',
        'Restores the retired flat cloud sheet for visual comparisons.',
        { scope: WORLD_SCOPE },
    ),
    toggle(
        'odysseyWorldHeroes',
        'Restores the retired large cloud meshes and their cloud clearings.',
        { scope: WORLD_SCOPE },
    ),
    toggle(
        'odysseyWorldNoWater',
        'Removes the continuous world water surface for performance comparisons.',
        { scope: WORLD_SCOPE },
    ),
    toggle(
        'odysseyWorldNoForest',
        'Removes the continuous world forest for performance comparisons.',
        { scope: WORLD_SCOPE },
    ),
    toggle(
        'odysseyWorldForestPaint',
        'Uses experimental painted shading on the legacy forest.',
        {
            scope: WORLD_SCOPE,
            notes: 'This shading belongs to the legacy forest selected with odysseyWorldForestV1=1.',
        },
    ),
    toggle(
        'odysseyWorldForestV1',
        'Restores the legacy cone forest instead of the current tree species.',
        { scope: WORLD_SCOPE },
    ),
    toggle(
        'odysseyWorldFlatGround',
        'Removes detailed ground shading while preserving terrain geometry.',
        { scope: WORLD_SCOPE },
    ),
    toggle(
        'odysseyWorldNoVisCull',
        'Restores forest trees normally removed because the journey camera cannot see them.',
        {
            scope: WORLD_SCOPE,
        },
    ),
    parameter(
        'odysseyForestLod',
        'Forces the current forest to one tree detail tier.',
        'hero, mid or far',
        'Automatic detail tiers',
        'far',
        {
            scope: WORLD_SCOPE, notes: 'The hero tier can be expensive on integrated graphics.',
        },
    ),
    parameter(
        'odysseyWorldCloudDebug',
        'Replaces flat cloud-sheet shading with a diagnostic view.',
        'lattice, alpha, grid, mult or flat',
        'Normal shading',
        'lattice',
        {
            scope: WORLD_SCOPE,
            notes: 'Requires the flat sheet: odysseyWorldCloudSheet=1.',
            sources: [BOARD, 'src/rendering/odyssey/world/odyssey-world-renderer.js'],
        },
    ),
    toggle(
        'odysseyWorldNoCloudField',
        'Removes the sculpted cloud field for scene comparisons.',
        { scope: WORLD_SCOPE },
    ),
    parameter(
        'odysseyWorldCloudFieldCount',
        'Limits the sculpted cloud field to its first N cloud masses.',
        'Positive integer; 0, negative or invalid input uses all masses',
        'All masses',
        '4',
        { scope: WORLD_SCOPE },
    ),
    parameter(
        'lakeTint',
        'Chooses a comparison palette for the continuous world’s northern lake.',
        'mirror, ocean, tarn, ghibli, deepstill or alpine',
        'alpine',
        'tarn',
        {
            scope: WORLD_SCOPE, sources: [BOARD, 'src/rendering/odyssey/world/odyssey-world-renderer.js'],
        },
    ),
    parameter(
        'odysseyNoWhales',
        'Removes the mother-and-calf whale pass above the ocean ascent.',
        '1 enables removal; other values retain the whales',
        'Off',
        '1',
        { scope: 'Odyssey ocean, One World enabled' },
    ),
    toggle('odysseyNoBirds', 'Removes the summit birds for scene comparisons.', {
        scope: 'Odyssey summit, One World enabled',
    }),
    toggle('odysseyNoCloudBank', 'Removes the cloud-bank transition from the summit into space.', {
        scope: 'Odyssey, chapter 5–6 transition',
    }),
    parameter(
        'odysseySimplex',
        'Selects calibrated simplex noise; disabling restores MaterialX Perlin noise.',
        '0 disables simplex; other values enable it',
        'On',
        '0',
        {
            scope: 'Odyssey chapter shaders using shared noise',
            sources: ['src/rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js'],
        },
    ),
    parameter(
        'earthCoreBakeNoise',
        'Uses baked rock noise in Earth Core instead of calculating the full noise shader.',
        '1 enables; 0 disables; other values use the stored override or default',
        'On',
        '0',
        {
            scope: 'Odyssey chapter 1: Earth Core',
            sources: ['src/rendering/odyssey/chapter-environments/earth-core.tsl.js'],
            notes: 'Without an explicit URL value, localStorage serenity.earthCoreBakeNoise can override the default.',
        },
    ),
    ...[
        ['earthCoreNoBackdrop', 'Removes the volcanic background shell, including its canopy shading.'],
        ['earthCoreNoLake', 'Removes the lava lake and its glow sprites.'],
        ['earthCoreNoLakeGlows', 'Removes only the lava lake glow sprites, retaining the lake surface.'],
        ['earthCoreNoHaze', 'Removes the molten haze billboards.'],
    ].map(([name, description]) => parameter(
        name,
        description,
        '1 enables removal; other values retain the layer',
        'Off',
        '1',
        {
            scope: 'Odyssey chapter 1: Earth Core', sources: [EARTH],
        },
    )),
    parameter(
        'earthCoreLakeBake',
        'Uses baked lava-lake noise instead of the analytic noise shader.',
        '1 enables; 0 disables; other values use the stored override or default',
        'On',
        '0',
        {
            scope: 'Odyssey chapter 1: Earth Core',
            sources: [EARTH],
            notes: 'Without an explicit URL value, localStorage serenity.earthCoreLakeBake=0 selects analytic noise.',
        },
    ),
    parameter(
        'earthCoreLakeDebug',
        'Shows lava-lake shading tiers for capture measurements.',
        '2 enables; other values use normal shading',
        'Normal shading',
        '2',
        {
            scope: 'Odyssey chapter 1: Earth Core', sources: [EARTH],
        },
    ),
    parameter(
        'earthCoreLakeFlowDir',
        'Makes lava flow away from the waterfall toward the viewer.',
        '0 disables; other values enable',
        'On',
        '0',
        {
            scope: 'Odyssey chapter 1: Earth Core', sources: [EARTH],
        },
    ),
    parameter(
        'earthCoreLakeRimCrust',
        'Adds experimental stronger crust near the lake rim.',
        '1 enables; other values disable',
        'Off',
        '1',
        {
            scope: 'Odyssey chapter 1: Earth Core', sources: [EARTH],
        },
    ),
    parameter(
        'ch3HeroMirror',
        'Uses a real planar mirror for the legacy Surface World lake.',
        '1 or true enables; 0 or false disables',
        'On at High, Ultra and Extreme; off at lower quality',
        '1',
        {
            scope: 'Odyssey chapter 3 legacy scene (odysseyOneWorld=0)',
            sources: ['src/rendering/odyssey/chapter-environments/surface-world.js'],
            notes: 'Without an explicit URL value, '
                + 'localStorage odyssey.ch3HeroMirror=1 or 0 overrides the quality default.',
        },
    ),
    ...[
        ['odysseyCh6NoDome', 'Removes the space chapter’s background dome.'],
        ['odysseyCh6NoHeroes', 'Removes the space chapter’s black hole, gas giant and galaxy.'],
        ['odysseyCh6NoNebula', 'Removes the space chapter’s nebula field or legacy nebula sprites.'],
        ['odysseyCh6NoDust', 'Removes the space chapter’s dust, suction debris and streak motes.'],
        ['odysseyCh6NoStars', 'Removes both starfield tiers from the space chapter.'],
        ['odysseyCh6NoAurora', 'Removes the space hero’s auroral crown.'],
        ['odysseyCh6ProceduralDome', 'Restores the old procedural space dome instead of the baked dome.'],
        ['odysseyCh6NebulaSprites', 'Restores the old nebula sprites instead of the sculpted nebula field.'],
    ].map(([name, description]) => toggle(name, description, {
        scope: 'Odyssey chapter 6: Space', sources: [COSMOS],
    })),
    toggle('odysseyCh6CorridorSheets', 'Restores the retired additive haze sheets along the space corridor.', {
        scope: 'Odyssey chapter 6: Space',
        sources: ['src/rendering/odyssey/composition/odyssey-corridor-field.js'],
    }),
    parameter(
        'chapter',
        'Chooses the first isolated scene shown in the Odyssey renderer pilot.',
        'deep-ocean, earth-core, surface-world, mountain-peaks, sky-drift, cosmic-expanse, '
            + 'black-hole-transcendence, urban-dreams, path, level-nodes or threshold-breach',
        'deep-ocean',
        'earth-core',
        {
            scope: 'odyssey-webgpu-pilot.html only',
            sources: [PILOT],
            notes: 'This parameter does not choose or unlock a chapter in the game.',
        },
    ),
    parameter(
        'dist',
        'Overrides the camera distance in the isolated Odyssey renderer pilot.',
        'Number; 0 or invalid input uses the selected scene’s distance',
        'Selected scene’s authored camera distance',
        '150',
        {
            scope: 'odyssey-webgpu-pilot.html only', sources: [PILOT],
        },
    ),
    parameter(
        'nopost',
        'Disables post-processing in the isolated Odyssey renderer pilot.',
        '1 disables post-processing; other values retain it',
        'Post-processing on',
        '1',
        {
            scope: 'odyssey-webgpu-pilot.html only', sources: [PILOT],
        },
    ),
]);
