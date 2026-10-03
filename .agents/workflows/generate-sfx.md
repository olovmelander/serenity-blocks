---
description: Generate Serenity Blocks SFX candidates with local Stable Audio 3 Small-SFX
---

> **STOP — check before doing anything else.** This workflow only works where
> `C:\AI\sfx-foundry\generate-sfx.cmd` exists. Check it first
> (`Test-Path 'C:\AI\sfx-foundry\generate-sfx.cmd'`). If the file is missing, **stop and
> tell the user that SFX generation is unavailable.** Do not attempt to reinstall or
> rebuild the wrapper, Stable Audio or `C:\AI`, and do not generate audio any other way.
> (As of 2026-10-03 it is missing on the current dev machine: the machine that hosted
> `C:\AI` is gone — see the banner in `docs/ASSET_PIPELINE_BLACKWELL.md`.)

When the user invokes this workflow, use `.agents/skills/stable-audio-sfx/SKILL.md` and call:

```powershell
C:\AI\sfx-foundry\generate-sfx.cmd
```

Default examples:

```powershell
C:\AI\sfx-foundry\generate-sfx.cmd -Set Zen -Event move -Variants 8
C:\AI\sfx-foundry\generate-sfx.cmd -Set CinderDrift -Event lineClear -Variants 6
C:\AI\sfx-foundry\generate-sfx.cmd -Set Zen -Event custom -Duration 6 -Variants 4 -Prompt "<user prompt>"
```

After generation, report the raw output folder and remind the user that candidates still need review, trimming, normalization, and approval before copying into game assets.
