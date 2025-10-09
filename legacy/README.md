# Legacy Files

This folder contains the original monolithic code before reorganization.

## Files

- **script.js** (373KB) - Original monolithic JavaScript file containing all game logic, themes, audio, and UI
- **renderer.js** - Original WebGL renderer (now in src/rendering/renderer.js)

## Status

These files are **kept for reference only** and are **no longer used** by the application.

The modular replacements are in the `src/` directory.

## Why Keep Them?

- Historical reference
- Fallback if issues arise during migration
- Code archaeology (understanding old decisions)
- Can be deleted after successful production deployment

## Migration

See `/docs/REORGANIZATION_COMPLETE.md` for full migration details.
