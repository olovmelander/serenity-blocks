# Phaser Troubleshooting Guide

This guide covers common issues in the current Phaser-first Serenity Blocks stack.

## 1) Phaser Scene Not Rendering

### Symptoms
- Blank gameplay board.
- Logs indicate Phaser booted, but board visuals are missing.

### Checks
1. Confirm boot logs report successful scene load.
2. Verify `BoardScene` exists in `src/main.js` post-boot callback.
3. Ensure the game mode is syncing state into scene methods.

### Likely Fixes
- Re-check scene factory wiring:
  - `createBoardScene(...)`
  - `createBackgroundScene(...)`
- Validate that the Phaser parent container exists and is visible.

## 2) Background Themes Not Animating

### Symptoms
- Board renders, but background theme appears frozen or absent.

### Checks
1. Confirm `BackgroundScene` is started.
2. Check `WebGLRenderer` external loop mode logs.
3. Verify ThemeManager has active/suspended theme state as expected.

### Likely Fixes
- Ensure `startBackgroundScene()` is called after managers initialize.
- Confirm renderer lifecycle (`start`, `stop`, `suspend`, `resume`) is mode-consistent.

## 3) Multiplayer Boards Missing or Overlapping

### Symptoms
- One multiplayer board does not render.
- Viewports overlap or appear in wrong location.

### Checks
1. Confirm `ensureMultiplayerBoardScenes()` runs.
2. Verify `MultiplayerBoardScene1` and `MultiplayerBoardScene2` are active.
3. Inspect per-scene viewport config passed at start.

### Likely Fixes
- Revalidate viewport dimensions from current canvas size.
- Ensure teardown clears old scenes before re-adding.

## 4) Quality Setting Not Applied

### Symptoms
- Switching High/Medium/Low has no visible effect.

### Checks
1. Confirm `applyEffectQuality(...)` is invoked from settings changes.
2. Verify each active scene receives `setEffectQuality(...)`.
3. Confirm `WebGLRenderer` receives updated quality configuration.

### Likely Fixes
- Normalize incoming values through `src/utils/quality.js`.
- Reapply quality after mode switches and scene restarts.

## 5) Input Works But Visual Effects Don’t Trigger

### Symptoms
- Gameplay input is responsive, but combo/line-clear visuals are missing.

### Checks
1. Confirm event emissions on line clear/combo/piece lock.
2. Verify subscribers registered via `eventBus`.
3. Check scene effect methods for guard clauses and runtime errors.

### Likely Fixes
- Reconnect event subscriptions during scene activation.
- Ensure cleanup handlers do not unsubscribe too early.

## 6) Resize/Fullscreen Artifacts

### Symptoms
- Scene looks stretched or clipped after resize/fullscreen changes.

### Checks
1. Confirm Phaser scale config still matches active mode expectations.
2. Verify `resizePhaserGame()` and mode-specific resize propagation.
3. Confirm background renderer receives updated dimensions.

### Likely Fixes
- Trigger mode resize propagation through `GameModeManager`.
- Reapply viewport settings for multiplayer scenes after resize.

## Fast Debug Commands

- `npm run dev`
- Browser console:
  - Check Phaser init logs
  - Check theme switch logs
  - Check game mode activation/start logs

## References

- `PHASER_QUICKSTART.md`
- `docs/PHASER_INTEGRATION.md`
- `docs/PHASER_ARCHITECTURE.md`
- `docs/qa-checklist.md`
