---
name: stable-audio-sfx
description: Generate Serenity Blocks sound-effect candidates with the local Stable Audio 3 Small-SFX wrapper (C:\AI\sfx-foundry). Use for any game-sound request — create, prototype, batch, regenerate, or revise SFX for gameplay events (move, rotate, lock, line clear, combo), UI clicks, or a theme's soundscape (e.g. "the Zen set needs a softer chime"). Not for music tracks, the songs manifest, or repairing the wrapper itself.
---

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
