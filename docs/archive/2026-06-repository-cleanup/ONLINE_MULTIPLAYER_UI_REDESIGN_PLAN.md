# Online Multiplayer UI Redesign Plan

## Overview
This document outlines the plan to reorganize the FFA (Free-For-All) online multiplayer UI to improve layout and add missing features.

## Current State

### Current Layout
```
┌──────────────────────────────────────────────────────────┐
│ [Leaderboard - Top Left]    [Kill Feed - Top Right]     │
│                                                          │
│  ┌─────────┐  ┌────────────────────┐  ┌──────────────┐ │
│  │         │  │                    │  │              │ │
│  │ Opponent│  │                    │  │     Chat     │ │
│  │ Canvases│  │   Main Canvas      │  │   (Right     │ │
│  │ (Left)  │  │                    │  │   Sidebar)   │ │
│  │         │  │                    │  │              │ │
│  └─────────┘  └────────────────────┘  └──────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Current Positions
- **Leaderboard**: Top-left overlay (20px from edges) - Purple header
- **Kill Feed**: Top-right overlay (20px from edges) - Red header
- **Chat**: Right sidebar (350px wide, full height)
- **Next Pieces**: NOT SHOWN (missing feature)

### Grid Layout
- CSS Grid: `520px (opponents) | 1fr (main) | 350px (chat)`
- Defined in: [public/styles/multiplayer-ui.css:1054-1060](public/styles/multiplayer-ui.css#L1054-L1060)

---

## Desired State

### Target Layout
```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│ [Leaderboard - Top Right]                                │
│                                                          │
│  ┌─────────┐  ┌────────────────────┐  ┌──────────────┐ │
│  │         │  │                    │  │              │ │
│  │ Opponent│  │                    │  │  Next Pieces │ │
│  │ Canvases│  │   Main Canvas      │  │   (Right     │ │
│  │ (Left)  │  │                    │  │   Sidebar)   │ │
│  │         │  │                    │  │              │ │
│  └─────────┘  └────────────────────┘  │──────────────│ │
│                                       │ Activity Feed│ │
│                                       │ (Chat + Kills│ │
│                                       │  Bottom-Right│ │
└───────────────────────────────────────┴──────────────┘─┘
```

### Target Positions
- **Leaderboard**: Move to top-right overlay (instead of top-left)
- **Activity Feed**: Bottom-right corner (unified chat + kill feed)
  - Chat messages (blue/white text)
  - Kill notifications (color-coded: green for your kills, red for deaths, yellow for others)
- **Next Pieces**: Right sidebar above activity feed
- **Kill Feed Overlay**: REMOVE (merge into activity feed)

---

## Tasks Breakdown

### Phase 1: Move Leaderboard (Top-Left → Top-Right)

**File**: [src/ui/ffa-hud.js](src/ui/ffa-hud.js)

**Changes**:
1. Locate `updateLeaderboard()` method (~line 264-319)
2. Change positioning from `left: 20px` to `right: 20px`
3. Update CSS class if needed

**CSS File**: [public/styles/multiplayer-ui.css:1546-1640](public/styles/multiplayer-ui.css#L1546-L1640)
- Change `.ffa-leaderboard` positioning
- Test with kill feed to avoid overlap

**Estimated Effort**: 15 minutes

---

### Phase 2: Merge Kill Feed into Activity Feed

**Decision**: Combine kill feed with chat into a unified "Activity Feed" in bottom-right corner.

**Files**:
- [src/ui/ffa-hud.js](src/ui/ffa-hud.js) - Remove kill feed overlay rendering
- [src/ui/multi-player-canvas-layout.js](src/ui/multi-player-canvas-layout.js) - Add kill notifications to chat

**Changes**:

#### 2.1: Remove Kill Feed Overlay
**File**: [src/ui/ffa-hud.js:128-174](src/ui/ffa-hud.js#L128-L174)

1. **KEEP** the event listeners for:
   - `'game:player:frag'` event
   - `'ffa:player-topped-out'` event

2. **REMOVE** the `renderKillFeed()` method and DOM manipulation

3. **MODIFY** event handlers to emit new events instead of rendering:
   ```javascript
   // Instead of adding to kill feed array, emit event
   eventBus.emit('activity:kill', {
     killer: killerName,
     victim: victimName,
     isLocalKill: killerName === localPlayerName,
     isLocalDeath: victimName === localPlayerName,
     timestamp: Date.now()
   });
   ```

#### 2.2: Update Activity Feed to Handle Kill Notifications
**File**: [src/ui/multi-player-canvas-layout.js](src/ui/multi-player-canvas-layout.js)

1. Listen for `'activity:kill'` event (similar to chat listener at line 95-128)

2. Add kill notifications to chat messages container:
   ```javascript
   addKillNotification(data) {
     const messageDiv = document.createElement('div');
     messageDiv.className = 'activity-message kill-notification';

     // Color coding
     if (data.isLocalKill) {
       messageDiv.classList.add('local-kill'); // Green
     } else if (data.isLocalDeath) {
       messageDiv.classList.add('local-death'); // Red
     } else {
       messageDiv.classList.add('other-kill'); // Yellow/Orange
     }

     messageDiv.innerHTML = `
       <span class="kill-icon">💀</span>
       <span class="killer">${data.killer}</span>
       <span class="kill-arrow">→</span>
       <span class="victim">${data.victim}</span>
     `;

     this.elements.chatMessages.appendChild(messageDiv);
     this.scrollChatToBottom();
   }
   ```

3. Rename "Chat" header to "Activity Feed" or keep as "Chat"

#### 2.3: Update CSS Styling
**File**: [public/styles/multiplayer-ui.css](public/styles/multiplayer-ui.css)

1. **REMOVE** kill feed overlay styles (lines 1449-1543)

2. **ADD** activity feed message styles:
   ```css
   .activity-message {
     padding: 6px 10px;
     margin-bottom: 4px;
     border-radius: 4px;
     font-size: 13px;
   }

   /* Chat messages (existing styling) */
   .chat-message {
     /* Keep existing styles */
   }

   /* Kill notifications */
   .kill-notification {
     background: rgba(50, 50, 50, 0.6);
     display: flex;
     align-items: center;
     gap: 6px;
     font-weight: 600;
   }

   .kill-notification.local-kill {
     border-left: 3px solid #4ade80; /* Green */
     color: #86efac;
   }

   .kill-notification.local-death {
     border-left: 3px solid #f87171; /* Red */
     color: #fca5a5;
   }

   .kill-notification.other-kill {
     border-left: 3px solid #fbbf24; /* Yellow */
     color: #fde047;
   }

   .kill-icon {
     font-size: 14px;
   }

   .kill-arrow {
     opacity: 0.6;
     font-size: 12px;
   }
   ```

**Estimated Effort**: 1 hour

---

### Phase 3: Reorganize Right Sidebar (Split: Next Pieces + Activity Feed)

**File**: [src/ui/multi-player-canvas-layout.js](src/ui/multi-player-canvas-layout.js)

**Current Structure** (lines 63-83):
- Chat takes entire right sidebar (350px width, full height)
- Grid area: `chat`

**Changes**:

#### 3.1: Update HTML Structure
Split right sidebar into two sections:

```html
<!-- Right Sidebar Container -->
<div class="right-sidebar">
  <!-- Top Section: Next Pieces -->
  <div class="ffa-next-pieces-section">
    <div class="section-header">Next Pieces</div>
    <div class="next-pieces-container">
      <canvas id="ffa-next-0" class="next-piece-canvas"></canvas>
      <canvas id="ffa-next-1" class="next-piece-canvas"></canvas>
      <canvas id="ffa-next-2" class="next-piece-canvas"></canvas>
    </div>
  </div>

  <!-- Bottom Section: Activity Feed (Chat + Kill Notifications) -->
  <div class="activity-feed-section">
    <div class="section-header">Activity Feed</div>
    <div class="activity-messages" id="activity-messages">
      <!-- Chat messages and kill notifications appear here -->
    </div>
    <div class="chat-input-container">
      <input type="text" id="ffa-chat-input" placeholder="Type message..." />
      <button id="ffa-chat-send">Send</button>
    </div>
  </div>
</div>
```

#### 3.2: Update CSS Grid Layout
**File**: [public/styles/multiplayer-ui.css:1054-1060](public/styles/multiplayer-ui.css#L1054-L1060)

```css
/* Keep simple 3-column grid */
grid-template-areas: "opponents main sidebar";
grid-template-columns: 520px 1fr 350px;
grid-template-rows: 100vh;

/* Right sidebar handles internal split with flexbox */
.right-sidebar {
  grid-area: sidebar;
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
}

.ffa-next-pieces-section {
  flex: 0 0 auto; /* Fixed height based on content */
  padding: 10px;
  background: rgba(20, 20, 30, 0.95);
  border-bottom: 2px solid rgba(100, 100, 150, 0.3);
}

.activity-feed-section {
  flex: 1 1 auto; /* Takes remaining space */
  display: flex;
  flex-direction: column;
  min-height: 0; /* Important for scrolling */
  background: rgba(20, 20, 30, 0.95);
}

.activity-messages {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 10px;
}

.chat-input-container {
  flex: 0 0 auto;
  padding: 10px;
  border-top: 1px solid rgba(100, 100, 150, 0.3);
}
```

#### 3.3: Rename Chat Elements
Update JavaScript references:
- `chatMessages` → `activityMessages`
- `addChatMessage()` should add `.chat-message` class to distinguish from `.kill-notification`

**Estimated Effort**: 45 minutes

---

### Phase 4: Add Next Pieces Display (NEW FEATURE)

**Current Status**: Next pieces data IS synced in P2P ([ffa-p2p-game-state.js:686,733](src/core/multiplayer/ffa-p2p-game-state.js#L686)), but NOT rendered.

**Implementation**:

#### 4.1: Create Next Pieces Container
**File**: [src/ui/multi-player-canvas-layout.js](src/ui/multi-player-canvas-layout.js)

Add after line 62 (before chat section):
```html
<!-- Next Pieces Section (Top of Right Sidebar) -->
<div class="ffa-next-pieces-section">
  <div class="next-pieces-header">Next Pieces</div>
  <div class="next-pieces-container">
    <canvas id="ffa-next-0" class="next-piece-canvas"></canvas>
    <canvas id="ffa-next-1" class="next-piece-canvas"></canvas>
    <canvas id="ffa-next-2" class="next-piece-canvas"></canvas>
  </div>
</div>
```

#### 4.2: Add CSS Styling
**File**: [public/styles/multiplayer-ui.css](public/styles/multiplayer-ui.css)

Add styles for:
- `.ffa-next-pieces-section` (container styling)
- `.next-pieces-header` (header similar to chat/leaderboard)
- `.next-pieces-container` (vertical layout for canvases)
- `.next-piece-canvas` (sizing, spacing)

Reference local multiplayer styles from [index.html:470-510](public/index.html#L470-L510)

#### 4.3: Render Next Pieces
**File**: [src/ui/multi-player-canvas-layout.js](src/ui/multi-player-canvas-layout.js)

**Option A**: Create new method in `MultiPlayerCanvasLayout`:
```javascript
drawNextPieces(nextPieces) {
  if (!nextPieces || nextPieces.length === 0) return;

  // Get canvases
  const canvases = [
    document.getElementById('ffa-next-0'),
    document.getElementById('ffa-next-1'),
    document.getElementById('ffa-next-2')
  ];

  // Render each piece using draw.js functions
  // Scale: 0.4 for first, 0.33 for others (match local multiplayer)
}
```

**Option B**: Import and adapt `drawNextPieces()` from [src/rendering/draw.js:233-312](src/rendering/draw.js#L233-L312)

**Data Source**:
- Local player's next pieces from `ffa.gameState.localPlayer.nextPieces`
- Already synced in [ffa-p2p-game-state.js:686](src/core/multiplayer/ffa-p2p-game-state.js#L686)

**Update Trigger**:
- Hook into `'ffa:render-frame'` event (already used by HUD)
- Or create dedicated `'ffa:next-pieces-updated'` event

#### 4.4: Initialize Canvases
Add to `show()` method or create `initializeNextPieces()`:
```javascript
initializeNextPieces() {
  const canvases = [
    this.elements.nextCanvas0,
    this.elements.nextCanvas1,
    this.elements.nextCanvas2
  ];

  canvases.forEach((canvas, i) => {
    const scale = i === 0 ? 0.4 : 0.33;
    canvas.width = COLS * BLOCK_SIZE * scale;
    canvas.height = ROWS * BLOCK_SIZE * scale;
  });
}
```

**Estimated Effort**: 2 hours

---

## Implementation Order

### Recommended Sequence
1. **Phase 1**: Move Leaderboard (quick win, low risk)
2. **Phase 2**: Reposition Kill Feed (depends on Phase 1)
3. **Phase 3**: Reorganize Chat (moderate complexity)
4. **Phase 4**: Add Next Pieces (most complex, new feature)

### Alternative: Parallel Approach
- Do Phases 1 & 2 together (both in `ffa-hud.js`)
- Do Phases 3 & 4 together (both modify right sidebar)

---

## Testing Checklist

### Phase 1: Leaderboard Position
- [ ] Run `window.testMultiplayer(2)` and start match
- [ ] Verify leaderboard appears in top-right (not top-left)
- [ ] Check no overlap with other UI elements
- [ ] Confirm scores/rankings update correctly

### Phase 2: Activity Feed with Kill Notifications
- [ ] Verify kill feed overlay is removed (no top-right overlay)
- [ ] Send chat messages - appear in activity feed
- [ ] Trigger kills - notifications appear in activity feed
- [ ] Check color coding:
  - [ ] Your kills = Green
  - [ ] Your deaths = Red
  - [ ] Other kills = Yellow/orange
- [ ] Verify chronological order (newest at bottom)
- [ ] Test auto-scroll to bottom

### Phase 3: Right Sidebar Split
- [ ] Verify sidebar has two sections (next pieces top, activity feed bottom)
- [ ] Check activity feed is scrollable when full
- [ ] Verify chat input works at bottom
- [ ] Test layout with varying content amounts

### Phase 4: Next Pieces Display
- [ ] Verify 3 next pieces shown at top of sidebar
- [ ] Check pieces render correctly (shapes, colors)
- [ ] Confirm pieces update when new pieces spawn
- [ ] Test with different piece types

### Integration Testing
- [ ] Test with 2, 3, and 4 players
- [ ] Verify all UI elements visible simultaneously
- [ ] Check performance (no lag from UI updates)
- [ ] Test on different screen sizes if applicable
- [ ] Verify P2P events trigger correctly (kills, chat)

---

## Files to Modify

### Primary Files
1. [src/ui/ffa-hud.js](src/ui/ffa-hud.js) - Leaderboard & Kill Feed positioning
2. [src/ui/multi-player-canvas-layout.js](src/ui/multi-player-canvas-layout.js) - Chat & Next Pieces
3. [public/styles/multiplayer-ui.css](public/styles/multiplayer-ui.css) - All CSS styling

### Reference Files (Read-Only)
1. [src/rendering/draw.js:233-312](src/rendering/draw.js#L233-L312) - Next pieces rendering logic
2. [public/index.html:470-510](public/index.html#L470-L510) - Local multiplayer next pieces HTML
3. [src/core/multiplayer/ffa-p2p-game-state.js:686,733](src/core/multiplayer/ffa-p2p-game-state.js#L686) - Next pieces data sync

---

## Benefits of Unified Activity Feed

1. **Single Information Stream**: Players don't have to look in multiple places for game events
2. **Better Context**: Kill notifications appear chronologically with chat messages
3. **Cleaner UI**: Removes floating overlay (kill feed), less visual clutter
4. **Color Coding**: Easy to distinguish at a glance:
   - Chat messages: White/blue text
   - Your kills: Green border/text
   - Your deaths: Red border/text
   - Other kills: Yellow/orange border/text
5. **Space Efficient**: Frees up screen real estate for next pieces display

## Open Questions

1. **Activity Feed Header**: Call it "Activity Feed" or "Chat"?
   - "Activity Feed" is more accurate (includes kills)
   - "Chat" is simpler and familiar

2. **Next Pieces Count**: Show 3 pieces (like local) or more/less?
   - Recommend: 3 pieces (matches local multiplayer)

3. **Kill Notification Details**: Include additional info?
   - Just "Killer → Victim" (simple)
   - Add weapon/method if applicable
   - Add timestamp?

4. **Message Retention**: How many messages to keep in activity feed?
   - Current chat: unlimited (scrollable)
   - Old kill feed: max 10 entries with 10s fade
   - Recommend: Keep all in scrollable feed, no auto-removal

---

## Estimated Total Effort
- **Phase 1** (Move Leaderboard): 15 minutes
- **Phase 2** (Merge Kill Feed): 1 hour
- **Phase 3** (Reorganize Sidebar): 45 minutes
- **Phase 4** (Add Next Pieces): 2 hours
- **Testing & Polish**: 1 hour
- **Total**: ~5 hours

---

## Visual Mockup of Activity Feed

```
┌────────────────────────────────────┐
│        Activity Feed               │
├────────────────────────────────────┤
│ [👤 Alice]: gl hf everyone!        │  ← Chat message (white)
│ 💀 Dev_431 → Bob                   │  ← Your kill (green border)
│ [👤 Bob]: nice shot                │  ← Chat message (white)
│ 💀 Charlie → Dev_431               │  ← Your death (red border)
│ 💀 Alice → Bob                     │  ← Other kill (yellow border)
│ [👤 Dev_431]: gg                   │  ← Chat message (white)
│                                    │
│ [scroll if more messages...]      │
├────────────────────────────────────┤
│ [Type message...] [Send]          │  ← Input at bottom
└────────────────────────────────────┘
```

## Implementation Notes

### Event Flow for Kill Notifications
1. **Kill Event Occurs** → `'game:player:frag'` or `'ffa:player-topped-out'`
2. **ffa-hud.js** → Emits `'activity:kill'` event (instead of rendering overlay)
3. **multi-player-canvas-layout.js** → Listens for `'activity:kill'`
4. **Activity Feed** → Adds formatted notification to message container
5. **Auto-scroll** → Scrolls to bottom to show new notification

### CSS Color Reference
- **Chat Messages**: `color: #e0e0e0` (light gray/white)
- **Your Kills**: `border-left: 3px solid #4ade80; color: #86efac` (green)
- **Your Deaths**: `border-left: 3px solid #f87171; color: #fca5a5` (red)
- **Other Kills**: `border-left: 3px solid #fbbf24; color: #fde047` (yellow)

### Data Already Available
- Chat messages: Synced via P2P `'game:chat'` event
- Kill events: Already captured in [ffa-hud.js:128-174](src/ui/ffa-hud.js#L128-L174)
- Next pieces: Already synced in [ffa-p2p-game-state.js:686](src/core/multiplayer/ffa-p2p-game-state.js#L686)
- Player names: Available in game state for proper identification

### Backward Compatibility
- No breaking changes to P2P protocol
- Kill feed overlay can be removed without affecting gameplay
- Chat functionality remains unchanged (just visual reorganization)
- All existing event listeners remain functional
