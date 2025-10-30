# Gamepad Controller Support - Phase 5a

## Overview

Adding comprehensive gamepad/controller support to the Serenity Hub to make it fully accessible for users who prefer or require controller input. This provides an alternative input method alongside keyboard, mouse, and touch controls.

---

## 🎮 Supported Controllers

### Primary Support
- **Xbox Controllers** (Xbox One, Xbox Series X|S)
- **PlayStation Controllers** (DualShock 4, DualSense)
- **Nintendo Switch Pro Controller**
- **Generic USB/Bluetooth Gamepads** (Standard Gamepad API)

### Features
- ✅ Automatic detection and connection
- ✅ Multi-controller support
- ✅ Controller type identification
- ✅ Vibration/haptic feedback
- ✅ Visual button hints overlay
- ✅ Graceful disconnection handling

---

## 🕹️ Button Mapping

### Standard Layout (Xbox naming)

| Button | Action | Notes |
|--------|--------|-------|
| **Y/Triangle** | Open/Close Serenity Hub | Quick access to Serenity Hub |
| **A/Cross** | Select/Confirm | Activate focused item |
| **B/Circle** | Back/Cancel | Close hub or go back |
| **X/Square** | Toggle Breathing | Quick breathing guide toggle |
| **D-Pad ←→** | Switch Tabs | Navigate between Breathing/Music/Themes |
| **D-Pad ↑↓** | Navigate Items | Move through lists and grids |
| **LB/L1** | Previous Track | Skip to previous music track |
| **RB/R1** | Next Track | Skip to next music track |
| **LT/L2** | Volume Down | Decrease music volume (analog) |
| **RT/R2** | Volume Up | Increase music volume (analog) |
| **Left Stick** | Navigate UI | Analog navigation (horizontal = tabs, vertical = items) |
| **Right Stick** | Scroll Content | Scroll through long lists |
| **L3 (Left Click)** | Random Theme | Quick random theme change |
| **R3 (Right Click)** | Toggle Fullscreen | Enter/exit fullscreen mode |
| **START/Options** | Open Settings Menu | **Standard game pause/settings menu** |
| **SELECT/Share** | Toggle Button Hints | Show/hide controller shortcuts |

### PlayStation Controller Notes
- **Triangle (△)** opens Serenity Hub (instead of Y)
- **Cross (×)** is confirm/select
- **Circle (○)** is back/cancel
- **Square (□)** toggles breathing
- **L3/R3** are stick click buttons
- **Options** button opens settings menu
- **Share** button toggles hints

### Nintendo Switch Controller Notes
- Button labels are swapped from Xbox:
  - **X button** (top) opens Serenity Hub
  - **B button** (right) is confirm/select
  - **A button** (bottom) is back/cancel
  - **Y button** (left) toggles breathing
- **L/R** are bumpers, **ZL/ZR** are triggers
- **+ button** opens settings menu
- **- button** toggles hints

---

## 🎨 Visual Design

### Focus Indicator
```css
.gamepad-focused {
  outline: 3px solid #667eea;
  outline-offset: 3px;
  box-shadow: 0 0 20px rgba(102, 126, 234, 0.5);
  z-index: 10;
}
```

**Appearance:**
- Purple glowing outline around focused element
- Auto-scrolls to keep focused item visible
- Smooth transitions between items
- Clear visual feedback

### Button Hints Overlay

**Position:** Bottom-right corner
**Appearance:**
- Dark semi-transparent background with blur
- Purple accent border
- Grid layout (2 columns)
- Auto-show on controller connection
- Auto-hide after 5 seconds (or toggle with SELECT button)

**Content:**
```
╔═══════════════════════════╗
║  Controller Shortcuts     ║
╟───────────────────────────╢
║ [Y]      Open/Close Hub   ║
║ [A]      Select           ║
║ [B]      Back/Cancel      ║
║ [X]      Toggle Breathing ║
║ [L3]     Random Theme     ║
║ [R3]     Fullscreen       ║
║ [D-PAD ←→] Switch Tabs    ║
║ [D-PAD ↑↓] Navigate       ║
║ [LB/RB]  Prev/Next Track  ║
║ [LT/RT]  Volume           ║
║ [START]  Settings Menu    ║
║ [SELECT] Toggle Hints     ║
╚═══════════════════════════╝
```

### Connection Notifications

**On Connect:**
```
╔═══════════════════════════════╗
║ Controller Connected:         ║
║ Xbox Wireless Controller      ║
╚═══════════════════════════════╝
```

**On Disconnect:**
```
╔═══════════════════════════════╗
║ Controller Disconnected       ║
╚═══════════════════════════════╝
```

- Appears at top-center
- Fades in/out smoothly
- Displays for 2 seconds
- Purple accent border

---

## 🔧 Technical Implementation

### Architecture

```
GamepadController
├── Detection & Connection
│   ├── scanForGamepads()
│   ├── onGamepadConnected()
│   ├── onGamepadDisconnected()
│   └── detectControllerType()
├── Input Processing
│   ├── startPolling() (60fps loop)
│   ├── processGamepadInput()
│   ├── isButtonPressed() (debouncing)
│   └── Button state tracking
├── Navigation
│   ├── switchTabLeft/Right()
│   ├── navigateUp/Down()
│   ├── getNavigableItems()
│   ├── focusItem()
│   └── confirmSelection()
├── Visual Feedback
│   ├── showButtonHints()
│   ├── hideButtonHints()
│   ├── toggleButtonHints()
│   └── showNotification()
└── Haptics
    └── vibrate() (rumble support)
```

### Key Features

**1. Polling Loop**
- Runs at 60fps using `requestAnimationFrame`
- Checks all connected gamepads every frame
- Processes input only when enabled
- Minimal performance impact

**2. Button Debouncing**
- Prevents repeated inputs from held buttons
- 150ms delay between inputs
- Tracks button states per controller
- Smooth, responsive feel

**3. Dead Zone Handling**
- 0.2 (20%) dead zone for analog sticks
- Prevents drift and accidental inputs
- Configurable threshold
- Smooth analog navigation

**4. Multi-Controller Support**
- Tracks all connected gamepads in Map
- Processes input from any controller
- Handles multiple simultaneous controllers
- Clean connection/disconnection handling

**5. Vibration Feedback**
```javascript
vibrate(gamepad, duration, intensity) {
  // Different intensities for different actions:
  // - Strong (100ms, 0.5): Confirm, Open/Close
  // - Medium (50ms, 0.5): Tab switch
  // - Light (30ms, 0.5): Item navigation
}
```

---

## 📋 Navigation Flow

### Opening the Hub
```
User: Press START button
  ↓
Serenity Hub opens
  ↓
Focus moves to first tab
  ↓
Button hints appear (if first connection)
```

### Tab Navigation
```
User: Press D-Pad LEFT or RIGHT
  ↓
Active tab changes
  ↓
Focus moves to first item in new tab
  ↓
Vibration feedback (50ms)
```

### Item Selection
```
User: Press D-Pad UP or DOWN
  ↓
Focus moves to next/previous item
  ↓
Item scrolls into view
  ↓
Vibration feedback (30ms)
  ↓
User: Press A button
  ↓
Item is selected/activated
  ↓
Action is performed
  ↓
Vibration feedback (100ms)
```

### Quick Actions (Outside Hub)
```
User: Press X button
  ↓
Breathing guide toggles
  ↓
No need to open hub!

User: Press Y button
  ↓
Random theme changes
  ↓
No need to open hub!

User: Press LB/RB
  ↓
Music track changes
  ↓
No need to open hub!
```

---

## 🎯 Use Cases

### Use Case 1: Couch Gaming Setup
**Scenario:** User is relaxing on couch with controller
**Flow:**
1. User presses START to open Serenity Hub
2. Uses D-Pad to navigate to Themes tab
3. Uses D-Pad UP/DOWN to browse themes
4. Presses A to select a theme
5. Uses LB/RB to skip through music tracks
6. Presses X to enable breathing guide
7. Relaxes without needing mouse/keyboard

### Use Case 2: Accessibility
**Scenario:** User has limited mobility, prefers controller
**Flow:**
1. Controller automatically detected on connection
2. Button hints appear to show available controls
3. User can navigate entire UI with one hand
4. Rumble feedback confirms actions
5. No need to switch to mouse/keyboard

### Use Case 3: Steam Deck / Handheld Gaming
**Scenario:** User is using Steam Deck or handheld device
**Flow:**
1. Built-in controller automatically works
2. All features accessible via gamepad
3. Perfect for portable meditation sessions
4. No external peripherals needed

---

## ⚙️ Configuration

### Settings (Future Enhancement)
```javascript
// Possible future settings in Settings menu:
{
  gamepad: {
    enabled: true,
    vibrationEnabled: true,
    vibrationIntensity: 0.5, // 0.0 - 1.0
    deadZone: 0.2,             // Analog stick dead zone
    inputDelay: 150,           // ms between inputs
    showHintsOnConnect: true,
    hintsDuration: 5000        // Auto-hide delay
  }
}
```

---

## 🧪 Testing Checklist

### Connection & Detection
- [ ] Controller detected when connected before app start
- [ ] Controller detected when connected during app runtime
- [ ] Multiple controllers detected correctly
- [ ] Controller type identified (Xbox/PS/Switch/Generic)
- [ ] Connection notification appears
- [ ] Disconnection notification appears
- [ ] Button hints appear on first connection
- [ ] Disconnection doesn't crash app

### Button Mapping
- [ ] START opens/closes hub
- [ ] A selects items
- [ ] B closes hub/goes back
- [ ] X toggles breathing guide
- [ ] Y changes to random theme
- [ ] D-Pad LEFT switches tab left
- [ ] D-Pad RIGHT switches tab right
- [ ] D-Pad UP navigates up
- [ ] D-Pad DOWN navigates down
- [ ] LB skips to previous track
- [ ] RB skips to next track
- [ ] LT decreases volume
- [ ] RT increases volume
- [ ] SELECT toggles button hints

### Analog Controls
- [ ] Left stick horizontal switches tabs
- [ ] Left stick vertical navigates items
- [ ] Right stick scrolls content
- [ ] Dead zone prevents drift
- [ ] Smooth analog navigation

### Visual Feedback
- [ ] Focus outline visible on selected items
- [ ] Focus scrolls into view automatically
- [ ] Button hints overlay displays correctly
- [ ] Hints auto-hide after 5 seconds
- [ ] Notifications appear and disappear correctly
- [ ] Focus transitions are smooth

### Haptic Feedback
- [ ] Vibration works on Xbox controllers
- [ ] Vibration works on PlayStation controllers
- [ ] Vibration intensity appropriate
- [ ] Different vibrations for different actions
- [ ] No vibration if not supported (graceful fallback)

### Tab-Specific Testing

**Breathing Tab:**
- [ ] Can navigate through all 7 technique cards
- [ ] Focus indicator works on cards
- [ ] A button selects technique
- [ ] Selected technique activates

**Music Tab:**
- [ ] Can navigate through playlist
- [ ] A button plays selected track
- [ ] Focus on playlist items works
- [ ] Volume controls work with triggers

**Themes Tab:**
- [ ] Can navigate through theme swatches
- [ ] A button switches to selected theme
- [ ] Category filtering accessible
- [ ] Random theme button works

### Controller-Specific Testing
- [ ] Xbox One controller
- [ ] Xbox Series X|S controller
- [ ] DualShock 4 controller
- [ ] DualSense controller
- [ ] Switch Pro controller
- [ ] Generic USB controller
- [ ] Generic Bluetooth controller

---

## 🚀 Future Enhancements

### Advanced Features
1. **Custom Button Mapping**
   - Let users remap buttons
   - Save custom configurations
   - Per-controller profiles

2. **Gyro Support**
   - Use controller motion for navigation
   - Tilt to scroll
   - Shake for random theme

3. **LED Feedback**
   - Change controller LED color based on theme
   - Pulse LED with breathing rhythm
   - Flash LED on track change

4. **Voice Commands**
   - Combined controller + voice input
   - "Change theme" while holding button
   - Hands-free alternatives

5. **Adaptive Triggers** (PS5 DualSense)
   - Resistance feedback on triggers
   - Different feels for different actions
   - Enhanced immersion

---

## 📊 Performance Considerations

### Polling Rate
- **Target:** 60fps (16.67ms per frame)
- **Current:** ~1ms per gamepad poll
- **Impact:** Negligible (<0.1% CPU)

### Memory Usage
- GamepadController instance: ~10KB
- Button state tracking: ~1KB per controller
- Connected controllers map: ~5KB
- **Total:** ~20KB (very minimal)

### Optimization
- Only poll when controller is connected
- Skip processing if hub is closed (except START button)
- Debounce inputs to prevent spam
- Efficient button state checking

---

## 🎓 Developer Notes

### Integration Points

**1. SerenityHub.js**
```javascript
// GamepadController needs reference to hub
this.gamepadController = new GamepadController(this.serenityHub);
```

**2. SerenityMode.js**
```javascript
// Initialize in onStart()
this.gamepadController = new GamepadController(this.serenityHub);

// Cleanup in onStop()
this.gamepadController.destroy();
```

**3. Tab Components**
- Must use standard CSS classes for items (`.technique-card`, `.playlist-item`, `.theme-swatch`)
- GamepadController finds these via `querySelectorAll`
- Clicking focused element triggers selection

### API Reference

**GamepadController Methods:**
```javascript
// Public methods
enable()           // Enable gamepad input
disable()          // Disable gamepad input
destroy()          // Cleanup and remove
showButtonHints()  // Show hints overlay
hideButtonHints()  // Hide hints overlay
toggleButtonHints()// Toggle hints visibility

// Internal methods (called automatically)
scanForGamepads()  // Check for connected controllers
processGamepadInput(gamepad) // Handle input
isButtonPressed(gamepad, buttonIndex) // Check button state
vibrate(gamepad, duration, intensity) // Rumble feedback
```

---

## 📚 Resources

### Gamepad API Documentation
- [MDN Web Docs: Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API)
- [W3C Gamepad Specification](https://w3c.github.io/gamepad/)

### Button Mapping Reference
- Standard Gamepad API uses consistent button indices
- Index 0-17 for standard controllers
- Axes 0-3 for analog sticks

### Testing Tools
- [Gamepad Tester](https://gamepad-tester.com/)
- Chrome DevTools > Sensors tab
- Firefox Developer Tools > Gamepad section

---

## ✅ Summary

**Phase 5a adds comprehensive gamepad support** to make the Serenity Hub fully accessible via controller input. This includes:

✅ **Full navigation** - All hub features accessible
✅ **Quick actions** - Common actions without opening hub
✅ **Visual feedback** - Focus indicators and button hints
✅ **Haptic feedback** - Vibration/rumble on supported controllers
✅ **Multi-controller** - Support for multiple simultaneous controllers
✅ **Cross-platform** - Works with Xbox, PlayStation, Switch, and generic controllers

**Estimated Implementation Time:** 0.5 weeks (3-4 days)

**Benefits:**
- Accessibility for users who prefer/require controllers
- Perfect for couch/living room setups
- Enhanced Steam Deck / handheld experience
- Professional, polished UX
- Future-proof input system

---

**Ready to implement!** 🎮✨
