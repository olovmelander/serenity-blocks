# Settings URL parameter reference

Open **Settings → URL parameters** for the temporary development reference. It is available
in development and built games. Search by parameter name, purpose, theme or tool, or filter
by category. Expand an entry for accepted values, the default, examples and source files.
The reference only displays documentation; it never applies flags, navigates, or saves settings.

The catalog documents **724 parameter names in 762 scoped entries**.
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
effects, and `foxWhich` to the latter.
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
flag are excluded. The generated `demo` share URL has no active URL reader and is also excluded.

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
