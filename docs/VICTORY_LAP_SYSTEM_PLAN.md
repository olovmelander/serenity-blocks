# Universal Victory Lap System - Implementation Plan

## Overview

The Victory Lap System allows players to continue playing after completing the primary goal of a level. This provides a consistent experience across all level types and goal conditions, enabling players to push for better star ratings without the level ending immediately upon goal completion.

## Current Behavior

```
[Playing] → [Goal Met] → [Level Ends] → [Results Screen]
```

**Problem:** If 3-star requirements exceed the primary goal (e.g., goal = 3 cascades, 3-star = 5 cascades), players cannot achieve 3 stars because the level ends at goal completion.

## New Behavior (Victory Lap)

```
[Playing] → [Goal Met] → [Victory Lap Phase] → [Player Chooses to End OR Top-Out] → [Results Screen]
```

**Solution:** When the goal is met, the level doesn't end. Instead, a "Goal Complete!" overlay appears, and gameplay continues. The player can:
1. **Press Enter/Escape** to finish and see results
2. **Keep playing** to improve their star rating
3. **Top-out** which also ends the level (no penalty, stars calculated from final metrics)

---

## Phase 1: Core State Machine

### 1.1 Add Victory Lap State to GameState

**File:** `src/core/game.js`

Add a new state flag to track victory lap mode:

```javascript
// In GameState constructor or reset
this.goalComplete = false;      // True when primary goal is met
this.victoryLapActive = false;  // True when in victory lap phase
this.victoryLapStartTime = null; // When victory lap began
```

### 1.2 Update Victory Condition Check

**File:** `src/core/game-modes/JourneyMode.js`

Modify `_checkVictoryConditions()` to enter victory lap instead of ending level:

```javascript
_checkVictoryConditions() {
    if (this.levelCompleting || !this.currentLevelConfig || !this.gameState) return;

    // Check if goal is met for the first time
    if (!this.gameState.goalComplete && this.hybridEngine.checkVictory()) {
        console.log('[Journey] Goal complete! Entering Victory Lap...');
        this._enterVictoryLap();
        return;
    }

    // Failure conditions still end the level immediately
    if (this.hybridEngine.checkFailure()) {
        this.failLevel('time');
    }
}
```

### 1.3 Implement Victory Lap Entry

**File:** `src/core/game-modes/JourneyMode.js`

Add new method to handle victory lap transition:

```javascript
_enterVictoryLap() {
    this.gameState.goalComplete = true;
    this.gameState.victoryLapActive = true;
    this.gameState.victoryLapStartTime = performance.now();

    // Show goal complete overlay (doesn't pause game)
    this._showGoalCompleteOverlay();

    // Update HUD to show victory lap state
    if (this.journeyHUD) {
        this.journeyHUD.enterVictoryLap();
    }

    // Play celebration sound/effect
    this.deps?.audioManager?.play('goalComplete');

    // Emit event for other systems
    eventBus.emit(EVENTS.JOURNEY_GOAL_COMPLETE, {
        levelId: this.currentLevelId,
        metrics: this.levelMetrics,
    });
}
```

### 1.4 Handle Victory Lap Exit

**File:** `src/core/game-modes/JourneyMode.js`

Add method to finish victory lap:

```javascript
_finishVictoryLap() {
    if (!this.gameState.victoryLapActive) return;

    console.log('[Journey] Victory lap finished, completing level...');
    this.gameState.victoryLapActive = false;

    // Hide overlay
    this._hideGoalCompleteOverlay();

    // Complete the level with final metrics
    this.completeLevel({});
}
```

---

## Phase 2: Input Handling

### 2.1 Add Victory Lap Key Handler

**File:** `src/core/game-modes/JourneyMode.js`

Update input handling to detect finish key during victory lap:

```javascript
_setupVictoryLapInputs() {
    const handler = (e) => {
        if (!this.gameState?.victoryLapActive) return;

        // Enter or Escape to finish
        if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            this._finishVictoryLap();
        }
    };

    document.addEventListener('keydown', handler);
    this.cleanupHandlers.push(() => document.removeEventListener('keydown', handler));
}
```

### 2.2 Handle Top-Out During Victory Lap

**File:** `src/core/game-modes/JourneyMode.js`

Modify top-out handling to complete level instead of failing:

```javascript
// In game loop or game-over check
if (checkGameOver(this.gameState)) {
    if (this.gameState.victoryLapActive) {
        // During victory lap, top-out just ends the level (not a failure)
        console.log('[Journey] Top-out during victory lap - completing level');
        this._finishVictoryLap();
    } else {
        // Before goal complete, top-out is a failure
        this.failLevel('top-out');
    }
}
```

---

## Phase 3: UI Components

### 3.1 Goal Complete Overlay

**File:** `src/ui/journey/GoalCompleteOverlay.js` (new file)

Create a non-blocking overlay that appears when goal is met:

```javascript
export class GoalCompleteOverlay {
    constructor() {
        this.container = null;
        this.isVisible = false;
        this._create();
    }

    _create() {
        this.container = document.createElement('div');
        this.container.id = 'goal-complete-overlay';
        this.container.innerHTML = `
            <div class="goal-complete-content">
                <div class="goal-complete-title">GOAL COMPLETE!</div>
                <div class="goal-complete-subtitle">
                    Keep playing for more stars or press <kbd>Enter</kbd> to finish
                </div>
                <div class="goal-complete-stars">
                    <!-- Dynamic star display -->
                </div>
            </div>
        `;
        // Styling: semi-transparent, positioned at top, doesn't block gameplay
    }

    show() { /* ... */ }
    hide() { /* ... */ }
    updateStars(current, potential) { /* ... */ }
    destroy() { /* ... */ }
}
```

**Styling considerations:**
- Semi-transparent background (doesn't obscure board completely)
- Positioned at top of screen, above the board
- Animate in with subtle scale/fade
- Shows current stars and potential next star threshold
- Pulsing "Press Enter to finish" text

### 3.2 Update JourneyHUD for Victory Lap

**File:** `src/ui/journey/JourneyHUD.js`

Add victory lap state display:

```javascript
enterVictoryLap() {
    // Change objective section to show "VICTORY LAP"
    this.objectiveDisplay.textContent = 'VICTORY LAP';
    this.objectiveDisplay.style.color = 'rgba(100, 255, 150, 1)';

    // Update progress bar to green/gold
    this.progressBar.style.background = 'linear-gradient(90deg, #4ade80, #fbbf24)';

    // Add pulsing glow effect
    this.container.classList.add('victory-lap-active');

    // Show "Press Enter to finish" hint
    this._showFinishHint();
}

exitVictoryLap() {
    this.container.classList.remove('victory-lap-active');
    this._hideFinishHint();
}

_showFinishHint() {
    if (!this.finishHint) {
        this.finishHint = document.createElement('div');
        this.finishHint.className = 'finish-hint';
        this.finishHint.textContent = 'Press Enter to finish';
        this.finishHint.style.cssText = `
            text-align: center;
            font-size: 10px;
            color: rgba(255, 255, 255, 0.7);
            margin-top: 8px;
            animation: pulse 2s ease-in-out infinite;
        `;
        this.container.appendChild(this.finishHint);
    }
    this.finishHint.style.display = 'block';
}
```

### 3.3 Star Progress Indicator

Show players how close they are to the next star during victory lap:

```javascript
// In JourneyHUD
updateStarProgress(metrics) {
    const nextStarRequirements = this._getNextStarRequirements();
    if (!nextStarRequirements) return; // Already at 3 stars

    // Show progress toward next star
    // e.g., "Next star: 2 more cascades" or "Next star: depth 3 cascade"
}
```

---

## Phase 4: Audio & Visual Feedback

### 4.1 Sound Effects

**File:** `src/audio/audio-manager.js`

Add new sound events:

```javascript
// New sounds to add
'goalComplete': 'goal-complete.mp3',      // Triumphant but not final
'victoryLapStart': 'victory-lap.mp3',     // Upbeat continuation
'starEarned': 'star-earned.mp3',          // When a new star is achieved during victory lap
```

### 4.2 Visual Effects

**File:** `src/rendering/phaser/board-scene.js`

Add victory lap visual feedback:

```javascript
onGoalComplete() {
    // Golden border glow around board
    this.addBoardGlow('#fbbf24', 0.5);

    // Particle burst
    this.emitCelebrationParticles();

    // Subtle background color shift
    this.transitionBackgroundTint('#1a1a2e', '#1e2a1e', 2000);
}
```

---

## Phase 5: Update Level Configurations

### 5.1 Star Requirements Philosophy

With Victory Lap, star requirements can now exceed the primary goal. Establish guidelines:

| Star | Requirement Pattern |
|------|-------------------|
| 1 Star | Complete the primary goal |
| 2 Stars | Goal + quality metric (depth, time, combo) |
| 3 Stars | Goal + higher quality OR quantity beyond goal |

### 5.2 Revert Level 2 Changes

**File:** `src/core/journey/data/levels.js`

Since Victory Lap allows continued play, we can restore quantity-based 3-star requirements:

```javascript
// Level 2 - Crystal Cascade
stars: {
    one: { cascades: 3 },                        // Complete goal
    two: { cascades: 3, maxCascadeDepth: 2 },    // Goal + depth
    three: { cascades: 5, maxCascadeDepth: 3 },  // More cascades + deeper chains
},
```

### 5.3 Audit All Levels

Review all 55 levels to ensure star requirements make sense with Victory Lap:

- **Lines levels:** 3-star can require faster time or more tetrises
- **Cascade levels:** 3-star can require more cascades or deeper chains
- **Score levels:** 3-star can require higher score thresholds
- **Time survival:** 3-star can require longer survival

---

## Phase 6: Testing & Edge Cases

### 6.1 Test Scenarios

| Scenario | Expected Behavior |
|----------|------------------|
| Complete goal, immediately press Enter | Level ends, stars calculated |
| Complete goal, keep playing, earn more stars | Stars update in real-time, level ends when Enter pressed |
| Complete goal, top-out | Level ends (not failure), stars from final metrics |
| Complete goal during cascade animation | Wait for animation, then show overlay |
| Pause during victory lap | Normal pause behavior, overlay persists |
| Time-based failure during victory lap | N/A - time failures happen before goal completion |

### 6.2 Edge Cases

1. **Already at 3 stars when goal completes:** Show "Perfect!" instead of "Keep playing for more stars"
2. **Goal completes on same frame as top-out:** Goal completion takes priority
3. **Player AFKs during victory lap:** No timeout, let them take their time
4. **Multiplayer consideration:** Victory lap is single-player only (for now)

---

## Phase 7: Implementation Order

### Step 1: Core State (Est. 1-2 hours)
- [ ] Add `goalComplete` and `victoryLapActive` to GameState
- [ ] Modify `_checkVictoryConditions()` to enter victory lap
- [ ] Add `_enterVictoryLap()` and `_finishVictoryLap()` methods
- [ ] Handle top-out during victory lap

### Step 2: Input Handling (Est. 30 min)
- [ ] Add Enter/Escape key handling for victory lap finish
- [ ] Ensure normal gameplay inputs still work during victory lap

### Step 3: Basic UI (Est. 1-2 hours)
- [ ] Create `GoalCompleteOverlay` component
- [ ] Update `JourneyHUD` with victory lap state
- [ ] Add "Press Enter to finish" hint

### Step 4: Visual Polish (Est. 1-2 hours)
- [ ] Add goal complete celebration effects
- [ ] Add board glow during victory lap
- [ ] Update progress bar styling

### Step 5: Audio (Est. 30 min)
- [ ] Add goal complete sound
- [ ] Add star earned sound (during victory lap)

### Step 6: Level Config Audit (Est. 1 hour)
- [ ] Update Level 2 star requirements
- [ ] Audit other cascade levels
- [ ] Audit remaining levels for consistency

### Step 7: Testing (Est. 1-2 hours)
- [ ] Test all goal types (lines, cascades, score, time)
- [ ] Test edge cases
- [ ] Test with tall boards (infinity mode)

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/core/game.js` | Add `goalComplete`, `victoryLapActive` state |
| `src/core/game-modes/JourneyMode.js` | Victory lap logic, input handling |
| `src/ui/journey/JourneyHUD.js` | Victory lap display state |
| `src/ui/journey/GoalCompleteOverlay.js` | **NEW** - Overlay component |
| `src/core/journey/data/levels.js` | Update star requirements |
| `src/events/event-bus.js` | Add `JOURNEY_GOAL_COMPLETE` event |
| `public/styles/main.css` | Victory lap styling |

---

## Success Criteria

1. **Consistent behavior:** All level types use the same victory lap flow
2. **Player agency:** Players choose when to end, not forced by goal completion
3. **Clear feedback:** Players know they can continue and see star progress
4. **No regressions:** Failure conditions, pause, and other systems work correctly
5. **Polish:** Smooth animations, satisfying sounds, clear UI

---

## Future Enhancements

- **Victory lap timer:** Optional countdown after goal (for speedrun modes)
- **Victory lap challenges:** Bonus objectives only available after goal
- **Leaderboards:** Track both "goal time" and "total time" separately
- **Achievements:** "Perfect Victory Lap" - reach 3 stars within 30 seconds of goal
