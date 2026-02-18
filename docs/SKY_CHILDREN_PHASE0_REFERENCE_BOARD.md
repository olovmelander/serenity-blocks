# Sky Children Phase 0 Reference Board

## Purpose

This board is the locked Phase 0 visual reference set for the Sky Children theme.
- Total curated frames: `16` (within the required `12-20` range).
- Mood grouping: `sunset`, `cloud sea`, `interior haze`.
- Sources: official Sky/Journey media and conference material captures.

## Source And Capture Rules

- Capture only from official/public materials (official trailers, official talks, official screenshots).
- Store local captures in the project baseline evidence folder used by your branch workflow.
- Keep original timestamp/source notes for each frame ID so later phases can re-audit provenance.

## Curated Frame Set

| Frame ID | Mood | Source | Frame Intent | Palette Target | Anchor Check |
|---|---|---|---|---|---|
| SC-SUN-01 | Sunset | Sky official trailer | Wide valley reveal at low sun angle | `#F6C063`, `#E58D4A`, `#6A71B8` | Warm key + cool shadow split |
| SC-SUN-02 | Sunset | Sky GDC 2020 talk capture | Character silhouette against golden cloud rim | `#F3EBDD`, `#F6C063`, `#8FB6D8` | Rim separation at silhouette edge |
| SC-SUN-03 | Sunset | Journey trailer capture | Dune crest with strong horizon gradient | `#E58D4A`, `#8FB6D8`, `#6A71B8` | Colored shadows, no black crush |
| SC-SUN-04 | Sunset | Journey art promo still | Mid-distance terrain with haze layers | `#F6C063`, `#DFA67A`, `#7E97BE` | 3 depth bands readable |
| SC-SUN-05 | Sunset | Sky official screenshot | Hero cloud/sun overlap with soft bloom | `#F3EBDD`, `#F0C9A2`, `#8FB6D8` | Controlled highlight shoulder |
| SC-SUN-06 | Sunset | Sky community spotlight still | Sunset ridge with cool ambient fill | `#E58D4A`, `#6A71B8`, `#9CCDE2` | Warm/cool balance under contrast |
| SC-CLD-01 | Cloud Sea | Sky official trailer | High-altitude cloud ocean wide shot | `#F6F2E4`, `#9CCDE2`, `#7E97BE` | Cloud mass readability |
| SC-CLD-02 | Cloud Sea | Sky GDC 2020 talk capture | Cloud top silhouettes with bright rim | `#D7E3EE`, `#F0C9A2`, `#7E97BE` | Silver-lining behavior |
| SC-CLD-03 | Cloud Sea | Journey trailer capture | Soft horizon fade with volumetric separation | `#F6F2E4`, `#9CCDE2`, `#D7E3EE` | Atmosphere continuity |
| SC-CLD-04 | Cloud Sea | Sky official screenshot | Mid-altitude cloud corridor path | `#F0C9A2`, `#9CCDE2`, `#8FB6D8` | Traversable cloud depth cue |
| SC-CLD-05 | Cloud Sea | Sky gameplay capture | Backlit cloud clusters, low noise | `#D7E3EE`, `#F6F2E4`, `#7E97BE` | Soft contrast, no harsh edges |
| SC-INT-01 | Interior Haze | Sky official trailer | Interior passage with fog pocket | `#8FAFC3`, `#4F7A8E`, `#6B5B51` | Interior depth stack |
| SC-INT-02 | Interior Haze | Sky GDC 2020 talk capture | Warm lantern vs cool mist scene | `#CDA46A`, `#8FAFC3`, `#A7B2B9` | Warm accent in cool base |
| SC-INT-03 | Interior Haze | Journey trailer capture | Ruin silhouette through particulate haze | `#A7B2B9`, `#6B5B51`, `#4F7A8E` | Geometry eaten by atmosphere |
| SC-INT-04 | Interior Haze | Journey screenshot | Midground landmark with muted fill | `#8FAFC3`, `#6B5B51`, `#CDA46A` | Readable landmark silhouette |
| SC-INT-05 | Interior Haze | Sky gameplay capture | Entry tunnel to brighter exit volume | `#A7B2B9`, `#4F7A8E`, `#CDA46A` | Guided luminance path |

## Mood Coverage Gate

| Mood | Required | Actual | Status |
|---|---|---|---|
| Sunset | >= 4 | 6 | Pass |
| Cloud Sea | >= 4 | 5 | Pass |
| Interior Haze | >= 4 | 5 | Pass |

## Approval Signoff

Phase 0 reference board is approved only when all checks pass:
- [ ] Every frame has capture provenance (source + timestamp note).
- [ ] Palette targets are validated against frame captures.
- [ ] Warm/cool split is accepted by lookdev reviewer.
- [ ] Silhouette and atmosphere anchors are accepted by art reviewer.
