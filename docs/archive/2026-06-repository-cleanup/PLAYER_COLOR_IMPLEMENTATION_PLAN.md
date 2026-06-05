# Player Color Implementation Plan for Multiplayer FFA

## Overview
Implement a system where each player in a multiplayer FFA game gets assigned a unique color that:
1. Appears next to their name in all UI elements
2. Colors the garbage meter when they send garbage to you
3. Colors the garbage rows they send to other players

This makes it clear who is attacking you during intense multiplayer matches.

---

## Current State Analysis

### Where Players Are Stored
- **Main State**: `FFAGameStateP2P` class (`src/core/multiplayer/ffa-p2p-game-state.js`)
  - Players stored in `Map<steamId, PlayerState>`
  - Each player has: `steamId`, `name`, `gameState`, `garbageQueue`, `isAlive`, `frags`

### Where Player Names Are Displayed
1. **Opponent Canvas Wrappers** (`src/ui/multi-player-canvas-layout.js`, line ~902)
   - Method: `createOpponentCanvas(opponent)`
   - Shows player name in `.opponent-name` div
   
2. **Main Player Header** (`src/ui/multi-player-canvas-layout.js`, line ~61)
   - Element: `#main-player-name`
   
3. **Sidebar Leaderboard** (`src/ui/multi-player-canvas-layout.js`, line ~412)
   - Method: `updateSidebarLeaderboard()`
   - Shows all players ranked by frags/score

4. **Activity Feed** (`src/ui/multi-player-canvas-layout.js`, line ~196+)
   - Chat messages show player names
   - Kill notifications show killer/victim names

5. **Lobby Waiting Room** (`src/ui/lobby-waiting-room.js`)
   - Shows player list before match starts

### Where Garbage Is Sent
- **Attack Router** (`src/core/multiplayer/ffa-attack-router.js`)
  - Method: `sendGarbageToPlayer(opponent, lines, cascadeSummary, attacker)` (line ~93)
  - Already passes `attackerId` in context
  - Already has partial support for `color` in context (line ~96)

### Where Garbage Is Created
- **Garbage Module** (`src/core/garbage.js`)
  - Function: `insertGarbageEntries(lockedPieces, entries, options)` (line ~536)
  - Creates garbage pieces with `color` property (line ~607)
  - Already supports custom colors via `entry.color`

### Where Garbage Meter Is Drawn
- **Multi-Player Layout** (`src/ui/multi-player-canvas-layout.js`)
  - Method: `drawGarbageIndicator(ctx, lineCount, canvasWidth, canvasHeight)` (line ~1303)
  - Currently draws red garbage meter
  - Need to pass sender color information

### Test Functions
- **testMultiplayer** (`src/main.js`, line ~1914)
  - Method: `testMultiplayerUI(playerCount)`
  - Creates mock multiplayer game with N players

---

## Implementation Plan

### Phase 1: Define Player Color System

**File: `src/core/constants.js`**
- [ ] Add `PLAYER_COLORS` array with 8 distinct, vibrant colors
- [ ] Colors should be different from tetromino colors for clarity
- [ ] Use high-contrast colors that work well on dark backgrounds

```javascript
export const PLAYER_COLORS = [
  '#ff1744', // Red (primary player color)
  '#2979ff', // Blue
  '#00e676', // Green
  '#ffea00', // Yellow
  '#e040fb', // Purple
  '#00e5ff', // Cyan
  '#ff9100', // Orange
  '#f50057', // Pink
];
```

---

### Phase 2: Add Player Color to Player State

**File: `src/core/multiplayer/ffa-p2p-game-state.js`**

#### Task 2.1: Assign Colors When Players Join
- [ ] Modify `addPlayer(steamId, name, isLocal)` method (line ~74)
- [ ] Assign color based on join order: `this.players.size % PLAYER_COLORS.length`
- [ ] Store color in player state: `playerState.color = PLAYER_COLORS[colorIndex]`

```javascript
addPlayer(steamId, name, isLocal = false) {
  const colorIndex = this.players.size % PLAYER_COLORS.length;
  const player = {
    steamId,
    name,
    color: PLAYER_COLORS[colorIndex], // NEW
    gameState: new GameState(),
    garbageQueue: new GarbageQueue(),
    isAlive: true,
    frags: 0,
    isLocal: isLocal
  };
  this.players.set(steamId, player);
  // ... rest of method
}
```

#### Task 2.2: Sync Colors Across Network
- [ ] Include `color` in serialized player data
- [ ] In `broadcastStateSync()` method (line ~305), ensure color is included
- [ ] In `handleStateSync()` method (line ~352), apply received colors

---

### Phase 3: Pass Player Color to Garbage System

**File: `src/core/multiplayer/ffa-attack-router.js`**

#### Task 3.1: Include Attacker Color in Context
- [ ] Modify `sendGarbageToPlayer()` method (line ~93)
- [ ] Change `context.color` to use `attacker.color` instead of piece color

```javascript
sendGarbageToPlayer(opponent, lines, cascadeSummary, attacker) {
  const context = {
    color: attacker.color, // CHANGED: Use player color instead of piece color
    attackerId: attacker.steamId,
  };
  
  const garbageAttack = calculateGarbage(cascadeSummary);
  const entries = garbageAttack.expandEntries(context);
  
  // Add to opponent's garbage queue
  opponent.garbageQueue.enqueueAttack(garbageAttack, context);
  
  // ... rest of method
}
```

#### Task 3.2: Track Sender for Garbage Queue
**File: `src/core/garbage.js`**
- [ ] Modify `GarbageQueue` class (line ~650) to track sender per entry
- [ ] Store `senderId` and `senderColor` with each queued entry
- [ ] Preserve this information through serialization

```javascript
enqueueAttack(attack, context = {}) {
  if (!attack) return;
  const entries = attack.expandEntries(context);
  entries.forEach(entry => {
    entry.senderId = context.attackerId; // NEW
    entry.senderColor = context.color; // NEW
  });
  this.enqueue(entries);
}
```

---

### Phase 4: Display Player Colors in UI

**File: `src/ui/multi-player-canvas-layout.js`**

#### Task 4.1: Show Color Badge Next to Player Names
- [ ] Modify `createOpponentCanvas(opponent)` method (line ~873)
- [ ] Add color indicator dot/badge next to name

```javascript
infoOverlay.innerHTML = `
  <div class="opponent-name">
    <span class="player-color-badge" style="background-color: ${opponent.color};"></span>
    ${opponent.name}
  </div>
  <div class="opponent-stats">
    <span class="stat-small">Score: <strong class="score">0</strong></span>
    <span class="stat-small">Frags: <strong class="frags">0</strong></span>
  </div>
`;
```

#### Task 4.2: Add Color to Main Player Name
- [ ] Modify `createMainCanvas()` method (line ~686)
- [ ] Add color badge to main player header

```javascript
const nameEl = document.getElementById('main-player-name');
if (nameEl) {
  nameEl.innerHTML = `
    <span class="player-color-badge" style="background-color: ${localPlayer.color};"></span>
    ${localPlayer.name}
  `;
}
```

#### Task 4.3: Add Color to Leaderboard
- [ ] Modify `updateSidebarLeaderboard()` method (line ~412)
- [ ] Add color indicator to each leaderboard entry

```javascript
entry.innerHTML = `
  ${rankIcon}
  <span class="player-color-badge-small" style="background-color: ${player.color};"></span>
  <span class="player-name">${this.escapeHtml(player.name)}</span>
  <span class="player-stats-compact">
    <span class="stat-frags">💀${player.frags}</span>
    <span class="stat-score">⭐${formattedScore}</span>
  </span>
`;
```

---

### Phase 5: Color the Garbage Meter by Sender

**File: `src/ui/multi-player-canvas-layout.js`**

#### Task 5.1: Modify Garbage Meter Rendering
- [ ] Change `drawGarbageIndicator()` signature to accept sender info (line ~1303)
- [ ] Use sender color instead of generic red
- [ ] Show multiple colored segments if garbage is from multiple players

**Current signature:**
```javascript
drawGarbageIndicator(ctx, lineCount, canvasWidth, canvasHeight)
```

**New signature:**
```javascript
drawGarbageIndicator(ctx, garbageQueue, canvasWidth, canvasHeight)
```

**Implementation approach:**
- Parse `garbageQueue.entries` to get sender colors
- Draw segmented bar with each sender's color
- Show tooltip/label with sender name

#### Task 5.2: Update Call Sites
- [ ] In `renderFrame()` method (line ~1252), pass full `garbageQueue` instead of just `getTotalLines()`

```javascript
if (playerData.garbageQueue && playerData.garbageQueue.getTotalLines() > 0) {
  this.drawGarbageIndicator(
    canvasInfo.ctx,
    playerData.garbageQueue, // CHANGED: Pass full queue
    canvasInfo.canvas.width,
    canvasInfo.canvas.height
  );
}
```

#### Task 5.3: Implement Multi-Sender Garbage Meter
```javascript
drawGarbageIndicator(ctx, garbageQueue, canvasWidth, canvasHeight) {
  if (!garbageQueue || garbageQueue.getTotalLines() === 0) return;
  
  const blockSize = canvasWidth / COLS;
  const barWidth = blockSize * 0.5;
  const barX = canvasWidth - barWidth - 2;
  const maxHeight = canvasHeight * 0.8;
  
  // Group garbage by sender
  const senderGroups = new Map();
  garbageQueue.entries.forEach(entry => {
    const senderId = entry.senderId || 'unknown';
    const senderColor = entry.senderColor || '#808080';
    if (!senderGroups.has(senderId)) {
      senderGroups.set(senderId, { color: senderColor, count: 0 });
    }
    senderGroups.get(senderId).count += (entry.type === 'line' ? 1 : 0);
  });
  
  // Draw stacked segments
  let currentY = canvasHeight;
  senderGroups.forEach((group, senderId) => {
    const segmentHeight = (group.count / garbageQueue.getTotalLines()) * 
                          Math.min(garbageQueue.getTotalLines() / 20 * maxHeight, maxHeight);
    currentY -= segmentHeight;
    
    // Draw segment with sender's color
    ctx.fillStyle = group.color;
    ctx.fillRect(barX, currentY, barWidth, segmentHeight);
    
    ctx.strokeStyle = group.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, currentY, barWidth, segmentHeight);
  });
  
  // Draw total count at top
  const totalLines = garbageQueue.getTotalLines();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(totalLines.toString(), barX + barWidth / 2, canvasHeight - maxHeight - 5);
}
```

---

### Phase 6: Color Garbage Rows on Board

**File: `src/core/garbage.js`**

#### Task 6.1: Ensure Color is Applied to Garbage Pieces
- [ ] Verify `insertGarbageEntries()` properly uses `entry.color` (line ~607)
- [ ] This should already work if previous phases are done correctly

```javascript
const garbagePiece = {
  shapeKey: entry.variant === 'clean' ? 'CLEAN_GARBAGE' : 'GARBAGE',
  shape: [row],
  x: 0,
  y,
  color: entry.color || entry.senderColor || '#808080', // Use sender color
  pieceId: `${entry.attackId || 'garbage'}-${index}`,
  isGarbage: true,
  // ... rest of properties
};
```

#### Task 6.2: Verify Rendering
- [ ] Check `drawBlock()` in `src/rendering/canvas-utils.js` (line ~204)
- [ ] Ensure it uses the `color` property from garbage pieces
- [ ] Should already work, but verify visually

---

### Phase 7: Add CSS Styling

**File: `src/css/styles.css` (or appropriate CSS file)**

#### Task 7.1: Style Player Color Badges
```css
/* Player color badge (large, for main player and opponents) */
.player-color-badge {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 6px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  vertical-align: middle;
}

/* Small badge for leaderboard */
.player-color-badge-small {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  vertical-align: middle;
}
```

---

### Phase 8: Update Test Functions

**File: `src/main.js`**

#### Task 8.1: Verify testMultiplayer Function
- [ ] Check `testMultiplayerUI()` method (line ~1914)
- [ ] Ensure mock players get assigned colors correctly
- [ ] Colors should be assigned in `addPlayer()` so this should work automatically

---

### Phase 9: Handle Activity Feed Colors

**File: `src/ui/multi-player-canvas-layout.js`**

#### Task 9.1: Add Color to Kill Notifications
- [ ] Modify `addKillNotification()` method (line ~221)
- [ ] Show killer's color badge

```javascript
if (data.isSelfKill) {
  messageEl.innerHTML = `
    <span class="kill-icon">☠️</span>
    <span class="player-color-badge-small" style="background-color: ${data.victimColor};"></span>
    <span class="victim">${this.escapeHtml(data.victim)}</span>
    <span class="kill-text">topped out</span>
  `;
} else {
  messageEl.innerHTML = `
    <span class="kill-icon">💀</span>
    <span class="player-color-badge-small" style="background-color: ${data.killerColor};"></span>
    <span class="killer">${this.escapeHtml(data.killer)}</span>
    <span class="kill-arrow">→</span>
    <span class="player-color-badge-small" style="background-color: ${data.victimColor};"></span>
    <span class="victim">${this.escapeHtml(data.victim)}</span>
  `;
}
```

#### Task 9.2: Update Kill Event Dispatching
**File: `src/core/multiplayer/frag-tracker.js`**
- [ ] Include player colors when dispatching kill events
- [ ] Pass `killerColor` and `victimColor` in event detail

---

### Phase 10: Handle Lobby and Waiting Room

**File: `src/ui/lobby-waiting-room.js`**

#### Task 10.1: Show Colors in Waiting Room
- [ ] When displaying player list, show color badges
- [ ] Colors should be assigned when players join lobby
- [ ] Update `updatePlayersList()` or equivalent method

---

## Testing Checklist

### Manual Testing Steps
1. **Test Color Assignment**
   - [ ] Run `window.testMultiplayer(2)` - verify 2 different colors
   - [ ] Run `window.testMultiplayer(4)` - verify 4 different colors
   - [ ] Run `window.testMultiplayer(8)` - verify all 8 colors used
   - [ ] Run `window.testMultiplayer(9)` - verify color wrapping works

2. **Test UI Display**
   - [ ] Check opponent canvases show color badges
   - [ ] Check main player header shows color badge
   - [ ] Check leaderboard shows color badges
   - [ ] Check colors are distinct and readable

3. **Test Garbage Coloring**
   - [ ] Clear lines to send garbage to opponents
   - [ ] Verify garbage meter on recipient shows sender's color
   - [ ] Verify garbage rows on board match sender's color
   - [ ] Verify multiple senders create multi-colored garbage meter

4. **Test Activity Feed**
   - [ ] Verify kill notifications show player colors
   - [ ] Verify colors match the actual player assignments

5. **Test Network Sync**
   - [ ] Join an online lobby with real players
   - [ ] Verify all clients see the same colors for each player
   - [ ] Verify colors persist through reconnections

6. **Test Edge Cases**
   - [ ] Player disconnects mid-game - verify colors remain consistent
   - [ ] Host migration - verify colors are preserved
   - [ ] Multiple garbage attacks - verify segmented meter
   - [ ] Garbage counter (defense) - verify colors remain correct

---

## File Change Summary

### Files to Modify
1. `src/core/constants.js` - Add `PLAYER_COLORS` array
2. `src/core/multiplayer/ffa-p2p-game-state.js` - Assign colors to players
3. `src/core/multiplayer/ffa-attack-router.js` - Pass player color with garbage
4. `src/core/garbage.js` - Track sender color in garbage queue
5. `src/ui/multi-player-canvas-layout.js` - Display colors in UI, color garbage meter
6. `src/ui/lobby-waiting-room.js` - Show colors in lobby
7. `src/core/multiplayer/frag-tracker.js` - Include colors in kill events
8. `src/css/styles.css` - Add CSS for color badges

### Files to Review (may not need changes)
- `src/rendering/canvas-utils.js` - Verify garbage rendering uses color
- `src/rendering/draw.js` - Verify locked pieces respect color
- `src/main.js` - Verify test functions work correctly

---

## Implementation Order

**Recommended order of implementation:**

1. **Phase 1** - Define color constants (quick, foundational)
2. **Phase 2** - Assign colors to players (core functionality)
3. **Phase 3** - Pass colors to garbage system (core functionality)
4. **Phase 4** - Display colors in UI (visible progress)
5. **Phase 7** - Add CSS styling (makes colors look good)
6. **Phase 5** - Color garbage meter (complex, needs previous phases)
7. **Phase 6** - Verify garbage rows colored (should work automatically)
8. **Phase 9** - Add colors to activity feed (polish)
9. **Phase 10** - Add colors to lobby (polish)
10. **Phase 8** - Test and verify everything works

---

## Potential Issues & Solutions

### Issue 1: Color Contrast on Different Themes
**Problem**: Player colors might not be visible on some background themes
**Solution**: 
- Use high-contrast colors with white borders
- Add shadow/glow effects to color badges
- Test on multiple themes

### Issue 2: Network Synchronization
**Problem**: Colors might desync between clients if assigned independently
**Solution**:
- Host assigns colors and broadcasts to all clients
- Include color in initial player sync message
- Verify color in state sync broadcasts

### Issue 3: Color Assignment with Late Joiners
**Problem**: If a player joins mid-game, their color index might conflict
**Solution**:
- Track used colors in game state
- Assign first available color from pool
- Reuse colors from disconnected players

### Issue 4: Performance with Large Garbage Queues
**Problem**: Drawing multi-colored garbage meter might be slow
**Solution**:
- Cache sender color segments
- Only recalculate when queue changes
- Limit segment rendering detail for very large queues

---

## Future Enhancements

### Customizable Player Colors
- Allow players to choose their preferred color in settings
- Fallback to auto-assigned if color is taken
- Save preference to Steam profile/localStorage

### Color-Coded Notifications
- Flash screen border with attacker's color when receiving garbage
- Show colored sparkle effect when countering specific player's garbage

### Team Colors
- For team-based modes, use team color instead of individual
- Show team badge/icon instead of color dot

### Colorblind Accessibility
- Add optional colorblind-friendly palette
- Add icon/pattern in addition to color
- Settings toggle for accessibility mode

---

## Success Criteria

Implementation is complete when:
- ✅ Each player has a unique, persistent color
- ✅ Player names display with color badge in all UI locations
- ✅ Garbage meter shows sender's color
- ✅ Garbage rows on board match sender's color
- ✅ Colors work in both `testMultiplayer()` and real lobbies
- ✅ Colors sync correctly across network
- ✅ No visual bugs or performance issues
- ✅ All manual tests pass

---

## Estimated Effort

- **Phase 1-3**: 2-3 hours (core logic)
- **Phase 4-7**: 3-4 hours (UI implementation)
- **Phase 8-10**: 1-2 hours (polish and edge cases)
- **Testing**: 2-3 hours (comprehensive testing)

**Total: 8-12 hours** for complete implementation and testing

