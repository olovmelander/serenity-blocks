# ✅ Local Multiplayer 4-Player Implementation Checklist

**Feature:** Configuration Options + 4-Player Support for Local Multiplayer  
**Status:** 🔄 In Progress (Phase 1 Complete)

---

## Phase 1: Research & Planning ✅

- [x] Analyze current LocalMultiplayerMode architecture
- [x] Study online multiplayer configuration system
- [x] Map dependencies and file structure
- [x] Document current limitations (2 players, hardcoded settings)
- [x] Create comprehensive implementation plan
- [x] Define input layouts for 4 players
- [x] Design UI layouts for 2/3/4 players
- [x] Assess risks and mitigation strategies

---

## Phase 2: Configuration UI 📝

### 2.1 Create LocalMatchConfigModal Component
- [ ] Create `src/ui/local-match-config-modal.js`
- [ ] Implement modal HTML structure
- [ ] Add player count selector (2-4)
- [ ] Add win condition selector (frags/time/points/lines/never)
- [ ] Add win condition value input
- [ ] Add advanced settings section
  - [ ] Starting level (1-9)
  - [ ] Level progression toggle
  - [ ] Boring rules toggle
- [ ] Implement form validation
- [ ] Add event listeners for UI interactions
- [ ] Implement show/hide methods
- [ ] Test modal independently

### 2.2 Integrate Modal into LocalMultiplayerMode
- [ ] Import LocalMatchConfigModal
- [ ] Show modal on mode activation
- [ ] Pass configuration to startMatchWithConfig()
- [ ] Store configuration in this.matchConfig
- [ ] Remove hardcoded roundsToWin
- [ ] Update mode activation flow

### 2.3 CSS Styling
- [ ] Reuse/adapt match-config-modal styles
- [ ] Ensure consistent styling with online MP modal
- [ ] Test responsive design

### Testing
- [ ] Modal opens when local MP mode selected
- [ ] All form fields work correctly
- [ ] Configuration saves properly
- [ ] Cancel/close buttons work
- [ ] Form validation catches invalid inputs

---

## Phase 3: Game State Extension 🔄

### 3.1 Create MultiPlayerState Class
- [ ] Create `src/core/multi-player-state.js`
- [ ] Implement constructor with dynamic player count
- [ ] Create array-based player storage (2-4 players)
- [ ] Create array-based garbage queue storage
- [ ] Implement setMatchConfig() method
- [ ] Implement reset() method
- [ ] Implement getPlayerState() method
- [ ] Implement getGarbageQueue() method

### 3.2 Implement Garbage Handling
- [ ] Implement handleGarbageSummary()
- [ ] Implement _getAttackTargets() for N players
- [ ] Route garbage to all opponents
- [ ] Track lastAttackerIds for frag attribution

### 3.3 Implement Win Condition System
- [ ] Implement checkWinCondition()
- [ ] Add frags win condition
- [ ] Add time win condition
- [ ] Add points win condition
- [ ] Add lines win condition
- [ ] Add never win condition (no auto-end)
- [ ] Implement endMatch() method
- [ ] Implement handlePlayerDeath() with frag tracking

### 3.4 Implement Attack Scaling
- [ ] Create _scaleAttackForPlayerCount() method
- [ ] 2 players: 100% damage
- [ ] 3 players: 75% damage
- [ ] 4 players: 50% damage
- [ ] Respect "boring rules" config (disable scaling)

### 3.5 Update LocalMultiplayerMode
- [ ] Replace MultiplayerGameState with MultiPlayerState
- [ ] Update to array-based player management
- [ ] Remove hardcoded 2-player logic
- [ ] Implement startMatchWithConfig()
- [ ] Update _setupPlayers() for dynamic count
- [ ] Update game loop for N players
- [ ] Update win detection logic

### Testing
- [ ] 2-player mode works with new state
- [ ] 3-player mode initializes correctly
- [ ] 4-player mode initializes correctly
- [ ] Garbage routing works for all player counts
- [ ] Win conditions trigger correctly
- [ ] Frags are tracked accurately

---

## Phase 4: Rendering System 🎨

### 4.1 Update HTML Structure
- [ ] Open `public/index.html`
- [ ] Add #p3-side container
- [ ] Add #p4-side container
- [ ] Add player 3 board container
- [ ] Add player 4 board container
- [ ] Add player 3 next piece canvases (3x)
- [ ] Add player 4 next piece canvases (3x)
- [ ] Add player 3 stats display
- [ ] Add player 4 stats display
- [ ] Add #multiplayer-grid container
- [ ] Add #match-info display

### 4.2 Create CSS Layouts
- [ ] Create `styles/multiplayer.css` (or update existing)
- [ ] Implement .multiplayer-grid base styles
- [ ] Implement .grid-2-player layout (2x1)
- [ ] Implement .grid-3-player layout (2+1)
- [ ] Implement .grid-4-player layout (2x2)
- [ ] Style .player-side containers
- [ ] Style .player-header sections
- [ ] Style .player-stats displays
- [ ] Style .board-container
- [ ] Style .next-pieces display
- [ ] Style #match-info floating display
- [ ] Add responsive breakpoints
- [ ] Test on different screen sizes

### 4.3 Update LocalMultiplayerMode UI Logic
- [ ] Implement _setupMultiplayerUI(numPlayers)
- [ ] Show/hide player sides based on count
- [ ] Apply correct grid class (grid-2-player, etc.)
- [ ] Update match info display
- [ ] Implement _updateMatchInfo() to show win condition
- [ ] Create Phaser game instances for all players
- [ ] Position boards correctly
- [ ] Update stats displays dynamically

### 4.4 Phaser Integration
- [ ] Update _createPhaserGameForPlayer(playerIndex)
- [ ] Support player indices 0-3
- [ ] Correct board positioning for each player
- [ ] Scale boards appropriately for layout
- [ ] Ensure all boards render without overlap

### Testing
- [ ] 2-player layout renders correctly
- [ ] 3-player layout renders correctly
- [ ] 4-player layout renders correctly
- [ ] All boards are visible and properly positioned
- [ ] Stats update for all players
- [ ] Match info displays correct win condition
- [ ] Responsive design works on 1080p
- [ ] No visual glitches or overlaps

---

## Phase 5: Input Handling 🎮

### 5.1 Define Input Mappings
- [ ] Document Player 1 layout (Arrow keys)
- [ ] Document Player 2 layout (WASD)
- [ ] Document Player 3 layout (IJKL)
- [ ] Document Player 4 layout (Numpad)
- [ ] Verify no key conflicts

### 5.2 Update Input Manager
- [ ] Open `src/input/input-manager.js`
- [ ] Define PLAYER3_KEYS constant
- [ ] Define PLAYER4_KEYS constant
- [ ] Create playerKeyMaps array [P1, P2, P3, P4]
- [ ] Implement isPlayerActionPressed(playerIndex, action)
- [ ] Implement getGamepad(playerIndex)
- [ ] Support 4 gamepad indices (0-3)
- [ ] Test keyboard input for all 4 players
- [ ] Test gamepad input for all 4 players

### 5.3 Update LocalMultiplayerMode Input Handling
- [ ] Update _handleInput() for N players
- [ ] Loop through all active players
- [ ] Handle movement for each player
- [ ] Handle rotation for each player
- [ ] Handle hard drop for each player
- [ ] Ensure input doesn't bleed between players
- [ ] Add pause functionality (applies to all players)

### 5.4 Gamepad Support
- [ ] Test with 1 gamepad (player 1)
- [ ] Test with 2 gamepads (players 1-2)
- [ ] Test with 3 gamepads (players 1-3)
- [ ] Test with 4 gamepads (players 1-4)
- [ ] Handle gamepad disconnection gracefully
- [ ] Show gamepad status in UI

### Testing
- [ ] Player 1 keyboard controls work
- [ ] Player 2 keyboard controls work
- [ ] Player 3 keyboard controls work
- [ ] Player 4 keyboard controls work
- [ ] No input conflicts between players
- [ ] All 4 players can play simultaneously
- [ ] Gamepad 1 controls player 1
- [ ] Gamepad 2 controls player 2
- [ ] Gamepad 3 controls player 3
- [ ] Gamepad 4 controls player 4
- [ ] Keyboard + gamepad mix works

---

## Phase 6: Garbage System ⚡

### 6.1 Attack Routing
- [ ] Verify _getAttackTargets() implementation
- [ ] Test 2-player attack routing (1-to-1)
- [ ] Test 3-player attack routing (1-to-2)
- [ ] Test 4-player attack routing (1-to-3)
- [ ] Ensure only alive players are targeted

### 6.2 Attack Scaling
- [ ] Implement _scaleAttackForPlayerCount()
- [ ] Test 2-player: full damage
- [ ] Test 3-player: 75% damage
- [ ] Test 4-player: 50% damage
- [ ] Test "boring rules" disables scaling
- [ ] Balance test with real gameplay

### 6.3 Frag Attribution
- [ ] Track lastAttackerIds correctly
- [ ] Award frags to correct player
- [ ] Handle self-kills (no frag awarded)
- [ ] Update frag display in UI
- [ ] Log frag events to console

### Testing
- [ ] Garbage sends to all opponents
- [ ] Attack damage scales correctly
- [ ] Frags are awarded accurately
- [ ] Self-kills don't award frags
- [ ] Frag counts displayed correctly
- [ ] No garbage routing bugs

---

## Phase 7: Testing & Polish 🧪

### 7.1 Functional Testing

#### 2-Player Mode
- [ ] Configuration modal works
- [ ] 2 boards render correctly
- [ ] Both players have independent controls
- [ ] Garbage attacks work bidirectionally
- [ ] Frags win condition works
- [ ] Time win condition works
- [ ] Points win condition works
- [ ] Lines win condition works
- [ ] Never win condition works
- [ ] Starting level affects speed
- [ ] Level progression works
- [ ] Boring rules toggle works

#### 3-Player Mode
- [ ] 3 boards render in correct layout
- [ ] All 3 players can control independently
- [ ] Garbage distributes to 2 opponents
- [ ] Attack scaling applies (75%)
- [ ] Win conditions work correctly
- [ ] Frag tracking accurate
- [ ] UI displays all 3 players

#### 4-Player Mode
- [ ] 4 boards render in 2x2 grid
- [ ] All 4 players can control independently
- [ ] No keyboard conflicts
- [ ] Gamepad support for 4 controllers
- [ ] Garbage distributes to 3 opponents
- [ ] Attack scaling applies (50%)
- [ ] Win conditions work correctly
- [ ] Frag tracking accurate
- [ ] UI displays all 4 players

### 7.2 Performance Testing
- [ ] Profile 2-player performance (target: 60 FPS)
- [ ] Profile 3-player performance (target: 45 FPS)
- [ ] Profile 4-player performance (target: 30 FPS)
- [ ] Check memory usage
- [ ] Check for memory leaks
- [ ] Optimize if needed

### 7.3 Edge Case Testing
- [ ] All players die simultaneously
- [ ] Player disconnects gamepad mid-game
- [ ] Match time limit reached
- [ ] Multiple players reach frag limit simultaneously
- [ ] Very long matches (30+ minutes)
- [ ] Rapid match restart

### 7.4 Bug Fixes
- [ ] Fix any input conflicts
- [ ] Fix garbage queue desyncs
- [ ] Fix win condition bugs
- [ ] Fix rendering issues
- [ ] Fix performance bottlenecks
- [ ] Fix UI glitches

### 7.5 Polish
- [ ] Add sound effects for attacks
- [ ] Add visual feedback for frags
- [ ] Polish match end screen
- [ ] Add match statistics display
- [ ] Improve player death animations
- [ ] Add countdown timer for time-based matches
- [ ] Smooth transitions between matches

### 7.6 Documentation
- [ ] Update README with 4-player instructions
- [ ] Document keyboard layouts
- [ ] Document gamepad support
- [ ] Create testing guide
- [ ] Update screenshots
- [ ] Document known issues

---

## Acceptance Criteria ✅

### Must Have (P0)
- [ ] Configuration modal functional
- [ ] 2, 3, and 4 player modes work
- [ ] All 5 win conditions implemented
- [ ] 4-player input (keyboard + gamepad)
- [ ] Garbage system working
- [ ] No critical bugs
- [ ] Playable on 1920x1080 screens

### Should Have (P1)
- [ ] Responsive UI
- [ ] Performance targets met
- [ ] Attack scaling implemented
- [ ] Match info display
- [ ] Smooth animations
- [ ] Clear player feedback

### Nice to Have (P2)
- [ ] Player customization
- [ ] Match replay
- [ ] Statistics tracking
- [ ] Tournament mode

---

## Final Checklist Before Release 🚀

- [ ] All P0 acceptance criteria met
- [ ] All P1 acceptance criteria met
- [ ] No known critical bugs
- [ ] Performance acceptable
- [ ] Documentation complete
- [ ] Code reviewed
- [ ] Tests pass
- [ ] User testing completed

---

## Timeline Tracking

| Phase | Estimated | Actual | Status |
|-------|-----------|--------|--------|
| Phase 1 | N/A | N/A | ✅ Complete |
| Phase 2 | 1-2 days | ___ | 📝 Ready |
| Phase 3 | 2-3 days | ___ | ⏳ Pending |
| Phase 4 | 2-3 days | ___ | ⏳ Pending |
| Phase 5 | 2 days | ___ | ⏳ Pending |
| Phase 6 | 1 day | ___ | ⏳ Pending |
| Phase 7 | 2-3 days | ___ | ⏳ Pending |

**Total:** 10-14 days estimated

---

## Notes & Issues

### Blockers
- None currently

### Issues Discovered
- (Document issues here as they're found)

### Decisions Made
- Max 4 players for performance
- Fixed keyboard layouts (customization later)
- Attack scaling enabled by default
- Reuse online MP modal patterns

---

**Ready to start Phase 2? Let's build this! 🚀**

