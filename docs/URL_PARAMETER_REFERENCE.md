# Settings URL parameter reference

Open **Settings → URL parameters** for the temporary development reference. It is available
in development and built games. Search by parameter name, purpose, theme or tool, or filter
by category. Expand an entry for accepted values, the default, examples and source files.
The reference only displays documentation; it never applies flags, navigates, or saves settings.

The catalog documents **735 parameter names in 900 scoped entries**. Fault Lines added
`faultLines` and Waystones `waystones`, the flags that list their previews in the main menu;
the `fluid-dreams` playground effect added `quads` (four-line clears played before the frame);
Sakura Twilight keeping one fox retired `foxWhich`; Rainbow Terraces (Sky Children until
2026-10-18) added `cardAlpha` and took the V2 detail effect's four entries with it.
The 2026-10-08 audit counted 682 names in 733 entries and left every runtime reader
unchanged; the theme rebuilds merged since then account for the difference. The Koi Pond
rebuild retired that theme's old readers (`koiQuality`, `koiPerf`, `koiProfile`,
`koiReflection`, its `quality`, `profile` and `reflection` fallbacks, and the controls of the
removed `koi-pond-graded`, `koi-pond-reactions` and `koi-pond-sanctuary` playground effects)
and added the capture flags `koiTime`, `koiFixedDt`, `koiParts` and `koiFalseColor` plus the
`koi-pond` playground effect. The Winter rebuild retired that theme's nine old readers
(`winterLegacy`, which also left the flag registry, `winterBare`, `winterBaseline`,
`winterMrtAudit`, `winterNoFlakes`, `winterNoPost`, `winterNoSnow`, `winterNoStars` and
`winterStorm`) together with the controls of the six removed `winter-*` playground effects
(`winter-aurora`, `winter-landscape`, `winter-mountains`, `winter-snow-crystals`,
`winter-snowlab`, `winter-wonderland`), and added the `winter` playground effect with its
own `fox`, `plan` and `power`, plus `winterForceWebGL`, `winterTime`, `winterFixedDt`, `winterParts` and
`winterFalseColor`. The Verdant Hills rebuild added `verdantHillsForceWebGL` and
`verdantHillsSeed`, its theme joined the ones that answer `themeValidation`, and its
`verdant-hills` playground effect added `clouds`, `cover` and `kites` plus entries of its own
for `bare` and `sky`. The Void Ember rebuild retired `voidEmber` (the switch of the debug
overlay that went with the old theme), that theme's `serenity.forceWebGL` localStorage fallback
and the `burst` control of the removed `void-ember-mobile` playground effect, and added the
capture flags `voidEmberForceWebGL`, `voidEmberTime`, `voidEmberFixedDt`, `voidEmberParts` and
`voidEmberFalseColor` plus the `void-ember` playground effect (it reads 26 parameters the other
full-world effects already had, so it adds no name of its own).
The Vesper Chrysalis rebuild retired that theme's old readers (`S`, `gradeV1` and its
playground `nopost`, which the theme used to forward from the page URL, and the removed
`vesper-lake`, `vesper-relic` and `vesper-sky` playground effects) and added the capture flags
`vesperChrysalisTime`, `vesperChrysalisFixedDt`, `vesperChrysalisParts` and
`vesperChrysalisFalseColor` plus the controls of the rebuilt `vesper-chrysalis` playground
effect. The foxes' rebuild (Winter's, then Sakura Twilight's, on one shared rig) added `foxCam`,
`foxCamYaw`, `foxCamFov`, `foxAct` and `foxActAge` to the `winter` and `sakura-twilight` playground
effects, and `foxWhich` to the latter; Sakura Twilight keeping one fox of its pair
(2026-10-18) retired `foxWhich` again.
The Tornado rebuild added the capture flags `tornadoForceWebGL`, `tornadoTime`,
`tornadoFixedDt`, `tornadoParts` and `tornadoFalseColor` plus the `tornado` playground effect
(it reads 25 parameters the other full-world effects already had, so it adds no name of its
own); the theme it replaces read nothing from the URL, so no reader was retired.
The Stillwater rebuild retired that theme's old readers (`stillwaterQuality` and its `quality`
fallback, `stillwaterPerf`, `stillwaterProfile` and their `profile` alias, `stillwaterValidation`,
`stillwaterPowerPreference`, `stillwaterLayout`, `stillwaterReactionWarm` and `shafts`) together
with the controls of the eleven removed `stillwater-*` playground effects, and added the capture
flags `stillwaterTime`, `stillwaterFixedDt`, `stillwaterParts` and `stillwaterFalseColor` plus the
`stillwater` playground effect (it reads 30 parameters; `brush` is the only name of its own).
The Stellar Drift rebuild retired that theme's old readers (`stellarSeed` and its `seed`
fallback, `stellarNoPost`, `stellarNoMRT`) and added the capture flags `stellarDriftTime`,
`stellarDriftFixedDt`, `stellarDriftParts` and `stellarDriftFalseColor`; its playground effect
reads 26 parameters, all of them names its sibling effects already use.
The Starlight rebuild retired the controls of the seven removed `starlight-*` playground effects
(`aurora`, `cpu`, `dustOnly`, `period`, `sign` and their own readings of `dust`, `post` and
`stars`), and added the capture flags `starlightTime`, `starlightFixedDt`, `starlightParts` and
`starlightFalseColor` (`starlightForceWebGL` was already read) plus the `starlight` playground
effect (it reads 26 parameters; `clears` is the only name of its own).
The Stellar Velocity rebuild retired that theme's eleven old readers (`stellarVelNoPost`,
`stellarVelNoMRT`, `stellarVelNoCompute`, `stellarVelBaseline`, `stellarVelSeed`,
`stellarVelPlayback`, `stellarVelPlaybackLoops`, `stellarVelNoDrs`, `stellarVelNoEnhancements`,
`stellarVelGpuTiming` and `stellarVelMrtAudit`) and its `seed` and `fixedDt` fallbacks, and added
the capture flags `stellarVelForceWebGL`, `stellarVelTime`, `stellarVelParts` and
`stellarVelFalseColor`; `stellarVelFixedDt` stays, now read as the other capture themes read
theirs (seconds when 1 or less, else milliseconds). Its rebuilt `stellar-velocity` playground
effect no longer reads `compute`, `mrt` (both left the catalog), `seed` or `t`, and reads 25
parameters the other full-world effects already had, so it adds no name of its own.
The Ocean rebuild retired that theme's old readers (the 36 `oceanNo*` subsystem switches and
their `no*` aliases, `oceanLegacyModels`, `oceanNoStriding`, `oceanLogStartup`, `oceanHelp`,
`oceanBisect` and their short aliases) together with the controls of the removed
`ocean-reef-light` playground effect (`life`, `models`, `rendererClearOnly`), and added the
capture flags `oceanTime`, `oceanFixedDt`, `oceanParts` and `oceanFalseColor`
(`oceanForceWebGL` was already read) plus the `ocean` playground effect (it reads 33
parameters; `pass` and `passAge` are the only names of its own, and it has its own entries
for `hour` and `shafts`).
The Sunset rebuild added the capture flags `sunsetForceWebGL`, `sunsetTime`, `sunsetFixedDt`,
`sunsetParts` and `sunsetFalseColor` plus the `sunset` playground effect, which reads 27
parameters its sibling effects already had and adds `iconLanterns`, `lift`, `liftAge`, `flock`
and `flockAge` with entries of its own for `hour` and `spin`; the theme it replaces read
nothing from the URL, so no reader was retired.
The Solar Eclipse rebuild retired the controls of the removed `solar-eclipse-mobile` playground
effect (`eclipse` and `fit`, both left the catalog; the theme itself read nothing from the URL)
and added the capture flags `eclipseForceWebGL`, `eclipseTime`, `eclipseFixedDt`, `eclipseParts`
and `eclipseFalseColor` plus the `solar-eclipse` playground effect (it reads the same 26
parameters as the `starlight` effect, so it adds no name of its own).
The Serenity Warp rebuild retired the controls of the removed `serenity-warp-phase-seal` and
`serenity-warp-reactions` playground effects (`pieces`, `reduced` and `side` left the catalog;
the theme itself read only `serenityWarpForceWebGL`) and added the capture flags
`serenityWarpTime`, `serenityWarpFixedDt`, `serenityWarpParts` and `serenityWarpFalseColor`
plus the rewritten `serenity-warp` playground effect, which reads 26 parameters its sibling
effects already had and adds `turns`.
The Rainbow Terraces rebuild (the theme was called Sky Children until 2026-10-18) retired the
readers of the replaced V2 module (`skyV2NoPost`, `skyV2NoMRT`, `skyV2NoCompute`, `skyV2UseMRT`,
`skyV2Debug`, and its readings of `noPost`, `noMRT` and `noCompute`, which Cosmic Noir and its
siblings still read) and added the capture flags `rainbowTerracesForceWebGL`,
`rainbowTerracesTime`, `rainbowTerracesFixedDt`, `rainbowTerracesParts` and
`rainbowTerracesFalseColor` (named `skyChildren…` before the rename) plus the `rainbow-terraces`
playground effect, which reads 26 parameters its sibling effects already had and adds `held`,
`links`, `trueBow`, `dropRows`, `players`, `values`, `ripple` and `cardAlpha`, with entries of its
own for `hour` and `shape`. The V2 module's detail effect and its `bare`, `detail`, `view` and
`warm` entries were deleted with the rename.
The Moonlit Greenhouse rebuild added the capture flags `greenhouseForceWebGL`, `greenhouseTime`,
`greenhouseFixedDt`, `greenhouseParts` and `greenhouseFalseColor` plus the `moonlit-greenhouse`
playground effect, which reads 26 parameters its sibling effects already had and adds an entry
of its own for `night`; the DOM theme it replaces read nothing from the URL, so no reader was
retired.
The Nebula Flow rebuild added the capture flags `nebulaFlowForceWebGL`, `nebulaFlowTime`,
`nebulaFlowFixedDt`, `nebulaFlowParts` and `nebulaFlowFalseColor` plus the `nebula-flow`
playground effect, which reads 27 parameters its sibling effects already had (`turns` among
them) and adds `dbg`, the nursery's debug views; the theme it replaces read nothing from the
URL, so no reader was retired.
Thermal Bloom, a new theme added beside the others (it replaces none, so no reader was
retired), added the capture flags `thermalBloomForceWebGL`, `thermalBloomTime`,
`thermalBloomFixedDt`, `thermalBloomParts` (its parts: `sky`, `basin`, `terraces`, `steam`,
`geyser`, `flora` and `fx`) and `thermalBloomFalseColor`, plus the `thermal-bloom` playground
effect (every parameter it reads names `thermal-bloom` in its `playground.html` scope).
Its remake added four entries of its own, `sunAz` and `sunEl` (the sun held), `cam` (a free
camera for close-ups) and `chain` (a chain built link by link), and `season` now holds a place
on the year's wheel.
The Rainbark rebuild added the capture flags `rainbarkForceWebGL`, `rainbarkTime`,
`rainbarkFixedDt`, `rainbarkParts` and `rainbarkFalseColor` plus the `rainbark` playground
effect, which reads 27 parameters its sibling effects already had and adds `sheds`, with
entries of its own for `b2b`, `cascade`, `dist`, `peak` and `session`; Cosmic Chimes, the theme
it replaces, read nothing from the URL, so no reader was retired.
The scene-antialiasing pass (2026-10-16) put the `fall`, `forest`, `golden-forest`,
`sakura-twilight`, `summer` and `verdant-hills` playground effects on the shared `msaa` entry
and gave `high-coast` an `msaa` entry of its own (one more entry, no new name).
Infinity's ascent (looking around the tower, 2026-10-16) added the `infinity-ascent` playground
effect with seven names of its own: `ascentRise`, `ascentSpeed`, `ascentPresence`, `ascentTheme`,
`ascentBoard`, `ascentMotion` and `ascentQuality`. Its game layer reads only `forceWebGL`, as the
breathing guide does; the classic-WebGL exploration effect it replaces read nothing from the URL.
The Himalayan Peak eagle pass (2026-10-18) catalogued `eagle` and `eagleLens`.

Painted Ages adds the capture flags `paintedAgesForceWebGL`, `paintedAgesTime`,
`paintedAgesFixedDt`, `paintedAgesParts` and `paintedAgesFalseColor`, plus the
`painted-ages` playground effect. Its 2026-10-12 rebuild replaced the effect's controls: 27
scoped rows, among them `hour` (hold the light on the wheel of hours), `look` (an inspection
lens for icons and close-ups), `combo`, `peak`, `b2b`, `locks`, `clears` and `recordTop`;
the old `deposits`, `cascade`, `wet`, `formation`, `view`, `sun` and icon rows are retired.
Use `effect=painted-ages&t=10&hour=<place>` for a deterministic playground capture; the part
names are `land`, `sky`, `props`, `cumulus`, `poplars` and `motes`.

High Coast (2026-10-13), which replaces Mountain, adds the capture flags `highCoastForceWebGL`,
`highCoastTime`, `highCoastFixedDt`, `highCoastParts` and `highCoastFalseColor`, plus the
`high-coast` playground effect. The effect reads 27 parameters that other full-world effects
already had, among them `hour` (hold the light on the wheel of hours), `look` (an
inspection lens: `x,y,z,fov`), `lift` (metres the land has risen), `combo`, `b2b`, `locks`
and `clears`. Mountain read nothing from the URL, so no reader was retired. Use
`effect=high-coast&t=10&hour=<place>` for a deterministic playground capture; the part names
are `land`, `sea`, `sky`, `cumulus`, `forest`, `props`, `hamlet`, `fleet`, `life` and
`motes`.

Luminous Tides (2026-10-13), rebuilt in place, adds the capture flags `luminousTidesForceWebGL`,
`luminousTidesTime`, `luminousTidesFixedDt`, `luminousTidesParts` and `luminousTidesFalseColor`, plus the
`luminous-tides` playground effect, which reads 26 parameters its sibling effects already had and
adds an entry of its own for `night` (hold the wheel of nights). The legacy theme it replaces read
nothing from the URL, so no reader was retired. Use `effect=luminous-tides&t=24&night=<place>` for a
deterministic playground capture; the part names are `sky`, `shore`, `land`, `glows` and `rain`.

Pyrestorm (2026-10-13), rebuilt from its classic GLSL scene, adds the capture flags
`pyrestormForceWebGL`, `pyrestormTime`, `pyrestormFixedDt`, `pyrestormParts` and
`pyrestormFalseColor`, plus the `pyrestorm` playground effect: 29 scoped rows, among them
`watch` (hold the night on its wheel of watches), `look` (an inspection lens: `x,y,z,fov`),
`combo` (the storm's charge), `peak` (the chain a release breaks), `b2b` and `locks`. The
classic scene read nothing from the URL, so no reader was retired. Use
`effect=pyrestorm&t=10&watch=<place>` for a deterministic playground capture; the part names
are `land`, `sky`, `anvil`, `ash`, `bolts`, `jets`, `bombs` and `motes`.

Kaleidosonic (2026-10-13), a new theme in Singing Bowl's place, adds the capture flags
`kaleidosonicForceWebGL`, `kaleidosonicTime`, `kaleidosonicFixedDt`, `kaleidosonicParts` and
`kaleidosonicFalseColor`, plus the `kaleidosonic` playground effect, which reads 26 parameters its
sibling effects already had and adds `mood` (hold the moods at a place on the wheel), with
entries of its own for `b2b`, `peak` and `piece`. Singing Bowl read nothing from the URL, so no
reader was retired. Use `effect=kaleidosonic&t=10&mood=<place>` for a deterministic playground
capture; the only part name is `temple`.

The opening and menu world (2026-10-15), First Light, replaces the intro's classic renderer and
its compute simulations. It adds the `intro-world` playground effect with twelve rows of its
own: `phase` (`boot`, `open`, `title` or `menu`), `opening` (seconds into the opening),
`autoOpen`, `menu` (the title-to-menu blend), `begin` (seconds since the player began),
`title`, `ui`, `quality`, `px`, `py`, `noPost` and `reduce`. The removed
`serenity-warp-classic-profile` and `serenity-warp-tunnel-surge` effects took the `surge`
entry with them. `introV2=0` and `forceWebGL=1` still put the intro on its fallback, which is
now the same world on three's WebGL2 backend. Use `effect=intro-world&t=23.85` to see the
first stack lock.

Grainfields (2026-10-18), a new theme in Misty Lake's place, adds the capture flags
`grainfieldsForceWebGL`, `grainfieldsTime`, `grainfieldsFixedDt`, `grainfieldsParts` and
`grainfieldsFalseColor`, plus the `grainfields` playground effect, which reads 26 parameters:
`air` (switch the light in the air off) and `airGain` (scale it) are names of its own, and `hour`
holds the light on the wheel of the day. The eight `mistyLake*` readers of the theme it replaces
(`ForceWebGL`, `NoPost`, `NoReflection`, `Reflection`, `EnableReflection`, `NoMRT`,
`NoCompute` and `Debug`) are retired with it. Use `effect=grainfields&t=10&hour=<place>` for a
deterministic playground capture; the part names are `grain`, `land`, `lapporten`, `trees`, `sky`,
`beams` and `motes`.

Use `?` for the first URL parameter and `&` for additional ones, before any `#` fragment:

```text
http://localhost:5173/?unlockAll=1&skipIntro=1
```

Reload after changing the URL. Removing a parameter restores its normal reader behavior;
some readers also consult localStorage, so consult the entry's persistence notes. Parameters
are case-sensitive unless the entry explicitly says otherwise. Scope matters: options for a
particular theme, chapter, renderer, pilot page or playground effect require that context.
Some names have multiple entries because their meaning or default differs between contexts.

## Source of truth and upkeep

The display catalog lives in `src/ui/url-parameters/`, split into general, Odyssey, theme and
playground data. The files contain documentation only; the existing readers still control
behavior. The catalog is imported only when this Settings tab is first opened, without
importing theme renderers or adding reference entries to the initial page.

The initial audit checked active readers and helper calls, including dynamic theme prefixes,
network-impairment fields and options forwarded into shared playground effects. Accepted
values and defaults describe actual code rather than historical comments. Retained parsed
compatibility options are explicitly marked when they have no effect. Comment-only obsolete
flags, command-line arguments, console methods, and the declared-but-unimplemented `rngV2`
flag are excluded. The generated `demo` share URL has no active game-page reader; it is
separate from Painted Ages' documented playground `demo` control.

When adding/removing/changing a reader, update its catalog entry and source reference.
`tests/unit/url-parameter-catalog.test.js` checks metadata, valid example keys, existing source
files, registry coverage, read-only imports, and direct literal URL reads in referenced files.
Dynamic helper keys and forwarding rules still require a manual source audit.

## Verification

The follow-up passed 27 focused tests across seven suites, production build/boot-closure,
typecheck, lint/architecture/TS ratchets, boundaries, release scaffolding and shipped-artifact
checks. Twelve browser captures cover desktop (1280×800) and narrow mobile (320×568): lazy
activation, tab keyboard routing, search, category filtering, empty/reset state, disclosures,
examples and long parameter names. The browser recorded zero errors, horizontal overflow,
settings changes, storage writes or navigation. It uses actual Settings HTML, CSS and
initialization in a GPU-disabled fixture; no gameplay rendering was changed or retested.
Full local browser evidence is under `artifacts/url-parameters/browser/`.

[Desktop reference](images/url-parameters/desktop-reference.png) ·
[Mobile examples](images/url-parameters/mobile-examples.png)

## Remove the reference before release

1. Remove the `settings-tab-url-parameters` button, `settings-url-parameters` panel, and
   `/styles/url-parameters.css` link from `index.html`.
2. Remove `setupUrlParameterReference` and its initialization call from `src/ui/settings.js`.
   The `settingsSectionChanged` dispatch in `activateSettingsTab` serves this reference and
   can be removed too if no other consumer has been added.
3. Delete `src/ui/url-parameters/` and `public/styles/url-parameters.css`.
4. Remove the two dedicated URL-reference unit test files, this document, its images, and its README link.

Removing this documentation tab does not remove any runtime URL parameter. If a development
flag should also be retired for release, change its actual reader and registry separately.
