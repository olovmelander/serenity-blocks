# Demo Player UX Enhancement Plan

## Overview

This document outlines the current state of the demo player UX flow and proposes improvements to create a polished, consistent experience when launching and completing demo playback from both entry points:
1. **High Score Modal** - Playing a linked replay from a high score entry
2. **Demo Browser** - Playing a saved replay from the replay library

---

## Current State Analysis

### Entry Points (Working Well)

Both entry points are **consistent** and work correctly:

| Entry Point | File | Method |
|------------|------|--------|
| High Score Modal | `main.js:2850` | `_playDemoById(demoId)` |
| Demo Browser | `demo-browser.js:129` | `playDemo(id)` |

Both:
- Close all modals via `modalManager.hideAll()`
- Activate SinglePlayerMode via `gameModeManager.activateMode('single')`
- Pass demo object via `startCurrentMode({ demo: demo })`

### Playback Controls (Working Well)

The playback UI provides:
- Play/Pause button
- Stop button
- Progress bar with seeking
- Speed control (0.5x, 1.0x, 2.0x, 4.0x)
- Time display

### Identified Issues

#### Issue 1: Demo End Callback Not Wired
**Location:** `SinglePlayerMode.js:62`

The `DemoPlayer.onPlaybackEnd` callback is never set. When a demo naturally ends (runs to completion), `stopPlayback()` is called but nothing happens because the callback is undefined.

**Impact:** Demos that end naturally leave the game in a broken state with no modal shown.

#### Issue 2: Polling-Based Modal Detection
**Location:** `SinglePlayerMode.js:809-827`

```javascript
const checkModalClosed = setInterval(() => {
    const gameOverModal = document.getElementById('game-over-modal');
    if (!gameOverModal || !gameOverModal.classList.contains('visible')) {
        clearInterval(checkModalClosed);
        // ... show demo browser
    }
}, 100);
```

**Problems:**
- Inefficient: polls DOM every 100ms
- Fragile: relies on CSS class detection
- Race conditions possible
- No cleanup if modal never dismissed

#### Issue 3: No Return to Main Menu
**Location:** `SinglePlayerMode.js:819-822`

After a demo ends and the user dismisses the Game Over modal, they are automatically sent to the Demo Browser. There's no option to:
- Return to the Start Modal (main menu)
- Start a new game
- Choose where to go next

**User is essentially "trapped" in the demo browser.**

#### Issue 4: Restart Handler Bug
**Location:** `main.js:2575-2581`

When user presses Space/Enter during or after demo playback:
```javascript
if (activeMode && activeMode.getModeId() === 'single' && activeMode.isPlayingDemo) {
    this.modalManager.hideAll();
    return;  // Returns without showing any modal!
}
```

**Impact:** User left with blank screen, no way to navigate.

#### Issue 5: Redundant Cleanup Calls
**Location:** `SinglePlayerMode.js:358, 816`

`playbackControls.hide()` is called twice in different places during cleanup, indicating unclear ownership of the cleanup lifecycle.

#### Issue 6: No "Watching Demo" Visual Indicator
Users can't tell at a glance that inputs are blocked because they're watching a replay. The playback controls are the only hint.

---

## Proposed UX Flow

### Launch Flow (Keep Current)
```
User clicks ▶ on High Score OR Demo Browser
    ↓
All modals hidden
    ↓
SinglePlayerMode activated
    ↓
Demo loaded with correct seed
    ↓
Playback controls shown
    ↓
Stats bar updates in real-time
    ↓
Game board renders replay
```

### End Flow (New Design)

```
Demo completes (naturally or via Stop button)
    ↓
Playback controls hidden
    ↓
"Demo Complete" Modal shown with:
    - Final stats (score, lines, level, duration)
    - [Watch Again] button
    - [Browse Replays] button
    - [Main Menu] button
    ↓
User chooses next action
    ↓
Navigate to appropriate screen
```

### Modal Design: "Demo Complete"

```
┌─────────────────────────────────────────┐
│            REPLAY COMPLETE              │
├─────────────────────────────────────────┤
│                                         │
│    Score: 234,866     Level: 15         │
│    Lines: 147         Duration: 4:32    │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  [▶ Watch Again]  [📁 Browse Replays]   │
│                                         │
│            [🏠 Main Menu]               │
│                                         │
└─────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Fix Critical Bugs

#### 1.1 Wire Up Demo End Callback
**File:** `SinglePlayerMode.js`

In `onStart()`, when demo playback begins, set the callback:
```javascript
this.demoPlayer.onPlaybackEnd = () => {
    this._handleGameOver();
};
```

#### 1.2 Fix Restart Handler
**File:** `main.js:2575-2581`

Replace the early return with proper navigation:
```javascript
if (activeMode && activeMode.getModeId() === 'single' && activeMode.isPlayingDemo) {
    // Show demo browser instead of blank screen
    const demoBrowserModal = document.getElementById('demo-browser-modal');
    if (demoBrowserModal) {
        this.modalManager.hideAll();
        demoBrowserModal.classList.add('visible');
    }
    return;
}
```

### Phase 2: Improve Modal Flow

#### 2.1 Replace Polling with Events
**File:** `SinglePlayerMode.js`

Replace the 100ms polling with an event-based approach:

```javascript
// Instead of polling, listen for modal hide event
window.addEventListener('modalHidden', (event) => {
    if (event.detail.modalName === 'gameOver' && this.isPlayingDemo) {
        this._handleDemoComplete();
    }
}, { once: true });
```

Or use the ModalManager's existing event system if available.

#### 2.2 Create Demo Complete Modal
**File:** `index.html` + `modals.js`

Add a new modal specifically for demo completion with clear navigation options.

### Phase 3: Enhance UX

#### 3.1 Add Visual "Watching Demo" Indicator
**File:** `index.html` + `styles.css`

Add a badge or overlay that shows:
```html
<div id="demo-indicator" class="demo-indicator">
    <span class="demo-icon">▶</span>
    <span class="demo-text">WATCHING REPLAY</span>
</div>
```

#### 3.2 Consolidate Cleanup Logic
**File:** `SinglePlayerMode.js`

Create a single `_cleanupDemoPlayback()` method:
```javascript
_cleanupDemoPlayback() {
    this.demoPlayer.stopPlayback();
    this.playbackControls.hide();
    this.isPlayingDemo = false;
    // Any other cleanup
}
```

### Phase 4: Navigation Options

#### 4.1 Demo Complete Modal Actions

| Button | Action |
|--------|--------|
| Watch Again | Restart same demo from beginning |
| Browse Replays | Show Demo Browser modal |
| Main Menu | Show Start Modal |

#### 4.2 Track Entry Point (Optional Enhancement)

Store where the user came from to enable smarter "Back" behavior:
```javascript
this.demoEntryPoint = 'highScores'; // or 'demoBrowser'
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `SinglePlayerMode.js` | Wire callback, consolidate cleanup, remove polling |
| `main.js` | Fix restart handler bug |
| `modals.js` | Add `showDemoCompleteModal()` function |
| `index.html` | Add Demo Complete modal HTML, demo indicator |
| `styles.css` | Style Demo Complete modal and indicator |

---

## Testing Checklist

### Launch Tests
- [ ] Launch demo from High Score modal → Plays correctly
- [ ] Launch demo from Demo Browser → Plays correctly
- [ ] Playback controls visible and functional
- [ ] Stats bar updates during playback

### Playback Tests
- [ ] Pause/Resume works
- [ ] Speed control works (0.5x, 1x, 2x, 4x)
- [ ] Seeking via progress bar works
- [ ] Stop button ends playback correctly

### End Tests
- [ ] Demo runs to completion → Demo Complete modal shown
- [ ] Stop button pressed → Demo Complete modal shown
- [ ] "Watch Again" replays the same demo
- [ ] "Browse Replays" shows Demo Browser
- [ ] "Main Menu" shows Start Modal

### Edge Cases
- [ ] Pressing Escape during playback
- [ ] Pressing Space/Enter during playback
- [ ] Closing browser during playback
- [ ] Very short demo (<1 second)
- [ ] Very long demo (>10 minutes)

---

## Priority Order

1. **P0 (Critical):** Wire demo end callback - currently broken
2. **P0 (Critical):** Fix restart handler - leaves blank screen
3. **P1 (High):** Replace polling with events - performance/reliability
4. **P1 (High):** Create Demo Complete modal with navigation options
5. **P2 (Medium):** Add "Watching Replay" visual indicator
6. **P2 (Medium):** Track entry point for smarter "Back" behavior
7. **P3 (Low):** Consolidate cleanup logic - code quality

---

## Success Metrics

- User can always navigate away from demo playback
- No blank screens or "trapped" states
- Clear visual indication when watching a replay
- Consistent behavior whether launching from High Scores or Demo Browser
- Smooth transitions between states with no flicker or delay
