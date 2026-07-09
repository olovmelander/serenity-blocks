# Serenity Mode Gamepad Debug Guide

## Testing Steps

### 1. Check if gamepad is connected
Open browser console and check for:
```
[Gamepad] Controller 1 connected: [controller name]
```

### 2. Check if Serenity Mode enables gamepad
When you enter Serenity Mode, you should see:
```
[Serenity] Starting Serenity mode...
[Serenity] Serenity Hub initialized
✨ Serenity Hub initialized with gamepad support
[SerenityHub] Gamepad callbacks registered
[Gamepad] Serenity Mode enabled
```

If you see "Gamepad controller not available in dependencies", the dependency isn't being passed correctly.

### 3. Test gamepad buttons

With Serenity Mode active and controller connected, try:

| Button | Expected Action | Debug Check |
|--------|----------------|-------------|
| Y (Triangle/X on Switch) | Toggle Serenity Hub | Should see hub appear/disappear |
| X (Square/Y on Switch) | Toggle Breathing | Should see breathing animation |
| L3 (Left stick click) | Random Theme | Should see theme change |
| LB/RB | Previous/Next Track | Should hear music change |

### 4. Debug in Console

Run these commands in browser console:

```javascript
// Check if gamepad controller exists
console.log('Gamepad Controller:', window.app?.gamepadController);

// Check if Serenity Mode is active
const gameModeManager = window.app?.gameModeManager;
console.log('Current Mode:', gameModeManager?.getCurrentMode?.());

// Check if gamepad is in Serenity Mode
const gp = window.app?.gamepadController;
console.log('Serenity Mode Active:', gp?.serenityModeActive);
console.log('Has Callbacks:', !!gp?.serenityModeCallbacks);

// Check if gamepad is enabled
console.log('Gamepad Enabled:', gp?.enabled);
console.log('Gamepad Connected:', gp?.connected);

// Manual test a callback
if (gp?.serenityModeCallbacks) {
  console.log('Testing toggle hub callback...');
  gp.serenityModeCallbacks.toggleHub();
}
```

### 5. Common Issues

**Issue: "Gamepad controller not available in dependencies"**
- Solution: Make sure gamepadController is passed in main.js to GameModeManager

**Issue: Serenity Mode not enabled on gamepad**
- Check if `enableSerenityMode()` is being called
- Check if gamepadController.enabled === true

**Issue: Callbacks not defined**
- Check if setupGamepadIntegration() is being called
- Check if deps.gamepadController exists in SerenityMode

**Issue: Buttons work in game but not in Serenity Mode**
- The gamepad controller properly switches modes
- Check console for "Serenity Mode enabled" message

### 6. Force enable for testing

If nothing works, try in console:
```javascript
// Get the gamepad controller
const gp = window.app?.gamepadController;

// Manually enable Serenity Mode with test callbacks
gp.enableSerenityMode({
  toggleHub: () => console.log('HUB TOGGLED!'),
  toggleBreathing: () => console.log('BREATHING TOGGLED!'),
  randomTheme: () => console.log('THEME CHANGED!'),
  previousTrack: () => console.log('PREV TRACK!'),
  nextTrack: () => console.log('NEXT TRACK!'),
  isHubOpen: () => false
});

// Now press buttons and watch console
```

### 7. Verify polling is active

```javascript
const gp = window.app?.gamepadController;
console.log('Poll Interval:', gp?.pollInterval); // Should not be null
console.log('Enabled:', gp?.enabled); // Should be true
```

## Expected Flow

1. User starts game → GamepadController initialized and starts polling
2. User enters Serenity Mode → SerenityMode.onStart() called
3. SerenityHub created → setupGamepadIntegration() called
4. gamepadController.enableSerenityMode(callbacks) called
5. Gamepad input now routed to Serenity callbacks
6. User exits Serenity Mode → gamepadController.disableSerenityMode() called
7. Gamepad input returns to normal game controls

## Files to Check

1. `/src/main.js` - Line ~834: gamepadController passed to GameModeManager?
2. `/src/ui/serenity-hub/SerenityHub.js` - Line ~522: enableSerenityMode called?
3. `/src/ui/gamepad-controller.js` - Line ~949: processSerenityModeInput() properly routing?

## Quick Fix Attempt

If the issue persists, we may need to ensure gamepad is explicitly enabled for Serenity Mode:

In `/src/core/game-modes/SerenityMode.js`, add after SerenityHub creation:

```javascript
// Ensure gamepad is enabled for Serenity Mode
if (this.deps.gamepadController) {
    this.deps.gamepadController.enable();
}
```

