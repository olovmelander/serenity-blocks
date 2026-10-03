---
name: stable-audio-sfx
description: Generate Serenity Blocks sound-effect candidates with the local Stable Audio 3 Small-SFX wrapper (C:\AI\sfx-foundry). Use for any game-sound request — create, prototype, batch, regenerate, or revise SFX for gameplay events (move, rotate, lock, line clear, combo), UI clicks, or a theme's soundscape (e.g. "the Zen set needs a softer chime"). Not for music tracks, the songs manifest, or repairing the wrapper itself.
---

> **STOP — check before doing anything else.** This skill only works where
> `C:\AI\sfx-foundry\generate-sfx.cmd` exists. Check it first
> (`Test-Path 'C:\AI\sfx-foundry\generate-sfx.cmd'`). If the file is missing, **stop and
> tell the user that SFX generation is unavailable.** Do not attempt to reinstall or
> rebuild the wrapper, Stable Audio or `C:\AI`, and do not generate audio any other way.
> (As of 2026-10-03 it is missing on the current dev machine: the machine that hosted
> `C:\AI` is gone — see the banner in `docs/ASSET_PIPELINE_BLACKWELL.md`.)

# Stable Audio SFX

Use the shared wrapper, not direct Stable Audio commands:

```powershell
C:\AI\sfx-foundry\generate-sfx.cmd -Set Zen -Event move -Variants 8
```

Read `docs/SFX_GENERATION_WORKFLOW.md` for the full workflow, output folders, first-run Hugging Face auth step, and shipping rules.

Rules:

- Generate candidates offline only.
- Keep raw WAVs and JSON metadata under `C:\AI\sfx-foundry`.
- Use `-DryRun` before unusual custom prompts.
- If generation fails with `401 Unauthorized` or `GatedRepoError`, tell the user to accept the model terms and run the documented Hugging Face login command.
- Do not use AudioCraft/AudioGen output for shipping Serenity Blocks assets.
