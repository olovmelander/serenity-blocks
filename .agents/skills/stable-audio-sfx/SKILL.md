---
name: stable-audio-sfx
description: Generate Serenity Blocks sound-effect candidates with the local Stable Audio 3 Small-SFX wrapper. Use when asked to create, prototype, batch, or revise gameplay/UI/theme SFX.
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
