---
description: Generate Serenity Blocks SFX candidates with local Stable Audio 3 Small-SFX
---

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
