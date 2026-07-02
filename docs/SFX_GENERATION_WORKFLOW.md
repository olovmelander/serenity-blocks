# Stable Audio SFX Workflow

Serenity Blocks uses a shared local Stable Audio 3 Small-SFX setup for AI-generated sound-effect candidates.

## Local Install

- Stable Audio repo: `C:\AI\stable-audio-3`
- Shared wrapper: `C:\AI\sfx-foundry\generate-sfx.cmd`
- Prompt library: `C:\AI\sfx-foundry\prompts\serenity-blocks.json`
- Hugging Face cache: `C:\AI\hf-cache`
- Raw candidates: `C:\AI\sfx-foundry\raw`
- Approved exports: `C:\AI\sfx-foundry\final`

The wrapper is the contract for Codex, Claude Code, and Antigravity. Agents should call it instead of invoking Stable Audio directly.

## First-Run Unlock

Stable Audio 3 Small-SFX is gated on Hugging Face. Before the first real generation:

1. Accept the model terms at `https://huggingface.co/stabilityai/stable-audio-3-small-sfx`.
2. Authenticate the local cache:

```powershell
cd C:\AI\stable-audio-3
$env:HF_HOME = "C:\AI\hf-cache"
uv run --no-sync hf auth login
```

If generation fails with `GatedRepoError` or `401 Unauthorized`, the terms/login step is still incomplete.

## Generate Candidates

List known prompt-library events:

```powershell
C:\AI\sfx-foundry\generate-sfx.cmd -ListEvents
```

Generate variants from the prompt library:

```powershell
C:\AI\sfx-foundry\generate-sfx.cmd -Set Zen -Event move -Variants 8 -Seed 1000
```

Generate a one-off custom prompt:

```powershell
C:\AI\sfx-foundry\generate-sfx.cmd -Set Zen -Event custom -Duration 6 -Variants 4 -Prompt "glowing puzzle lines dissolve into soft glass shimmer, no music, no voice"
```

Use `-DryRun` to verify prompt resolution and metadata without invoking the model.

## Production Rules

- Generate candidates offline only; never generate SFX during gameplay.
- Keep raw WAVs and JSON metadata in `C:\AI\sfx-foundry`.
- Pick, trim, fade, normalize, and convert approved assets before copying them into the game.
- Prefer Small-SFX for gameplay SFX. Use Medium later only for longer ambience, cinematic stingers, or music-adjacent sounds.
- Do not use AudioCraft/AudioGen output for shipping assets; its released weights are non-commercial.
- Before shipping, verify the current Stability AI Community License eligibility and keep metadata for every approved generated sound.

## Current Install Notes

Installed with Python 3.10, `uv`, and PyTorch `2.7.1+cu128` for the RTX 5080 Laptop GPU.
