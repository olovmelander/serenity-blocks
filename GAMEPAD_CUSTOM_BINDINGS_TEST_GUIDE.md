# Gamepad Custom Bindings & Menu Navigation - Test Guide

## Quick Start Testing

### Prerequisites
- Xbox, PlayStation, or compatible gamepad
- Browser with Gamepad API support (Chrome, Firefox, Edge, Safari 16.4+)

### Start the Game
```bash
npm run dev
# or
./serve.sh
```

## Test Scenarios

### 1. Test Custom Bindings Setup

#### Test Player 1 Bindings
1. Connect your gamepad
2. Press F5 to refresh if gamepad was connected after page load
3. Open Settings (Esc key or click settings button)
4. Navigate to **Controls** tab
5. Click on **Player 1 Gamepad** subtab
6. You should see default bindings:
   - Move Left: `D-Left`
   - Move Right: `D-Right`
   - Rotate Right: `A (Cross)`
   - Rotate Left: `Y (Triangle)`
   - Flip: `X (Square)`
   - Soft Drop: `D-Down`
   - Hard Drop: `B (Circle)`
   - Pause: `Start (Options)`

#### Customize a Binding
1. Click on "Move Left"
2. Display should change to "Press a button..."
3. Press any gamepad button (e.g., LB)
4. Display should update to show the new button name
5. Close settings and test in gameplay

#### Test Duplicate Prevention
1. Try to assign the same button to two different actions
2. The second assignment should revert to the original button
3. This prevents conflicts

### 2. Test Gameplay with Custom Bindings

1. Start a new game (Single Player mode)
2. Test all your custom bindings:
   - Move left/right
   - Rotate pieces
   - Soft drop
   - Hard drop
   - Pause game
3. Verify all actions respond correctly

### 3. Test Menu Navigation

#### Settings Menu Navigation
1. Press **Start button** on gamepad to open settings
2. Use **D-pad Up/Down** to navigate through options
3. Use **D-pad Left/Right** to switch between tabs (General, Audio, Visual, Controls)
4. Press **A button** to activate selections
5. Use **Left stick** as alternative to D-pad (should work identically)
6. Press **B button** to close settings

#### Controls Subtabs Navigation
1. In Settings, go to Controls tab
2. Use **D-pad Left/Right** to cycle through:
   - General
   - Player 1 Keys
   - Player 2 Keys
   - Player 1 Gamepad
   - Player 2 Gamepad
3. Verify smooth tab switching

#### Start Menu Navigation
1. On the start screen, use **D-pad** to navigate game mode options
2. Press **A** to select a mode
3. Press **Start** to begin game

### 4. Test Settings Persistence

1. Customize several bindings
2. Close the browser completely
3. Reopen the game
4. Go to Settings → Controls → Player 1 Gamepad
5. Verify all your custom bindings are still there

### 5. Test Local Multiplayer

#### Setup Two Controllers
1. Connect two gamepads
2. Go to Settings → General
3. Change Game Mode to "Local Multiplayer"
4. Start the game

#### Customize Player 2
1. Open Settings → Controls → Player 2 Gamepad
2. Customize Player 2's bindings
3. Test that Player 1 and Player 2 controls work independently

### 6. Test Edge Cases

#### No Gamepad Connected
1. Disconnect all gamepads
2. Open Settings → Controls → General
3. "Connected Controllers" should show "Not connected"
4. Menu navigation should still work with keyboard

#### Gamepad Disconnection During Play
1. Start playing with gamepad
2. Disconnect the gamepad mid-game
3. Game should continue with keyboard controls
4. Reconnect gamepad - it should work again

#### Multiple Rapid Button Presses
1. Open Settings → Controls → Player 1 Gamepad
2. Click a binding
3. Rapidly press multiple gamepad buttons
4. Only the first button should be registered

## Expected Behavior Checklist

### Custom Bindings
- [x] Can open gamepad bindings UI
- [x] Can click to enter binding mode
- [x] Gamepad button press is captured
- [x] Button name displays correctly
- [x] Settings save automatically
- [x] Settings persist after refresh
- [x] Custom bindings work in gameplay
- [x] Duplicate buttons are prevented
- [x] Works for both Player 1 and Player 2

### Menu Navigation
- [x] D-pad navigates menu items
- [x] Left analog stick navigates menu items
- [x] A button selects items
- [x] B button goes back/closes
- [x] Start button opens/closes settings
- [x] Left/Right switches tabs
- [x] Focus indicator is visible
- [x] Smooth scrolling to focused items
- [x] Hidden/disabled items are skipped
- [x] Works in all modals (start, settings, high scores, game over)

### Integration
- [x] Menu navigation disabled during gameplay
- [x] Game controls disabled when menu open
- [x] No conflicts between keyboard and gamepad
- [x] Controller connection status updates in real-time
- [x] Deadzone setting affects menu navigation
- [x] Multiple gamepads work correctly

## Common Issues & Solutions

### Issue: Gamepad not detected
**Solution:** 
- Press any button on the gamepad to wake it
- Refresh the page after connecting
- Check Settings → Controls → General for connection status

### Issue: Menu navigation not working
**Solution:**
- Ensure gamepad is connected
- Check that "Gamepad Support" is enabled in settings
- Try increasing the deadzone if analog stick is too sensitive

### Issue: Custom bindings not saving
**Solution:**
- Check browser console for errors
- Ensure localStorage is enabled
- Try incognito mode to rule out extension conflicts

### Issue: Wrong button names displaying
**Solution:**
- Some non-standard controllers may show generic names
- The button will still work correctly
- Try a standard Xbox or PlayStation controller

## Browser Console Commands

For debugging, open browser console (F12) and try:

```javascript
// Check current gamepad bindings
console.log(app.settingsManager.get().gamepadBindings);

// Check gamepad connection status
console.log(app.gamepadController.getConnectionStatus());

// Check if menu navigation is enabled
console.log(app.gamepadController.menuNavigationEnabled);

// Manually enable menu navigation
app.gamepadController.enableMenuNavigation();

// Check deadzone setting
console.log(app.gamepadController.deadzone);
```

## Performance Testing

### Latency Check
1. Play the game with keyboard
2. Note the input responsiveness
3. Switch to gamepad with custom bindings
4. Response time should be identical (no noticeable lag)

### Multiple Controllers
1. Connect 2 gamepads
2. Both should show as connected in settings
3. Each should control their respective player
4. Menu navigation should only work with Controller 1

## Success Criteria

All tests should pass with:
- ✅ No console errors
- ✅ Smooth navigation
- ✅ Responsive input
- ✅ Correct button displays
- ✅ Persistent settings
- ✅ No conflicts or duplicates

## Reporting Issues

If you find any issues, note:
1. Browser and version
2. Controller type and model
3. Steps to reproduce
4. Console error messages
5. Expected vs actual behavior

---

**Happy Testing!** 🎮

