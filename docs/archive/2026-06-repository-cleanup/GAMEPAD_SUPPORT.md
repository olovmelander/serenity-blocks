# Gamepad Support Documentation

## Overview

Serenity Blocks now supports Xbox controllers and other Bluetooth gamepads with full support for up to **2 controllers** for local multiplayer gameplay.

## Features

- **Automatic Detection**: Controllers are automatically detected when connected
- **Hot-Plugging**: Connect and disconnect controllers at any time
- **Multi-Controller Support**: Up to 2 controllers for local multiplayer
- **Standard Gamepad API**: Uses W3C standard gamepad mapping (compatible with Xbox, PlayStation, and other standard controllers)
- **Customizable Settings**: Adjustable deadzone and DAS (Delayed Auto Shift) settings
- **Real-time Status Display**: See connected controllers in the settings menu

## Controller Mapping

### Standard Layout (Xbox/PlayStation)

**Movement & Actions:**
- **D-Pad Left / Left Stick Left**: Move piece left
- **D-Pad Right / Left Stick Right**: Move piece right
- **D-Pad Down / Left Stick Down**: Soft drop
- **A Button** (Cross on PS): Rotate right
- **Y Button** (Triangle on PS): Rotate left
- **X Button** (Square on PS): Flip piece 180°
- **B Button** (Circle on PS): Hard drop

**System:**
- **Start Button**: Pause/Resume game

## How to Use

### Single Player Mode
1. Connect your controller before or during gameplay
2. The controller will automatically work alongside keyboard input
3. You can use either keyboard or gamepad interchangeably

### Local Multiplayer Mode
1. Connect up to 2 controllers
2. **Controller 1** controls Player 1
3. **Controller 2** controls Player 2
4. Each player can also use their assigned keyboard controls

## Settings

Access gamepad settings via **Settings > Controls > General**:

### Gamepad Support
- **Enabled/Disabled**: Toggle gamepad input on or off
- Default: Enabled

### Gamepad Deadzone
- Adjusts the analog stick sensitivity (0-50%)
- Lower values = more sensitive (may cause drift)
- Higher values = less sensitive (requires more movement)
- Default: 25%
- Recommended: 20-30% for most controllers

### Connected Controllers
- Real-time display showing:
  - Controller 1 status and name
  - Controller 2 status and name
- Green text indicates connected controller
- Grey text indicates not connected

## Technical Details

### Files Modified/Created

**New Files:**
- `src/ui/gamepad-controller.js` - Main gamepad controller manager

**Modified Files:**
- `src/main.js` - Gamepad integration and event handling
- `src/ui/settings.js` - Gamepad settings management
- `public/index.html` - Gamepad settings UI
- `public/styles/main.css` - Gamepad status styling

### Architecture

**GamepadController Class** (`src/ui/gamepad-controller.js`):
- Manages gamepad connections and disconnections
- Polls gamepad state at ~60 FPS
- Handles button press detection with edge-triggering
- Implements DAS (Delayed Auto Shift) for smooth movement
- Supports analog stick input with configurable deadzone
- Routes inputs to appropriate player actions

**Integration Points:**
1. **Initialization**: Created in `main.js` constructor
2. **Configuration**: Settings loaded from localStorage
3. **Event Handling**: Listens for `gamepadconnected` and `gamepaddisconnected` events
4. **Action Routing**: Connects to game action callbacks (move, rotate, drop, etc.)
5. **UI Updates**: Custom `gamepadStatusChanged` events update the settings display

### Button/Axis Detection

**Edge-Triggered Actions** (fire once per press):
- Rotation (A, Y, X buttons)
- Hard drop (B button)
- Pause (Start button)

**Continuous Actions** (with DAS):
- Movement (D-pad/Left stick horizontal)
- Soft drop (D-pad down/Left stick vertical)

### DAS (Delayed Auto Shift)

The gamepad controller uses the same DAS settings as keyboard input:
- **DAS Delay**: Time before auto-repeat starts (default: 120ms)
- **DAS Interval**: Time between auto-repeats (default: 40ms)

These can be configured in **Settings > General**.

## Controller Compatibility

### Tested Controllers
- Xbox One/Series Controllers
- Xbox 360 Controllers
- PlayStation 4/5 DualShock/DualSense Controllers
- Generic USB/Bluetooth gamepads with standard mapping

### Requirements
- Browser with Gamepad API support (Chrome, Firefox, Edge, Safari 16.4+)
- Controller must use "standard" mapping

### Troubleshooting

**Controller not detected:**
1. Press any button on the controller to wake it
2. Check browser console for gamepad logs
3. Ensure gamepad support is enabled in settings
4. Try refreshing the page after connecting

**Controller inputs not working:**
1. Verify "Gamepad Support" is set to "Enabled" in settings
2. Check that you're not in a modal or menu
3. Ensure the game is not paused
4. Try adjusting the deadzone setting

**Analog stick drift:**
1. Increase the gamepad deadzone setting
2. Recommended range: 30-40% for controllers with drift

**Wrong button mapping:**
1. Some controllers may not use standard mapping
2. Check browser console for controller ID
3. Non-standard controllers may require custom mapping (future feature)

## Custom Button Mapping ✅ NEW!

You can now fully customize gamepad button mappings for both players!

### How to Customize
1. Go to **Settings > Controls**
2. Select **Player 1 Gamepad** or **Player 2 Gamepad** tab
3. Click on any action (e.g., "Move Left")
4. Press the gamepad button you want to assign
5. Settings save automatically

### Features
- Separate bindings for Player 1 and Player 2
- Visual button names (e.g., "A (Cross)", "D-Left")
- Duplicate button detection
- Instant preview of changes
- Persistent storage (saved to localStorage)

## Menu Navigation with Gamepad ✅ NEW!

Navigate all menus using your gamepad!

### Navigation Controls
- **D-Pad Up/Down or Left Stick Up/Down**: Navigate menu items
- **D-Pad Left/Right or Left Stick Left/Right**: Switch between tabs
- **A Button (Cross)**: Select/Activate item
- **B Button (Circle)**: Go back/Close menu
- **Start Button**: Open/Close settings

### Supported Menus
- Start menu
- Settings (all tabs and subtabs)
- High scores
- Game over screen

## Future Enhancements

Potential improvements for future versions:
- Visual button prompts in menus (e.g., "Press Ⓐ to continue")
- Controller vibration/haptic feedback
- Right stick support for additional actions
- Trigger button support
- Controller input visualization
- Support for more than 2 controllers (for FFA multiplayer)

## API Reference

### GamepadController Methods

```javascript
// Initialize gamepad support
gamepadController.initialize()

// Enable/disable gamepad input
gamepadController.enable()
gamepadController.disable()

// Set game actions
gamepadController.setGameActions(actions)

// Update DAS settings
gamepadController.updateDasSettings(delay, interval)

// Update custom bindings (NEW!)
gamepadController.updateBindings(player1Bindings, player2Bindings)

// Update deadzone (NEW!)
gamepadController.updateDeadzone(deadzone)

// Enable/disable menu navigation (NEW!)
gamepadController.enableMenuNavigation()
gamepadController.disableMenuNavigation()

// Get connection status
const status = gamepadController.getConnectionStatus()
// Returns: { controller1: { connected, name }, controller2: { connected, name } }

// Cleanup
gamepadController.destroy()
```

### Events

**gamepadStatusChanged**
```javascript
window.addEventListener('gamepadStatusChanged', (e) => {
    console.log('Slot:', e.detail.slot);
    console.log('Connected:', e.detail.connected);
    console.log('Name:', e.detail.name);
});
```

## Default Configuration

```javascript
gamepadEnabled: true,
gamepadDeadzone: 0.25, // 25%
```

These settings are persisted to localStorage and loaded on game start.
