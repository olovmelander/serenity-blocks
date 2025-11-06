# Trance State Feature - Infinity Mode Pause

## Overview
When you pause Infinity Mode using the "P" key, the game enters a **Trance State** - a meditative, visually calming experience designed to create a subtle and pleasant UX.

## Features

### Visual Effects
1. **Floating Particles**
   - Three layers of gently floating particles
   - Particles drift upward in a calming motion
   - Color-shifting particles that cycle through a meditative palette

2. **Color Waves**
   - Flowing sine wave patterns across the board
   - Smooth color transitions through calm purples, blues, and turquoise
   - Layered waves for depth

3. **Vignette Overlay**
   - Subtle darkening at the edges
   - Deep purple-blue tint for a trance-like atmosphere
   - Fades in smoothly when pause is activated

4. **Breathing Pulse**
   - Gentle scale animation on the game board
   - Mimics breathing rhythm (3 seconds in/out)
   - Very subtle to avoid distraction

5. **Text Overlay**
   - "PAUSED" text with calming colors
   - Helpful subtitle: "Navigate with arrow keys • Breathe • Observe"
   - Breathing animation on text opacity

### Color Palette
The trance state uses a carefully selected calming color palette:
- Slate Blue (#6a5acd)
- Medium Purple (#9370db)
- Lavender (#8b7fbf)
- Cadet Blue (#5f9ea0)
- Medium Turquoise (#48d1cc)
- Sky Blue (#87ceeb)

## How to Use

1. **Start Infinity Mode**
   - Select "Infinity Mode" from the game mode menu
   - Click "Start Game"

2. **Pause the Game**
   - Press the `P` key at any time during gameplay
   - The trance state effects will fade in smoothly

3. **Navigate While Paused**
   - Use **Arrow Keys** (Up/Down) to scroll through your build
   - Use **Page Up/Down** for faster navigation
   - Use **Home** to jump to the top of your build
   - Use **End** to jump to the spawn area (bottom)
   - Use **Mouse Wheel** to scroll
   - Click on the **Minimap** to jump to specific sections

4. **Resume the Game**
   - Press `P` again to resume
   - Trance state effects will fade out smoothly

## Technical Implementation

### Files Created
- `src/rendering/phaser/trance-state-effects.js` - Main trance state effects system

### Files Modified
- `src/core/game-modes/InfinityMode.js` - Integration with pause/resume lifecycle

### Architecture
The trance state effects are implemented as a self-contained module that:
- Integrates with the Phaser 4 scene system
- Uses the existing particle compatibility layer
- Manages its own lifecycle (start/stop/cleanup)
- Properly cleans up all resources on stop

### Effect Layers (Depth)
- 100: Vignette overlay
- 101-103: Floating particle layers
- 105-106: Color wave graphics
- 110: Text overlay (PAUSED)

## Design Philosophy

### Subtlety
All effects are designed to be **subtle and non-intrusive**:
- Low opacity values (0.08 - 0.3 max)
- Slow, smooth animations
- Calming color palette
- No harsh contrasts or sudden movements

### Performance
Effects are optimized for performance:
- Reuses existing particle textures
- Uses efficient tween system
- Proper cleanup to prevent memory leaks
- Layered approach for controlled rendering

### UX Goals
The trance state aims to:
1. Clearly indicate the game is paused
2. Create a moment of calm and reflection
3. Enhance the meditative aspect of Infinity Mode
4. Provide helpful navigation reminders
5. Make pausing feel intentional and peaceful

## Future Enhancements

Potential improvements:
- Add ambient sound effects or tones
- User-customizable color palettes
- Intensity settings (minimal/normal/immersive)
- Integration with breathing exercises
- Particle trails that respond to mouse movement
- Saved game board "snapshots" during pause

## Credits

Inspired by meditation apps and trance-inducing visual experiences, designed to enhance the mindful gameplay of Serenity Blocks.
