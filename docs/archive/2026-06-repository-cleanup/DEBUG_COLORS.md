# Debug Player Colors

## Testing Instructions

### 1. Open Browser Console (F12)

### 2. Start a multiplayer game or join a lobby

### 3. Run this diagnostic command in console:

```javascript
// Check if colors are assigned
if (window.ffaGameState) {
  console.log('=== PLAYER COLORS DIAGNOSTIC ===');
  const players = Array.from(window.ffaGameState.players.values());
  console.log(`Total players: ${players.length}`);
  players.forEach((p, i) => {
    console.log(`${i+1}. ${p.name}:`);
    console.log(`   Steam ID: ${p.steamId}`);
    console.log(`   Color: ${p.color}`);
    console.log(`   Is Local: ${p.isLocal}`);
  });
  console.log('================================');
} else {
  console.log('No ffaGameState found - not in multiplayer');
}
```

### 4. What to Look For

The console should show:
- **Color assignment logs** when players join (with 🎨 emoji)
- **Player colors** in the diagnostic output
- **Lobby updates** showing colors for each player

### Expected Console Output

When working correctly, you should see:

```
🎨 Assigning color to Dev_385: index=0, color=#ff1744
   Available colors: (8) ['#ff1744', '#2979ff', '#00e676', ...]
✅ Player added: Dev_385 - Color: #ff1744

🎨 Assigning color to Alice: index=1, color=#2979ff
✅ Player added: Alice - Color: #2979ff

🎨 Assigning color to Bob: index=2, color=#00e676
✅ Player added: Bob - Color: #00e676

🎨 Assigning color to Charlie: index=3, color=#ffea00
✅ Player added: Charlie - Color: #ffea00
```

### Expected Color Assignments (8 players max)

1. **Player 1**: Red (`#ff1744`)
2. **Player 2**: Blue (`#2979ff`) 
3. **Player 3**: Green (`#00e676`)
4. **Player 4**: Yellow (`#ffea00`)
5. **Player 5**: Purple (`#e040fb`)
6. **Player 6**: Cyan (`#00e5ff`)
7. **Player 7**: Orange (`#ff9100`)
8. **Player 8**: Pink (`#f50057`)

## Common Issues

### Issue: All players show grey dots

**Possible Causes:**
1. PLAYER_COLORS not imported correctly
2. Color assignment happening before array is loaded
3. Color being overwritten somewhere

**Solution:** Check console for error messages with ❌ emoji

### Issue: Host has color, peers are grey

**Possible Causes:**
1. Colors not being broadcast from host to peers
2. Peers not applying received colors

**Solution:** Check for messages with 📢 emoji showing peer updates

### Issue: Colors change after joining

**Possible Causes:**
1. Color index based on local player count instead of host's
2. Multiple color assignments happening

**Solution:** Check the order of `addPlayer()` calls

## Files Changed

- `src/core/constants.js` - PLAYER_COLORS array
- `src/core/multiplayer/ffa-p2p-game-state.js` - Color assignment & sync
- `src/ui/lobby-waiting-room.js` - Lobby color badges
- `src/ui/multi-player-canvas-layout.js` - In-game color badges
- `public/styles/multiplayer-ui.css` - Badge styling

