# QA Checklist

Manual test scenarios to verify Phaser-first rendering:

## Single Player
- [ ] Launch game, start single-player, verify HUD values update while playing.
- [ ] Switch themes (specific + random) and confirm background transitions smoothly.
- [ ] Toggle settings that affect visuals (line clear effects, effect quality) and observe changes live.

## Multiplayer
- [ ] Start multiplayer mode, ensure countdown overlay appears then both Phaser boards render.
- [ ] Clear lines on both boards; verify flashes, ripples, and shake intensity respond to effect quality.
- [ ] Finish a match and confirm the game-over modal appears and single-player scene resumes.

## Quality Levels
- [ ] Cycle effect quality (High/Medium/Low) and note particle density and camera shake differences.
- [ ] Ensure Low quality reduces background rendering load without visual glitches.

## Performance Smoke Tests
- [ ] Run a 5-minute single-player session (High quality) and check FPS stability.
- [ ] Repeat at Low quality; confirm background render throttles and gameplay remains smooth.
- [ ] Profile memory usage (Chrome DevTools) before/after switching themes repeatedly; verify no consistent growth.

## Regression
- [ ] Verify setting changes persist across reloads (including effect quality and theme mode).
- [ ] Confirm fallback DOM elements remain hidden when Phaser HUD/boards are active.
